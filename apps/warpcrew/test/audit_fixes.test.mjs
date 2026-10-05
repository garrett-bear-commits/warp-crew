import assert from 'node:assert/strict';
import { refuelWithGems, FUEL_REFILL } from '../src/systems/gemSinks.js';
import { recordSiege } from '../src/systems/walls.js';

// Gem refuel only sells a full refill.
const wallet = { gems: 100, fuel: 9 };
assert.equal(refuelWithGems({ wallet, fuelMax: 10 }).reason, 'fuel_full', 'never 50 gems for 1 fuel');
const ok = refuelWithGems({ wallet: { gems: 100, fuel: 5 }, fuelMax: 10 });
assert.equal(ok.player.wallet.fuel, 10);
assert.equal(ok.player.wallet.gems, 100 - FUEL_REFILL.gems);

// A near miss on a wall stays remembered after a worse attempt.
const now = Date.UTC(2030, 8, 22, 12);
const attempt = (dealt) => ({ wall: { id: 'spur' }, result: { success: false, wall: { id: 'spur', segment: 42, dealt, defeated: false } } });
let player = recordSiege({ flags: {} }, attempt(38), now);
assert.equal(player.siege.spur.nearMiss, true);
player = recordSiege(player, attempt(5), now);
assert.equal(player.siege.spur.nearMiss, true, 'a later bad loss does not erase the near miss');

// No real checkout opens without a server: the Jest platform (real payments) is selected only
// when a server is configured; without one the core's local mock is used, which no money backs.
const { createWarpcrew } = await import('../src/core/client.js');
const { memoryStorage, memorySpool, manualScheduler } = await import('@foundation/client');
const jestSdkUsed = [];
const fakeSdk = new Proxy({}, { get: (_t, key) => { jestSdkUsed.push(String(key)); return () => { throw new Error('the Jest SDK must not be used'); }; } });
const offline = createWarpcrew({
  config: { serverUrl: null, gameId: 'warpcrew', buildVersion: 't', mockPlayerId: 'audit', dev: false },
  platformKind: 'jest', sdk: fakeSdk, localStorage: memoryStorage(), locks: null, channel: null,
  spool: memorySpool(), requestPersist: false, scheduler: manualScheduler(), sendBeacon: null,
});
assert.equal(offline.platform.name, 'mock', 'no server, no Jest payments');
assert.deepEqual(jestSdkUsed, []);
offline.client.destroy();

// One-time packs: the server is asked before any checkout opens. No answer, no checkout.
const { createPurchases } = await import('../src/core/purchases.js');
let begins = 0;
const payments = { begin: async () => { begins++; return { kind: 'cancel' }; }, complete: async () => ({ kind: 'success' }) };
let me = { wallet: {}, oneTimePurchases: [] };
const purchasesWith = (owned) => createPurchases({
  api: { purchases: { owned } },
  payments,
  player: () => me,
  applyGrant: () => true,
  markOwned: (skus) => { me = { ...me, oneTimePurchases: [...new Set([...me.oneTimePurchases, ...skus])] }; },
});
assert.equal((await purchasesWith(async () => ({ ok: false, status: 0 })).buy('wc_starter_kit')).reason, 'store_unavailable', 'no ownership answer, no checkout');
assert.equal(begins, 0);
assert.equal((await purchasesWith(async () => ({ ok: true, body: { oneTime: ['wc_starter_kit'] } })).buy('wc_starter_kit')).reason, 'already_owned');
assert.deepEqual(me.oneTimePurchases, ['wc_starter_kit'], 'and the pack is hidden on this device');
assert.equal(begins, 0);
me = { wallet: {}, oneTimePurchases: [] };
await purchasesWith(async () => ({ ok: true, body: { oneTime: [] } })).buy('wc_starter_kit');
assert.equal(begins, 1, 'checkout opens only once the server confirms it is not owned');
// A gem pack (not one time) needs no ownership answer.
await purchasesWith(async () => { throw new Error('not asked'); }).buy('wc_gems_s');
assert.equal(begins, 2);

// No build flag re-enables the ?server= override outside development, and a remembered one is cleared.
const { readConfig } = await import('../src/core/config.js');
const store = memoryStorage();
store.setItem('wc.server', 'https://evil.example');
const prod = readConfig({ env: { VITE_WARPCREW_SERVER: 'https://api.example' }, search: '?server=https://evil.example', storage: store, dev: false });
assert.equal(prod.serverUrl, 'https://api.example');
assert.equal(store.getItem('wc.server'), null);
const pages = readConfig({ env: {}, search: '?server=https://evil.example', storage: store, dev: false });
assert.equal(pages.serverUrl, null, 'the Pages QA build has no server and plays offline');
const dev = readConfig({ env: {}, search: '?server=http://localhost:8080&player=qa_1', storage: store, dev: true });
assert.equal(dev.serverUrl, 'http://localhost:8080');
assert.equal(dev.mockPlayerId, 'qa_1');
assert.equal(readConfig({ env: {}, search: '?server=http://evil.example', storage: memoryStorage(), dev: true }).serverUrl, null, 'plain http only on loopback');
const { readFileSync } = await import('node:fs');
assert.ok(!readFileSync(new URL('../src/core/config.js', import.meta.url), 'utf8').includes('VITE_ALLOW_SERVER_OVERRIDE'));

console.log('audit_fixes.test.mjs OK');
