import assert from 'node:assert/strict';
import { evaluateWallPackOffer, wallPackState, markWallPackSeen, packValue, WALL_PACK_STUCK_MS } from '../src/systems/offers.js';
import { WALLS, recordSiege } from '../src/systems/walls.js';
import { PRODUCT_DEFS } from '../src/systems/iap.js';
import { applyGrantRewards, rewardsFromTable } from '../src/core/grants.js';
import { renderWallPack } from '../src/ui/bridge.js';

const now = Date.UTC(2030, 8, 22, 12);
const spur = WALLS[0];
const base = { flags: {}, siege: {}, wallet: { gems: 0, credits: 0, medals: 0, fuel: 0, reputation: 0 }, oneTimePurchases: [] };

// Nothing yet: no near miss and not stuck.
assert.equal(evaluateWallPackOffer({ ...base, siege: { spur: { firstSeenAt: now } } }, spur, now + 1000).offers, undefined);

// Stuck for two days triggers it.
const stuck = evaluateWallPackOffer({ ...base, siege: { spur: { firstSeenAt: now } } }, spur, now + WALL_PACK_STUCK_MS);
assert.equal(stuck.offers.walls.spur.reason, 'stuck');

// A lost attempt that left the segment at 20% or less is a near miss.
const contract = { wall: { id: 'spur' }, result: { success: false, wall: { id: 'spur', segment: 42, dealt: 36, defeated: false } } };
const nearMissPlayer = recordSiege({ ...base }, contract, now);
assert.equal(nearMissPlayer.siege.spur.nearMiss, true);
const offered = evaluateWallPackOffer(nearMissPlayer, spur, now);
assert.equal(offered.offers.walls.spur.reason, 'near_miss');
const farContract = { ...contract, result: { ...contract.result, wall: { ...contract.result.wall, dealt: 10 } } };
assert.equal(recordSiege({ ...base }, farContract, now).siege.spur.nearMiss, false);

// Live until bought or the wall falls; the pop-up shows once.
let state = wallPackState(offered, spur);
assert.equal(state.active, true);
assert.equal(state.showModal, true);
assert.equal(wallPackState(markWallPackSeen(offered, 'spur'), spur).showModal, false);
const bought = applyGrantRewards(offered, rewardsFromTable(PRODUCT_DEFS.wc_wall_spur.grant), { oneTimeSku: 'wc_wall_spur' }).player;
assert.equal(wallPackState(bought, spur).active, false, 'bought once');
assert.equal(bought.drydockFinishes, 1);
const reoffer = { ...bought, offers: {} };
assert.equal(evaluateWallPackOffer(reoffer, spur, now), reoffer, 'never re-offered after purchase');
assert.equal(wallPackState({ ...offered, flags: { wall_spur: true } }, spur).active, false, 'gone once the wall falls');

// Honest value: compared with the same-price gem pack; fuel at its gem price.
const value = packValue('wc_wall_spur', [{ sku: 'wc_gems_m', price: 4.99 }, { sku: 'wc_wall_spur', price: 4.99 }]);
assert.equal(value.gemValue, 400);
assert.equal(value.morePct, 43);
// A pricier pack is compared per dollar (Codex audit): $7.99 Veil vs $4.99 Gem Pack.
const veil = packValue('wc_wall_veil', [{ sku: 'wc_gems_m', price: 4.99 }, { sku: 'wc_wall_veil', price: 7.99 }]);
assert.equal(veil.gemValue, 550);
assert.equal(veil.morePct, 23);
const html = renderWallPack(state, value, { modal: true });
assert.match(html, /Corsair Breaker Pack/);
assert.match(html, /43% more than the \$4\.99 Gem Pack/);
assert.match(html, /data-act="iap-buy" data-sku="wc_wall_spur">\$4\.99/);
assert.match(html, /data-act="wall-pack-dismiss" data-wall="spur"/);
assert.match(html, /\+ 1 instant drydock finish/);

console.log('wall_packs.test.mjs OK');
