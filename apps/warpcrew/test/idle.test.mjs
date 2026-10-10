// Income while away (Phase 2 design §4): staffed stations earn, the hold caps it, time never runs backwards.
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { idleRates, idleHaul, claimIdle, startIdleClock, holdHours, IDLE_RATES, HOLD_HOURS } from '../src/systems/idle.js';
import { assignStation } from '../src/systems/stations.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';

const HOUR = 3600000;
const t0 = Date.UTC(2026, 9, 10, 8);
let player = createNewPlayer({ tutorialScript: 5, now: t0, rng: () => 0.5 });
assert.equal(idleHaul(player, t0 + 10 * HOUR).ready, false, 'nothing before the clock starts');
assert.equal(claimIdle(player, t0).reason, 'idle_not_started');

// Hold size: 8 hours at Cargo 1, +1 hour a level, 16 at most.
assert.equal(holdHours(player), HOLD_HOURS.base);
assert.equal(holdHours({ ...player, ship: { ...player.ship, systems: { ...player.ship.systems, cargo: 4 } } }), 11);
assert.equal(holdHours({ ...player, ship: { ...player.ship, systems: { ...player.ship.systems, cargo: 30 } } }), HOLD_HOURS.max);

// A crew after the tutorial, home from the away mission, at their stations; the rate follows who is at a station.
player = completeFreshTutorial();
player = { ...player, crew: player.crew.map(c => ({ ...c, status: 'ready' })) };
const stations = { pilot: 'helm', engineer: 'engineering', gunner: 'weapons' };
for (const member of player.crew) player = assignStation(player, member.instanceId, stations[member.role], t0).player;
const rates = idleRates(player, t0);
assert.equal(rates.staffed, 3);
assert.equal(rates.credits, 3 * (IDLE_RATES.creditsPerStation + IDLE_RATES.roleBonus) + player.crew.reduce((n, c) => n + (c.level || 1), 0) * IDLE_RATES.perCrewLevel,
  'each station: base, its own role, crew level');
assert.equal(rates.medals, IDLE_RATES.engineeringMedalsPerHour, 'Engineering trickles medals');
player = startIdleClock(player, t0);
assert.equal(startIdleClock(player, t0 + HOUR).idle.since, t0, 'starting twice does not reset the clock');

// Four hours: four hours of income; a clock set in the future (device time) pays nothing and never goes negative.
const four = idleHaul(player, t0 + 4 * HOUR);
assert.equal(four.credits, Math.floor(rates.credits * 4));
assert.equal(four.full, false);
assert.equal(idleHaul(player, t0 - 5 * HOUR).credits, 0);

// The hold caps it: 30 hours away pays the same as 8.
const long = idleHaul(player, t0 + 30 * HOUR);
assert.equal(long.credits, Math.floor(rates.credits * 8));
assert.equal(long.full, true);

// Collecting pays once and restarts the clock.
const claimed = claimIdle(player, t0 + 30 * HOUR);
assert.ok(claimed.ok);
assert.equal(claimed.player.wallet.credits, player.wallet.credits + long.credits);
assert.equal(claimed.player.idle.since, t0 + 30 * HOUR);
assert.equal(claimIdle(claimed.player, t0 + 30 * HOUR + 60000).reason, 'hold_empty');

// Nobody at a station: nothing builds up.
const empty = { ...player, stationAssignments: {} };
assert.equal(idleHaul(empty, t0 + 8 * HOUR).credits, 0);
assert.equal(idleHaul(empty, t0 + 8 * HOUR).ready, false);

console.log('idle: OK');
