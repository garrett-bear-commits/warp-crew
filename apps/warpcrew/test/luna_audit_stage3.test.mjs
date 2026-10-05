// Regression tests for the Luna audit of stage 3 (seven findings). Each block failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { memoryStorage, memorySpool } from '@foundation/client';
import { createPurchases } from '../src/core/purchases.js';
import { createWarpcrew } from '../src/core/client.js';
import { LEGACY_SAVE_KEY } from '../src/core/legacy.js';
import { applyEntitlements, commissionActive, refreshCommission, ENTITLEMENT_GRACE_MS } from '../src/systems/subscription.js';
import { createNewPlayer } from '../src/systems/player.js';
import { applyDailyLogin, dayKey } from '../src/systems/daily.js';
import { useClock } from '../src/shared/time.js';
import { nodeWarpcrew, stillLifecycle } from './helpers/coreClient.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const grant = (key = 'purchase:abc', sku = 'wc_gems_s') => ({ grantKey: key, source: 'purchase', reason: `purchase ${sku}`, rewards: [{ kind: 'premium_currency', amount: 100 }], createdAt: 1 });

/** Web Locks held by another tab until this one steals them ("Play here"). */
const locksHeldElsewhere = () => ({
  request: async (_name, opts, cb) => (opts.steal ? cb({}) : opts.ifAvailable ? cb(null) : new Promise(() => {})),
});

// ── 1. Only the leader claims or recovers; a follower defers until it leads ──
test('1: a follower tab never claims a grant or recovers purchases; it does so once it leads', async () => {
  const calls = [];
  const fetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/v1/saves/current') return json({ generation: 0, snapshot: null, serverNow: Date.now() });
    if (path === '/v1/grants/pending') return json({ grants: [grant()], grantsFrozen: false, serverNow: Date.now() });
    if (path === '/v1/grants/claim') return json({ outcome: 'claimed', duplicate: false, grant: grant(), serverNow: Date.now() });
    if (path === '/v1/purchases/owned') return json({ oneTime: [], serverNow: Date.now() });
    if (path === '/v1/saves') return json({ outcome: 'stored', serverNow: Date.now() });
    return json({ error: 'not_found' }, 404);
  };
  const wc = createWarpcrew({
    config: { serverUrl: 'http://wc.test', gameId: 'warpcrew', buildVersion: 't', mockPlayerId: 'follower', dev: true },
    localStorage: memoryStorage(), locks: locksHeldElsewhere(), channel: null, spool: memorySpool(), requestPersist: false,
    sendBeacon: null, lifecycle: stillLifecycle(), scheduler: { request: () => 0, cancel() {} }, fetch,
    sync: { headCheckMs: 200, bootRepushMs: 50 },
  });
  await wc.boot();
  assert.equal(wc.client.leader.isLeader(), false);
  const before = wc.state().wallet.gems;
  const r = await wc.serverSync();
  assert.equal(r.deferred, true);
  assert.ok(!calls.includes('/v1/grants/claim'), 'a follower never claims');
  assert.ok(!calls.includes('/v1/grants/pending'));
  assert.deepEqual(await wc.purchases.claimPending(), { ok: false, deferred: true, claimed: [] });
  // "Play here": the tab leads, and the deferred work runs and applies the grant.
  await wc.client.playHere();
  await wc.whenServerSynced();
  assert.equal(calls.filter((p) => p === '/v1/grants/claim').length, 1);
  assert.equal(wc.state().wallet.gems, before + 100);
  wc.client.destroy();
});

test('1: recovery never completes a purchase whose grant claim failed', async () => {
  const completedTokens = [];
  const p = createPurchases({
    api: {
      purchases: { verifyBatch: async () => ({ ok: true, body: { outcome: 'processed', results: [{ purchaseToken: 't1', outcome: 'recorded', completion: 'ready', purchase: { grantKey: 'purchase:t1', sku: 'wc_gems_s' } }] } }) },
      grants: { claim: async () => ({ ok: false, status: 0 }) },
    },
    payments: { recoverIncompleteBatch: async (fn) => { const ready = await fn({ purchases: [{ purchaseToken: 't1', sku: 'wc_gems_s' }], purchasesSigned: 's', hasMore: false }); completedTokens.push(...ready); return { completed: ready }; } },
    player: () => createNewPlayer(),
    canApply: () => true,
    applyGrant: async () => true,
    markOwned: () => {},
  });
  await p.recover();
  assert.deepEqual(completedTokens, [], 'no claim, no completion');
});

