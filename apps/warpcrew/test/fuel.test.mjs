import { createNewPlayer } from '../src/systems/player.js';
import { claimFuelRegen, spendFuel, fuelStatus } from '../src/systems/fuel.js';
import { MS_PER_HOUR } from '../src/shared/timer.js';

let p = createNewPlayer();
const startFuel = p.wallet.fuel;
const spent = spendFuel(p, 2);
if (!spent.ok) throw new Error('spend failed');
p = spent.player;
if (p.wallet.fuel !== startFuel - 2) throw new Error('fuel not spent');

// Simulate 2 hours offline
p = { ...p, fuelClaimAt: p.fuelClaimAt - 2 * MS_PER_HOUR };
const claimed = claimFuelRegen(p, p.fuelClaimAt + 2 * MS_PER_HOUR);
if (claimed.gained < 2) throw new Error('expected >=2 fuel claim, got ' + claimed.gained);

const st = fuelStatus(claimed.player);
if (st.max < st.current) throw new Error('current > max');

console.log('fuel.test.mjs OK');
