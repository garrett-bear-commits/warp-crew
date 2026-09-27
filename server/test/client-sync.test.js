// End to end: the game's real cloud client and purchase flow against the real
// server and a throwaway Postgres (TEST_DATABASE_URL; tables are dropped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { buildApp } from '../app.js';
import { createStore, migrate } from '../store.js';

const url = process.env.TEST_DATABASE_URL;
const SECRET = Buffer.from('warp-crew-test-secret-32-bytes!!').toString('base64');
const GAME = 'game-warp-crew';

function sign(payload) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(SECRET, 'base64')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function fakeBrowser(server, devId) {
  const store = new Map([['wc.devPlayerId', devId]]);
  globalThis.window = {
    location: { href: `http://localhost/?server=${encodeURIComponent(server)}` },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  };
}

test('cloud save and verified purchases, end to end', { skip: !url && 'TEST_DATABASE_URL not set' }, async (t) => {
  const sql = postgres(url, { onnotice: () => {} });
  await sql`DROP TABLE IF EXISTS save_events, purchase_transactions`;
  await migrate(sql);
  // Dev auth for identity (no Jest in Node), real HMAC for receipts.
  const app = buildApp({ store: createStore(sql), secret: SECRET, gameId: GAME, devAuth: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const server = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await sql.end(); delete globalThis.window; });

  const cloud = await import('../../src/shared/cloud.js');
  const { chooseSave, applyLedger } = await import('../../src/systems/cloudSync.js');
  const { settleReceipt, retryPendingReceipts } = await import('../../src/systems/iap.js');
  const { stageReceipt } = await import('../../src/systems/cloudSync.js');
  const { createNewPlayer } = await import('../../src/systems/player.js');

  // Device A: plays, saves, buys.
  fakeBrowser(server, 'dev_deviceowner');
  assert.equal(cloud.cloudEnabled(), true);
  let deviceA = { ...createNewPlayer({ tutorialScript: 4 }), tutorial: { script: 5, completed: true, phase: 'done' }, stats: { contractsCompleted: 5 } };
  const pushed = await cloud.pushCloudSave(deviceA);
  assert.equal(pushed.ok, true, pushed.reason);
  deviceA = { ...deviceA, cloudSeq: pushed.data.seq };

  const receipt = sign({ aud: GAME, sub: 'dev_deviceowner', purchase: { purchaseToken: 'jest-tok-1', productSku: 'wc_gems_l', createdAt: Date.now(), completedAt: null, price: 999 } });
  // Server down: the receipt stays staged, nothing granted.
  const offline = await settleReceipt(stageReceipt(deviceA, receipt), receipt, { verifyReceipt: async () => ({ ok: false, reason: 'network' }) });
  assert.equal(offline.reason, 'pending_verification');
  assert.equal(offline.player.wallet.gems, deviceA.wallet.gems);
  assert.deepEqual(offline.player.pendingReceipts, [receipt]);
  // Back online: the retry grants exactly what the server chose.
  const retried = await retryPendingReceipts(offline.player, { verifyReceipt: cloud.verifyReceipt });
  assert.equal(retried.player.wallet.gems, deviceA.wallet.gems + 600);
  assert.deepEqual(retried.player.pendingReceipts, []);
  // A second verify of the same receipt never grants twice on this device.
  const replay = await settleReceipt(stageReceipt(retried.player, receipt), receipt, { verifyReceipt: cloud.verifyReceipt });
  assert.equal(replay.player.wallet.gems, retried.player.wallet.gems);
  deviceA = replay.player;

  // A receipt for someone else is refused and dropped from the outbox.
  const stolen = sign({ aud: GAME, sub: 'dev_someoneelse', purchase: { purchaseToken: 'x', productSku: 'wc_gems_xxl', createdAt: Date.now(), completedAt: null, price: 4999 } });
  const refused = await settleReceipt(stageReceipt(deviceA, stolen), stolen, { verifyReceipt: cloud.verifyReceipt });
  assert.equal(refused.ok, false);
  assert.equal(refused.player.wallet.gems, deviceA.wallet.gems);

  // Device B (same Jest player, older save that never saw the purchase) catches up.
  const loaded = await cloud.fetchCloudSave();
  assert.equal(loaded.ok, true);
  const staleDevice = { ...createNewPlayer({ tutorialScript: 4 }), cloudSeq: 0 };
  const chosen = chooseSave(staleDevice, loaded.data.save);
  assert.equal(chosen.source, 'cloud', 'a newer save from another device wins');
  const reconciled = applyLedger(chosen.player, loaded.data.purchases);
  assert.deepEqual(reconciled.applied, ['wc_gems_l'], 'the purchase the old save never saw is granted');
  assert.equal(applyLedger(reconciled.player, loaded.data.purchases).applied.length, 0, 'ledger is idempotent');

  // A device that is ahead keeps its own progress.
  const ahead = chooseSave({ ...deviceA, cloudSeq: loaded.data.save.seq }, loaded.data.save);
  assert.equal(ahead.source, 'local');
});