// ── 2. Completion waits for the durable save of the applied grant ──
test('2: buy completes the Jest purchase only after the grant is applied and saved', async () => {
  const order = [];
  const saved = deferred();
  const mk = (applyResult) => createPurchases({
    api: {
      purchases: { verify: async () => ({ ok: true, body: { outcome: 'recorded', completion: 'ready', purchaseToken: 'tok', purchase: { grantKey: 'purchase:tok', sku: 'wc_gems_s' } } }) },
      grants: { claim: async () => ({ ok: true, body: { outcome: 'claimed', grant: grant('purchase:tok') } }) },
    },
    payments: { begin: async () => ({ kind: 'success', purchaseToken: 'tok', purchaseSigned: 'signed' }), complete: async () => { order.push('complete'); return { kind: 'success' }; } },
    player: () => createNewPlayer(),
    canApply: () => true,
    applyGrant: async () => { order.push('apply'); const ok = await applyResult; order.push('saved'); return ok; },
    markOwned: () => {},
  });
  const running = mk(saved.promise).buy('wc_gems_s');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['apply'], 'not completed while the save is in flight');
  saved.resolve(true);
  assert.equal((await running).ok, true);
  assert.deepEqual(order, ['apply', 'saved', 'complete']);
  order.length = 0;
  const failed = await mk(Promise.resolve(false)).buy('wc_gems_s');
  assert.equal(failed.ok, false);
  assert.ok(!order.includes('complete'), 'a grant not saved is never completed');
});

test('2: the client applyGrant resolves true only once the device slot holds the grant', async () => {
  const { wc, localStorage } = nodeWarpcrew({ playerId: 'durable' });
  await wc.boot();
  const ok = await wc.applyGrant(grant('local:x'));
  assert.equal(ok, true);
  const slot = JSON.parse(localStorage.getItem(wc.slotKey('durable')));
  assert.equal(slot.state.wallet.gems, 100, 'already on the device when applyGrant resolves');
  wc.client.destroy();
});

// ── 3. A malformed ownership answer is unknown: no checkout ──
test('3: a 2xx ownership answer without a oneTime string array opens no checkout', async () => {
  for (const body of [{}, { oneTime: 'wc_starter_kit' }, { oneTime: [1] }, null]) {
    let begins = 0;
    const p = createPurchases({
      api: { purchases: { owned: async () => ({ ok: true, body }) } },
      payments: { begin: async () => { begins++; return { kind: 'cancel' }; } },
      player: () => ({ wallet: {}, oneTimePurchases: [] }), canApply: () => true, applyGrant: async () => true, markOwned: () => {},
    });
    assert.equal((await p.buy('wc_starter_kit')).reason, 'store_unavailable', JSON.stringify(body));
    assert.equal(begins, 0);
    assert.equal((await p.refreshOwned()).ok, false);
  }
});

