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

console.log('audit_fixes.test.mjs OK');
