// Saves, identity, grants and subscriptions on @foundation/client (stage 3 of the core port).
// What the legacy cloud_sync test covered (choose the furthest save, never drop progress, apply
// purchases once) is now the core's reconcile and grants; this file checks Warp Crew's wiring of
// them. The server half runs in apps/server/test/pg/warpcrew-client.test.ts.
import assert from 'node:assert/strict';
import { memoryStorage } from '@foundation/client';
import { nodeWarpcrew } from './helpers/coreClient.mjs';
import { createWarpcrew, savePriorityFor } from '../src/core/client.js';
import { applyGrantRewards, GRANT_KINDS, grantKindOf, oneTimeSkuOf, markOwned, rewardsFromTable } from '../src/core/grants.js';
import { LEGACY_SAVE_KEY, LEGACY_IMPORTED_KEY } from '../src/core/legacy.js';
import { progressOf } from '../src/core/progress.js';
import { createNewPlayer } from '../src/systems/player.js';
import { PRODUCT_DEFS } from '../src/data/products.js';

const stats = (jumps) => ({ jumps, combatsWon: 0, expeditions: 0, contractsCompleted: 0 });

// ── A save survives a reload (offline: the Pages QA build) ──
{
  const ls = memoryStorage();
  const a = nodeWarpcrew({ localStorage: ls, playerId: 'reload' });
  await a.wc.boot();
  assert.equal(a.wc.online, false);
  assert.ok(a.wc.commit({ ...a.wc.state(), captainName: 'Vex', wallet: { ...a.wc.state().wallet, gems: 77 } }, 'test'));
  await a.wc.save('immediate');
  a.wc.client.destroy();
  const b = nodeWarpcrew({ localStorage: ls, playerId: 'reload' });
  const booted = await b.wc.boot();
  assert.equal(booted.decision.action, 'keep_local');
  assert.equal(b.wc.state().captainName, 'Vex');
  assert.equal(b.wc.state().wallet.gems, 77);
  b.wc.client.destroy();
}

// ── The legacy save (warpcrew.save.v2) is imported once, then moved aside ──
{
  const ls = memoryStorage();
  const legacy = { ...createNewPlayer({ captainName: 'Legacy' }), version: 8, stats: stats(5), cloudSeq: 3, cloudDirty: true };
  ls.setItem(LEGACY_SAVE_KEY, JSON.stringify({ player: legacy, savedAt: 1 }));
  const a = nodeWarpcrew({ localStorage: ls, playerId: 'legacy' });
  const booted = await a.wc.boot();
  assert.equal(booted.importedLegacy, true);
  assert.equal(a.wc.state().captainName, 'Legacy');
  assert.equal(a.wc.state().version, 9);
  assert.equal(progressOf(a.wc.state()), 5);
  assert.ok(!('cloudSeq' in a.wc.state()), 'legacy sync fields dropped');
  assert.equal(ls.getItem(LEGACY_SAVE_KEY), null);
  assert.ok(ls.getItem(LEGACY_IMPORTED_KEY), 'kept aside, recoverable by hand');
  a.wc.client.destroy();
  const b = nodeWarpcrew({ localStorage: ls, playerId: 'legacy' });
  assert.equal((await b.wc.boot()).importedLegacy, false, 'never imported twice');
  assert.equal(b.wc.state().captainName, 'Legacy');
  b.wc.client.destroy();
}

// ── A shallower legacy save never replaces deeper core progress ──
{
  const ls = memoryStorage();
  const a = nodeWarpcrew({ localStorage: ls, playerId: 'deeper' });
  await a.wc.boot();
  a.wc.commit({ ...a.wc.state(), captainName: 'Core', stats: { ...a.wc.state().stats, jumps: 9 } }, 'test');
  await a.wc.save('immediate');
  a.wc.client.destroy();
  ls.setItem(LEGACY_SAVE_KEY, JSON.stringify({ player: { ...createNewPlayer({ captainName: 'Old' }), stats: stats(2) } }));
  const b = nodeWarpcrew({ localStorage: ls, playerId: 'deeper' });
  assert.equal((await b.wc.boot()).importedLegacy, false);
  assert.equal(b.wc.state().captainName, 'Core');
  assert.equal(ls.getItem(LEGACY_SAVE_KEY), null, 'retired either way');
  b.wc.client.destroy();
}