// ── 4. Subscription proofs carry the list's issuedAt ──
test('4: verifiedAt is the signed list issuedAt; an older proof never overrides a newer one', async () => {
  const NOW = Date.UTC(2030, 8, 27, 12);
  const base = createNewPlayer({ tutorialScript: 4 });
  const active = [{ sku: 'wc_sub_commission', active: true, trialEligible: false, retentionOffer: null }];
  const signedEarly = applyEntitlements(base, active, NOW, { issuedAt: NOW - 23 * 3600_000 });
  assert.equal(signedEarly.commission.verifiedAt, NOW - 23 * 3600_000, 'grace runs from the proof');
  assert.equal(commissionActive(signedEarly, NOW - 23 * 3600_000 + ENTITLEMENT_GRACE_MS + 1), false);
  const cancelled = applyEntitlements(signedEarly, [{ sku: 'wc_sub_commission', active: false }], NOW, { issuedAt: NOW });
  const replay = applyEntitlements(cancelled, active, NOW + 60_000, { issuedAt: NOW - 3600_000 });
  assert.equal(replay.commission.active, false, 'replaying an older signed active list after a cancel does nothing');
  // Through refreshCommission with the core verifier's response shape.
  const sdk = { getSubscriptions: async () => ({ subscriptions: [], signed: 'SIGNED' }) };
  const verify = async () => ({ ok: true, data: { subscriptions: active, issuedAt: NOW - 5 * 3600_000 } });
  const refreshed = await refreshCommission(base, { sdk, real: true, verify, now: () => NOW });
  assert.equal(refreshed.player.commission.verifiedAt, NOW - 5 * 3600_000);
  // A verified real proof with no issuedAt is not trusted.
  const noIat = await refreshCommission(base, { sdk, real: true, verify: async () => ({ ok: true, data: { subscriptions: active } }), now: () => NOW });
  assert.equal(noIat.ok, false);
});

// ── 5. Inside the real Jest shell with no server, no purchase (and no mock grant) ──
test('5: real Jest shell, no server: purchasing is disabled, nothing granted locally', async () => {
  const wc = createWarpcrew({
    config: { serverUrl: null, gameId: 'warpcrew', buildVersion: 't', mockPlayerId: 'jest-noserver', dev: false },
    platformKind: 'jest', jestShell: true, localStorage: memoryStorage(), locks: null, channel: null, spool: memorySpool(),
    requestPersist: false, sendBeacon: null, lifecycle: stillLifecycle(), scheduler: { request: () => 0, cancel() {} },
  });
  await wc.boot();
  const gems = wc.state().wallet.gems;
  assert.equal((await wc.purchases.buy('wc_gems_s')).reason, 'store_unavailable');
  assert.equal(wc.state().wallet.gems, gems);
  wc.client.destroy();
});

// ── 6. Game rules read trusted time, never the bare device clock ──
test('6: time defaults are the trusted clock; no game rule reads Date.now()', () => {
  const T = Date.UTC(2031, 0, 15, 12);
  useClock({ now: () => T });
  try {
    const p = applyDailyLogin({ ...createNewPlayer({ now: T }), lastLoginDay: null }).player;
    assert.equal(p.lastLoginDay, dayKey(T));
  } finally {
    useClock(null);
  }
  const root = new URL('../src/', import.meta.url);
  const files = [
    'main.js',
    'shared/timer.js',
    ...readdirSync(new URL('systems/', root)).map((f) => `systems/${f}`),
    ...readdirSync(new URL('data/', root)).filter((f) => f.endsWith('.js')).map((f) => `data/${f}`),
    'ui/bridge.js',
    'ui/hudView.js',
  ];
  const offenders = files.filter((f) => /Date\.now\(\)/.test(readFileSync(new URL(f, root), 'utf8')));
  assert.deepEqual(offenders, []);
});

// ── 7. The legacy save never replaces an existing core save of equal depth ──
test('7: an equal-depth legacy save does not clobber a newer core save', async () => {
  const ls = memoryStorage();
  const a = nodeWarpcrew({ localStorage: ls, playerId: 'equal' });
  await a.wc.boot();
  a.wc.commit({ ...a.wc.state(), captainName: 'Core', stats: { ...a.wc.state().stats, jumps: 5 } }, 'test');
  await a.wc.save('immediate');
  a.wc.client.destroy();
  ls.setItem(LEGACY_SAVE_KEY, JSON.stringify({ player: { ...createNewPlayer({ captainName: 'Old' }), stats: { jumps: 5 } } }));
  const b = nodeWarpcrew({ localStorage: ls, playerId: 'equal' });
  assert.equal((await b.wc.boot()).importedLegacy, false);
  assert.equal(b.wc.state().captainName, 'Core');
  b.wc.client.destroy();
});
