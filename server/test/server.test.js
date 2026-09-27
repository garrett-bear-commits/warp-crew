// Runs against a throwaway Postgres: TEST_DATABASE_URL (tables are dropped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { buildApp, MAX_SAVE_BYTES } from '../app.js';
import { createStore, migrate } from '../store.js';

const url = process.env.TEST_DATABASE_URL;
const SECRET = Buffer.from('warp-crew-test-secret-32-bytes!!').toString('base64');
const GAME = 'game-warp-crew';
const NOW = Date.UTC(2030, 8, 27, 12);

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(payload, { secret = SECRET, alg = 'HS256' } = {}) {
  const head = b64url({ alg, typ: 'JWT' });
  const body = b64url(payload);
  const sig = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const playerToken = (playerId, extra = {}) => sign({ aud: GAME, sub: playerId, iat: Math.floor(NOW / 1000), player: { playerId, registered: true }, ...extra });
const headers = (playerId, token = playerToken(playerId)) => ({ 'x-player-id': playerId, authorization: `Bearer ${token}` });
const receipt = (playerId, purchases, extra = {}) => sign({ aud: GAME, sub: playerId, ...(purchases.length === 1 && !extra.batch ? { purchase: purchases[0] } : { purchases }), ...extra });
const purchase = (token, sku, price = 499) => ({ purchaseToken: token, productSku: sku, createdAt: NOW, completedAt: null, price, currency: 'USD' });
const saveBody = (credits, extra = {}) => ({ blob: JSON.stringify({ player: { version: 9, wallet: { credits } } }), savedAt: NOW, ...extra });

test('saves and purchases', { skip: !url && 'TEST_DATABASE_URL not set' }, async (t) => {
  const sql = postgres(url, { onnotice: () => {} });
  await sql`DROP TABLE IF EXISTS save_events, purchase_transactions`;
  await migrate(sql);
  await migrate(sql); // idempotent
  const app = buildApp({ store: createStore(sql), secret: SECRET, gameId: GAME, now: () => NOW });
  t.after(async () => { await app.close(); await sql.end(); });
  const call = (method, path, player, payload, extraHeaders) => app.inject({ method, url: path, headers: { ...headers(player), ...extraHeaders }, payload });

  await t.test('identity is required and verified', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/v1/saves/current' })).statusCode, 401);
    assert.equal((await call('GET', '/v1/saves/current', 'pilot1', undefined, { authorization: 'Bearer nope' })).json().error, 'malformed');
    const forged = playerToken('pilot1').replace(/.$/, 'A');
    assert.equal((await call('GET', '/v1/saves/current', 'pilot1', undefined, { authorization: `Bearer ${forged}` })).statusCode, 401);
    const other = sign({ aud: 'another-game', sub: 'pilot1', iat: Math.floor(NOW / 1000) });
    assert.equal((await call('GET', '/v1/saves/current', 'pilot1', undefined, { authorization: `Bearer ${other}` })).json().error, 'wrong_audience');
    assert.equal((await call('GET', '/v1/saves/current', 'pilot2', undefined, { authorization: `Bearer ${playerToken('pilot1')}` })).json().error, 'sub_mismatch');
    const stale = playerToken('pilot1', { iat: Math.floor((NOW - 25 * 3600 * 1000) / 1000) });
    assert.equal((await call('GET', '/v1/saves/current', 'pilot1', undefined, { authorization: `Bearer ${stale}` })).json().error, 'stale');
  });

  await t.test('saves are insert-only with server-assigned sequence', async () => {
    assert.deepEqual((await call('GET', '/v1/saves/current', 'saver')).json(), { save: null, purchases: [] });
    const first = (await call('PUT', '/v1/saves', 'saver', saveBody(10, { clientSeq: 1 }))).json();
    assert.deepEqual(first, { seq: 1, accepted: true, rejectReason: null, conflict: false });
    const second = (await call('PUT', '/v1/saves', 'saver', saveBody(20, { clientSeq: 1, baseSeq: 1 }))).json();
    assert.equal(second.seq, 2, 'server assigns seq even when the client repeats its claim');
    const current = (await call('GET', '/v1/saves/current', 'saver')).json().save;
    assert.equal(current.seq, 2);
    assert.equal(JSON.parse(current.blob).player.wallet.credits, 20);
    // A stale device still writes (nothing is dropped) but is told about the conflict.
    const stale = (await call('PUT', '/v1/saves', 'saver', saveBody(15, { baseSeq: 1 }))).json();
    assert.equal(stale.conflict, true);
    assert.equal(stale.accepted, true);
    // Refused writes are kept for recovery and never become current.
    const bad = (await call('PUT', '/v1/saves', 'saver', { blob: '{"player":{}}', savedAt: NOW })).json();
    assert.equal(bad.accepted, false);
    assert.equal(bad.rejectReason, 'bad_shape');
    assert.equal((await call('GET', '/v1/saves/current', 'saver')).json().save.seq, 3);
    const [stored] = await sql`SELECT blob FROM save_events WHERE player_key = 'saver' AND NOT accepted`;
    assert.equal(stored.blob, '{"player":{}}');
    // The losing side of a two-device conflict is archived, never current.
    const archived = (await call('PUT', '/v1/saves', 'saver', saveBody(5, { archive: true }))).json();
    assert.equal(archived.rejectReason, 'archived_conflict');
    assert.equal((await call('GET', '/v1/saves/current', 'saver')).json().save.seq, 3);
    const huge = (await call('PUT', '/v1/saves', 'saver', { blob: 'x'.repeat(MAX_SAVE_BYTES + 1), savedAt: NOW })).json();
    assert.equal(huge.rejectReason, 'too_large');
    assert.equal((await call('PUT', '/v1/saves', 'saver', { blob: 42 })).statusCode, 400);
    // Players never see each other's saves.
    assert.equal((await call('GET', '/v1/saves/current', 'someone-else')).json().save, null);
  });

  await t.test('purchases: signed receipt only, idempotent, one-time enforced', async () => {
    const buy = (player, token, sku, price) => call('POST', '/v1/purchases/verify', player, { receipt: receipt(player, [purchase(token, sku, price)]) });
    const granted = (await buy('buyer', 'tok-1', 'wc_gems_m')).json();
    assert.deepEqual(granted.purchases, [{ purchaseToken: 'tok-1', sku: 'wc_gems_m', status: 'granted', grant: { gems: 280 } }]);
    const replay = (await buy('buyer', 'tok-1', 'wc_gems_m')).json();
    assert.equal(replay.purchases[0].status, 'already_recorded', 'replays never grant twice');
    // Receipts cannot be forged, reused by another player, or come from another game.
    const forged = receipt('buyer', [purchase('tok-x', 'wc_gems_xxl')], {}).replace(/.$/, 'A');
    assert.equal((await call('POST', '/v1/purchases/verify', 'buyer', { receipt: forged })).json().error, 'bad_signature');
    assert.equal((await call('POST', '/v1/purchases/verify', 'thief', { receipt: receipt('buyer', [purchase('tok-y', 'wc_gems_s')]) })).statusCode, 403);
    const otherGame = sign({ aud: 'nope', sub: 'buyer', purchase: purchase('tok-z', 'wc_gems_s') });
    assert.equal((await call('POST', '/v1/purchases/verify', 'buyer', { receipt: otherGame })).json().error, 'wrong_audience');
    const noneAlg = sign({ aud: GAME, sub: 'buyer', purchase: purchase('tok-n', 'wc_gems_s') }, { alg: 'none' });
    assert.equal((await call('POST', '/v1/purchases/verify', 'buyer', { receipt: noneAlg })).json().error, 'bad_alg');
    // One-time packs grant once per player; a second payment is recorded for refund, not granted.
    assert.equal((await buy('buyer', 'kit-1', 'wc_starter_kit')).json().purchases[0].status, 'granted');
    const dup = (await buy('buyer', 'kit-2', 'wc_starter_kit')).json().purchases[0];
    assert.equal(dup.status, 'duplicate_one_time');
    assert.deepEqual(dup.grant, {});
    assert.equal((await buy('buyer2', 'kit-3', 'wc_starter_kit')).json().purchases[0].status, 'granted', 'one-time is per player');
    // Unknown SKUs are recorded but grant nothing; sandbox (price 0) is classified.
    assert.equal((await buy('buyer', 'tok-u', 'not_a_product')).json().purchases[0].status, 'unsupported');
    await buy('buyer', 'tok-s', 'wc_gems_s', 0);
    const [sandbox] = await sql`SELECT classification FROM purchase_transactions WHERE provider_token = 'tok-s'`;
    assert.equal(sandbox.classification, 'sandbox');
    // Incomplete-purchase batches record every receipt.
    const batch = (await call('POST', '/v1/purchases/verify', 'buyer', { receipt: receipt('buyer', [purchase('b-1', 'wc_gems_s'), purchase('b-2', 'wc_wall_spur')], { batch: true }) })).json();
    assert.deepEqual(batch.purchases.map(p => p.status), ['granted', 'granted']);
    // The ledger lets any device reconcile grants it never saw.
    const ledger = (await call('GET', '/v1/saves/current', 'buyer')).json().purchases;
    assert.deepEqual(ledger.map(p => p.purchaseToken).sort(), ['b-1', 'b-2', 'kit-1', 'tok-1', 'tok-s'].sort());
    assert.ok(!ledger.some(p => p.purchaseToken === 'kit-2' || p.purchaseToken === 'tok-u'));
    // Concurrent duplicate one-time purchases still grant exactly once.
    const racers = await Promise.all(['r-1', 'r-2', 'r-3'].map(token => buy('racer', token, 'wc_wall_veil')));
    assert.equal(racers.map(r => r.json().purchases[0].status).filter(s => s === 'granted').length, 1);
  });

  await t.test('misconfiguration fails closed', async () => {
    const closed = buildApp({ store: createStore(sql), secret: undefined, gameId: GAME, now: () => NOW });
    assert.equal((await closed.inject({ method: 'GET', url: '/v1/saves/current', headers: headers('pilot1') })).json().error, 'no_secret');
    await closed.close();
  });
});
