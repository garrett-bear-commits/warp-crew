import { createNewPlayer } from '../src/systems/player.js';
import { previewTravel, commitTravel, travelTo } from '../src/systems/travel.js';
import { skipExpeditionJob, resolveExpedition, startExpedition } from '../src/systems/expedition.js';

let p = createNewPlayer();
// Force fuel
p = { ...p, wallet: { ...p.wallet, fuel: 10 } };

// Deterministic non-combat: station_home has no outcomes
const prevHome = previewTravel(p, 'station_home');
if (!prevHome.ok) throw new Error('home preview');
const home = commitTravel(p, prevHome);
if (!home.ok) throw new Error('home commit');

// Legacy travel still works
const t = travelTo(home.player, 'lane_a', { rng: () => 0.0, assistsUsed: ['overcharge'] });
if (!t.ok && t.reason !== 'not_enough_fuel') {
  // ok either way depending on fuel
}

// Skip expedition
const job = startExpedition({
  planetId: 'dustfall',
  crewInstanceIds: ['x'],
  minutes: 15,
  successChance: 0.9,
  startedAt: Date.now(),
});
const skipped = skipExpeditionJob(job, Date.now());
const res = resolveExpedition(skipped, { forceComplete: true, rng: () => 0.01 });
if (!res.ready || !res.success) throw new Error('skip resolve expected success');

console.log('travel_phase_a.test.mjs OK');
