// Shop value badges (Phase 2 design §6): computed from real prices, rounded down, never invented.
import assert from 'node:assert/strict';
import { gemLadderValues } from '../src/systems/offers.js';
import { GEM_LADDER } from '../src/systems/iap.js';

const prices = { wc_gems_s: 1.99, wc_gems_m: 4.99, wc_gems_l: 9.99, wc_gems_xl: 19.99, wc_gems_xxl: 49.99 };
const products = Object.entries(prices).map(([sku, price]) => ({ sku, price }));
const v = gemLadderValues(products);
assert.deepEqual(GEM_LADDER.map(sku => v[sku].morePct), [0, 11, 19, 29, 39], 'gems per dollar against the pouch, rounded down');
assert.deepEqual(GEM_LADDER.filter(sku => v[sku].best), ['wc_gems_xxl'], 'one best-value pack: the most gems per dollar');

// No prices (store not loaded): no badges at all rather than guessed ones.
assert.deepEqual(gemLadderValues([{ sku: 'wc_gems_m', price: null }]), {});
assert.deepEqual(gemLadderValues([]), {});
// A badge never invents value: a pack priced worse than the pouch shows 0, not a negative or a made-up number.
const worse = gemLadderValues([{ sku: 'wc_gems_s', price: 1.99 }, { sku: 'wc_gems_m', price: 19.99 }]);
assert.equal(worse.wc_gems_m.morePct, 0);
assert.equal(worse.wc_gems_m.best, false);

console.log('shop_values: OK');
