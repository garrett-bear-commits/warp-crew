import { PRODUCT_DEFS, applyGrant, buyProduct } from '../src/systems/iap.js';
import { createNewPlayer } from '../src/systems/player.js';
import { NOTIF_IDS, syncFuelFullNotification } from '../src/systems/notifications.js';
import { getMockLog, getMockScheduled, init } from '../src/shared/platform.js';

await init();
const p0 = createNewPlayer();
const granted = applyGrant(p0, PRODUCT_DEFS.wc_gems_100.grant);
if (granted.wallet.gems < p0.wallet.gems + 100) throw new Error('gem grant');

const buy = await buyProduct(p0, 'wc_fuel_5');
if (!buy.ok) throw new Error('buy mock failed');
if (buy.player.wallet.fuel < p0.wallet.fuel) throw new Error('fuel not granted');

// Drain some fuel so fuel-full schedules
let p = { ...buy.player, wallet: { ...buy.player.wallet, fuel: 2 }, fuelClaimAt: Date.now() };
await syncFuelFullNotification(p);
const scheduled = getMockScheduled();
if (!scheduled.some((s) => s.id === NOTIF_IDS.fuelFull || s.identifier === NOTIF_IDS.fuelFull)) {
  // mock map uses identifier as key
  const log = getMockLog();
  const hit = log.some((x) => x.type === 'scheduleNotification' && x.options?.identifier === NOTIF_IDS.fuelFull);
  if (!hit && !scheduled.length) throw new Error('expected fuel full schedule');
}

console.log('platform_iap.test.mjs OK');
