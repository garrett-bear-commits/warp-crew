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

// No real checkout opens without a verifier (real Jest is simulated here).
globalThis.window = { JestSDK: { getPlayer: () => ({ playerId: 'real-player-1' }), payments: { beginPurchase: () => { throw new Error('checkout must not open'); } } } };
const platform = await import('../src/shared/platform.js');
assert.equal(platform.isReal(), true, 'the simulated Jest SDK counts as real');
const { buyProduct } = await import('../src/systems/iap.js');
const res = await buyProduct({ wallet: {}, oneTimePurchases: [] }, 'wc_gems_s');
assert.equal(res.reason, 'store_unavailable');
delete globalThis.window;

// Final audit: a save from before cloud save existed is never silently dropped.
const { chooseSave, carryPurchases, withPurchaseSkus } = await import('../src/systems/cloudSync.js');
const cloudBlob = (player, seq = 3) => ({ seq, savedAt: 1, blob: JSON.stringify({ player, savedAt: 1 }) });
const tutorialLocal = { wallet: { gems: 0 }, crew: [{}, {}], tutorial: { completed: false }, stats: {}, lastSavedAt: 5 };
const oneCrewCloud = { wallet: { gems: 0 }, crew: [{}], tutorial: { completed: false }, stats: {} };
const kept = chooseSave(tutorialLocal, cloudBlob(oneCrewCloud));
assert.equal(kept.source, 'local', 'more progress on a never-synced device wins');
assert.ok(kept.archived, 'the other side is archived');
const deferred = chooseSave({ ...oneCrewCloud, lastSavedAt: 99 }, cloudBlob(oneCrewCloud));
assert.equal(deferred.source, 'cloud', 'on a tie a never-synced device defers to the cloud');
assert.ok(deferred.archived, 'and its save is archived, not dropped');

// Legacy grants (no token→SKU record in the save) are re-granted from the server's provenance.
const legacyLoser = { wallet: { gems: 280 }, iapFulfilled: ['legacy-paid-token'], crew: [], stats: {} };
const winner = { wallet: { gems: 0 }, iapFulfilled: [], crew: [], stats: {} };
const merged = carryPurchases(winner, legacyLoser, { 'legacy-paid-token': 'wc_gems_m' });
assert.equal(merged.wallet.gems, 280);
assert.deepEqual(merged.iapFulfilled, ['legacy-paid-token']);
const unmapped = carryPurchases(winner, legacyLoser, {});
assert.deepEqual(unmapped.iapFulfilled, [], 'an unmapped token is never marked as carried');
assert.equal(carryPurchases(winner, { ...legacyLoser, iapFulfilled: ['local_wc_gems_s_123'] }).wallet.gems, 100, 'mock tokens name their SKU');
assert.equal(withPurchaseSkus({ iapFulfilled: ['a'] }, { a: 'wc_gems_s', b: 'wc_gems_m' }).purchaseSkus.a, 'wc_gems_s');

// One-time packs: the server is asked before any checkout opens.
const checkouts = () => platform.getMockLog().filter(e => e.type === 'purchase' && e.productSku === 'wc_starter_kit').length;
globalThis.window = { JestSDK: { getPlayer: () => ({ playerId: 'real-player-1' }), payments: {} } };
const verifyReceipt = async () => ({ ok: false });
const owned = await buyProduct({ wallet: {}, oneTimePurchases: [] }, 'wc_starter_kit', { verifyReceipt, checkOwned: async () => ({ ok: true, data: { oneTime: ['wc_starter_kit'] } }) });
assert.equal(owned.reason, 'already_owned');
assert.deepEqual(owned.player.oneTimePurchases, ['wc_starter_kit'], 'and the pack is hidden on this device');
assert.equal((await buyProduct({ wallet: {} }, 'wc_starter_kit', { verifyReceipt, checkOwned: async () => ({ ok: false }) })).reason, 'store_unavailable', 'no ownership answer, no checkout');
assert.equal(checkouts(), 0);
await buyProduct({ wallet: {} }, 'wc_starter_kit', { verifyReceipt, checkOwned: async () => ({ ok: true, data: { oneTime: [] } }) });
assert.equal(checkouts(), 1, 'checkout opens only once the server confirms it is not owned');
delete globalThis.window;

// No build flag re-enables the ?server= override outside development.
const { readFileSync } = await import('node:fs');
assert.ok(!readFileSync(new URL('../src/shared/cloud.js', import.meta.url), 'utf8').includes('VITE_ALLOW_SERVER_OVERRIDE'));

console.log('audit_fixes.test.mjs OK');