// ── QA ?fresh=1 offline clears this device; restart offline clears it too ──
{
  const ls = memoryStorage();
  const a = nodeWarpcrew({ localStorage: ls, playerId: 'fresh' });
  await a.wc.boot();
  a.wc.commit({ ...a.wc.state(), stats: { ...a.wc.state().stats, jumps: 4 } }, 'test');
  await a.wc.save('immediate');
  a.wc.client.destroy();
  const b = nodeWarpcrew({ localStorage: ls, playerId: 'fresh' });
  await b.wc.boot({ fresh: true });
  assert.equal(b.wc.progress(), 0);
  b.wc.commit({ ...b.wc.state(), stats: { ...b.wc.state().stats, jumps: 2 } }, 'test');
  await b.wc.save('immediate');
  const r = await b.wc.restart();
  assert.deepEqual(r, { ok: true, reload: true });
  assert.equal(ls.getItem(b.wc.slotKey('fresh')), null, 'restart offline leaves no save to reload');
}

// ── Engine `set` refuses a shallower player; a follower tab never writes ──
{
  const { wc } = nodeWarpcrew({ playerId: 'refuse' });
  await wc.boot();
  wc.commit({ ...wc.state(), stats: { ...wc.state().stats, jumps: 3 } }, 'test');
  assert.equal(wc.commit({ ...wc.state(), stats: { ...wc.state().stats, jumps: 1 } }, 'test'), false);
  assert.equal(wc.progress(), 3);
  wc.client.destroy();

  const ls = memoryStorage();
  const heldElsewhere = { request: async (_name, opts, cb) => (opts.ifAvailable ? cb(null) : new Promise(() => {})) };
  const follower = createWarpcrew({
    config: { serverUrl: null, gameId: 'warpcrew', buildVersion: 't', mockPlayerId: 'tabs', dev: true },
    localStorage: ls, locks: heldElsewhere, channel: null, spool: null, requestPersist: false, sendBeacon: null,
    scheduler: { request: () => 0, cancel() {} },
  });
  await follower.boot();
  assert.equal(follower.client.leader.isLeader(), false);
  const before = follower.state();
  assert.equal(follower.session('splash-dismiss', {}, {}).result.reason, 'not_leader');
  assert.equal(follower.commit({ ...before, captainName: 'X' }, 'test'), false);
  assert.equal(follower.state(), before);
  follower.client.destroy();
}

