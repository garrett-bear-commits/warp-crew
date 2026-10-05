import assert from 'node:assert/strict';
import { PRODUCT_DEFS } from '../src/systems/iap.js';
import { createNewPlayer } from '../src/systems/player.js';
import { NOTIF_IDS, syncFuelFullNotification } from '../src/systems/notifications.js';
import { getMockLog, getMockScheduled, init, getProducts } from '../src/shared/platform.js';
import { applyGrantRewards, rewardsFromTable } from '../src/core/grants.js';
import { nodeWarpcrew } from './helpers/coreClient.mjs';

await init();
const p0 = createNewPlayer();
// The single grant path: a products.js grant as core rewards.
const granted = applyGrantRewards(p0, rewardsFromTable(PRODUCT_DEFS.wc_gems_s.grant)).player;
assert.equal(granted.wallet.gems, p0.wallet.gems + 100, 'gem grant');

// No server (the Pages QA build): the core's local mock checkout delivers on the device.
const { wc } = nodeWarpcrew({ playerId: 'iap-offline' });
await wc.boot();
const before = wc.state();
const buy = await wc.purchases.buy('wc_starter_kit');
assert.equal(buy.ok, true, 'local mock purchase');
assert.ok(wc.state().wallet.fuel >= before.wallet.fuel, 'fuel granted (clamped to the tank)');
assert.equal(wc.state().wallet.gems, before.wallet.gems + 250);
// One-time packs cannot be bought twice; the drydock token grant lands outside the wallet.
assert.ok(wc.state().oneTimePurchases.includes('wc_starter_kit'), 'one-time purchase recorded');
assert.equal((await wc.purchases.buy('wc_starter_kit')).reason, 'already_owned', 'one-time pack sold twice');
assert.equal((await wc.purchases.buy('wc_wall_spur')).ok, true);
assert.equal(wc.state().drydockFinishes, 1, 'drydock finish token');
assert.ok(!Object.hasOwn(wc.state().wallet, 'drydockFinishes'), 'token leaked into wallet');
assert.equal((await wc.purchases.buy('nope')).reason, 'unknown_sku');
assert.ok(wc.platform.payments, 'core payments provider');
wc.client.destroy();

// No product below the $1.99 floor.
assert.ok(!(await getProducts()).some((product) => product.price < 199), 'product below $1.99');

// Drain some fuel so fuel-full schedules
const p = { ...granted, wallet: { ...granted.wallet, fuel: 2 }, fuelClaimAt: Date.now() };
await syncFuelFullNotification(p);
const scheduled = getMockScheduled();
if (!scheduled.some((s) => s.id === NOTIF_IDS.fuelFull || s.identifier === NOTIF_IDS.fuelFull)) {
  // mock map uses identifier as key
  const log = getMockLog();
  const hit = log.some((x) => x.type === 'scheduleNotification' && x.options?.identifier === NOTIF_IDS.fuelFull);
  if (!hit && !scheduled.length) throw new Error('expected fuel full schedule');
}

console.log('platform_iap.test.mjs OK');