// ── The single grant path covers exactly the server vocabulary ──
{
  assert.deepEqual([...GRANT_KINDS].sort(), ['item:drydockFinishes', 'premium_currency', 'soft_currency:credits', 'soft_currency:fuel', 'soft_currency:medals']);
  const used = new Set(Object.values(PRODUCT_DEFS).flatMap((d) => rewardsFromTable(d.grant).map(grantKindOf)));
  assert.deepEqual([...used].sort(), [...GRANT_KINDS].sort(), 'every kind a product grants, and nothing else');
  const p = { ...createNewPlayer(), wallet: { credits: 0, gems: 0, medals: 0, fuel: 9 }, fuelMax: 10 };
  const r = applyGrantRewards(p, [
    { kind: 'premium_currency', amount: 250 },
    { kind: 'soft_currency', currency: 'credits', amount: 800 },
    { kind: 'soft_currency', currency: 'medals', amount: 50 },
    { kind: 'soft_currency', currency: 'fuel', amount: 10 },
    { kind: 'item', itemId: 'drydockFinishes', qty: 2 },
    { kind: 'cosmetic', cosmeticId: 'hat' },
    { kind: 'soft_currency', currency: 'reputation', amount: 5 },
  ], { oneTimeSku: 'wc_starter_kit' });
  assert.deepEqual(r.player.wallet, { credits: 800, gems: 250, medals: 50, fuel: 10 }, 'fuel clamps to the tank');
  assert.equal(r.player.drydockFinishes, 2);
  assert.deepEqual(r.unknown, ['cosmetic', 'soft_currency:reputation'], 'outside the vocabulary: reported, not applied');
  assert.deepEqual(r.player.oneTimePurchases, ['wc_starter_kit']);
  assert.equal(applyGrantRewards(r.player, [], { oneTimeSku: 'wc_starter_kit' }).player.oneTimePurchases.length, 1);
  assert.equal(applyGrantRewards(p, [], { oneTimeSku: 'wc_gems_s' }).player.oneTimePurchases, undefined, 'gem packs are never owned');
  assert.equal(oneTimeSkuOf({ reason: 'purchase wc_wall_spur' }), 'wc_wall_spur');
  assert.equal(oneTimeSkuOf({ reason: 'purchase wc_gems_s' }), null);
  assert.equal(oneTimeSkuOf({ reason: 'support make-good' }), null);
  assert.deepEqual(markOwned({ oneTimePurchases: ['wc_wall_spur'] }, ['wc_starter_kit', 'wc_gems_s', 'nope']).oneTimePurchases, ['wc_wall_spur', 'wc_starter_kit']);
}

// ── Milestones, purchases and wall breaks save at once; the rest is routine ──
{
  const p = createNewPlayer();
  assert.equal(savePriorityFor(p, { ...p, captainName: 'x' }), 'routine');
  assert.equal(savePriorityFor(p, { ...p, stats: { ...p.stats, contractsCompleted: 1 } }), 'immediate');
  assert.equal(savePriorityFor(p, { ...p, flags: { wall_spur: true } }), 'immediate');
  assert.equal(savePriorityFor(p, { ...p, story: { ...p.story, chapter: 1 } }), 'immediate');
  assert.equal(savePriorityFor(p, { ...p, oneTimePurchases: ['wc_starter_kit'] }), 'immediate');
}

// ── Subscriptions: Jest's signed list goes to the core verifier with the player's token ──
{
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/subscriptions/verify')) {
      return new Response(JSON.stringify({ outcome: 'verified', issuedAt: 1234, subscriptions: [{ sku: 'wc_sub_commission', active: true, status: 'active', sandbox: false, trialEligible: false, retentionOffer: null, price: 999, currency: 'USD', billingPeriod: 'monthly' }], serverNow: Date.now() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  };
  const { wc } = nodeWarpcrew({ serverUrl: 'http://127.0.0.1:9', fetch, playerId: 'subs', sync: { headCheckMs: 50, bootRepushMs: 50 } });
  wc.client.bootMachine.onChange((s) => { if (s.phase === 'cloudUnreachable') wc.client.bootMachine.startNew(); });
  await wc.boot();
  const ok = await wc.verifySubscriptions('SIGNED-LIST');
  assert.equal(ok.ok, true);
  assert.equal(ok.data.issuedAt, 1234);
  assert.equal(ok.data.subscriptions[0].active, true);
  const call = calls.find((c) => c.url.endsWith('/v1/subscriptions/verify'));
  const body = JSON.parse(call.init.body);
  assert.equal(body.subscriptionsSigned, 'SIGNED-LIST');
  assert.ok(body.commandId);
  assert.equal(call.init.headers['x-player-key'], 'subs');
  assert.match(call.init.headers.authorization, /^Bearer mock\.subs\./);
  assert.equal((await wc.verifySubscriptions('')).ok, false, 'an unsigned (mock) list is never sent');
  wc.client.destroy();
}

console.log('cloud_sync.test.mjs OK');
