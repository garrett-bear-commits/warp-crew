// Income while away (Phase 2 design §4): staffed stations earn, the hold caps it, time never runs backwards.
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { idleRates, idleHaul, claimIdle, startIdleClock, holdHours, IDLE_RATES, HOLD_HOURS } from '../src/systems/idle.js';
import { assignStation } from '../src/systems/stations.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { renderHoldChip, renderWelcomeBack } from '../src/ui/bridge.js';
import { holdFullAt, fuelFullAt, NOTIF_IDS } from '../src/systems/notifications.js';

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
assert.equal(startIdleClock(player, t0 - 5 * HOUR).idle.since, t0 - 5 * HOUR, 'a clock that ran backwards restarts at now');

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

// The clock starts when the tutorial ends (prepareSession), never during it.
const intro = createNewPlayer({ tutorialScript: 5, now: t0, rng: () => 0.5 });
assert.equal(prepareSession(intro, t0).idle, undefined, 'no clock during the tutorial');
const fresh = completeFreshTutorial();
assert.equal(prepareSession({ ...fresh, idle: undefined }, t0).idle.since, t0, 'the clock starts after the tutorial');

// Collected through the session: a reward reveal with the hold art; nothing to collect is refused.
const viaSession = sessionAction(player, {}, 'idle-claim', {}, { now: t0 + 9 * HOUR });
assert.ok(viaSession.ok, viaSession.reason);
assert.deepEqual([viaSession.effect.kind, viaSession.effect.source, viaSession.effect.title], ['reward', 'idle', 'Welcome back, Captain']);
assert.equal(viaSession.effect.rewards.credits, long.credits);
assert.match(viaSession.effect.subtitle, /8 h at your stations · hold full/);
assert.equal(viaSession.player.idle.since, t0 + 9 * HOUR);
assert.equal(sessionAction(viaSession.player, {}, 'idle-claim', {}, { now: t0 + 9 * HOUR + 60000 }).reason, 'hold_empty');
const quick = sessionAction(player, {}, 'idle-claim', {}, { now: t0 + 30 * 60000 });
assert.equal(quick.effect.title, 'Hold collected', 'a short break is just a collection');
assert.match(quick.effect.subtitle, /^30 min at your stations · hold 6% full$/);
assert.equal(sessionAction(intro, {}, 'idle-claim', {}, { now: t0 }).ok, false, 'locked during the tutorial');

// The ship's hold chip and the welcome-back screen.
assert.match(renderHoldChip(player, t0 + 4 * HOUR), /data-act="idle-claim"[\s\S]*50%/);
assert.match(renderHoldChip(player, t0 + 9 * HOUR), /is-full/);
assert.equal(renderHoldChip(intro, t0), '', 'no chip during the tutorial');
assert.doesNotMatch(renderHoldChip(player, t0 + 60000), /data-act="idle-claim"/, 'nothing to collect yet');
const welcome = renderWelcomeBack(player, t0 + 9 * HOUR);
assert.match(welcome, /Welcome back, Captain/);
assert.match(welcome, /welcome-back\.png/);
assert.match(welcome, /data-act="idle-claim"/);
assert.match(welcome, new RegExp(`${long.credits.toLocaleString('en-US')}`));

// The save check refuses an edited clock.
assert.equal(isWarpcrewPlayer(player), true);
assert.equal(isWarpcrewPlayer({ ...player, idle: { since: 'yesterday' } }), false);
assert.equal(isWarpcrewPlayer({ ...player, idle: { since: -5 } }), false);

// "Hold full" text notice: when the hold fills, never during the tutorial or once full, and never on a day another
// timed notice already lands (Jest sends at most one a day).
assert.equal(NOTIF_IDS.holdFull, 'wc_hold_full');
const tankFull = { ...player, activeExpedition: null, shipBuild: null, wallet: { ...player.wallet, fuel: player.fuelMax || 10 } };
assert.equal(fuelFullAt(tankFull, t0), null);
assert.equal(holdFullAt(tankFull, t0 + HOUR), t0 + 8 * HOUR, 'fills 8 hours after the clock started');
assert.equal(holdFullAt(tankFull, t0 + 9 * HOUR), null, 'already full');
assert.equal(holdFullAt(intro, t0), null, 'no notice during the tutorial');
assert.equal(holdFullAt({ ...tankFull, stationAssignments: {} }, t0 + HOUR), null, 'nobody earning');
assert.equal(holdFullAt({ ...tankFull, activeExpedition: { endAt: t0 + 7 * HOUR } }, t0 + HOUR), null, 'the away team notice that day wins');
assert.equal(holdFullAt({ ...tankFull, activeExpedition: { endAt: t0 + 30 * HOUR } }, t0 + HOUR), t0 + 8 * HOUR, 'a notice on another day does not block it');

// Success test 3: three staffed stations at level 1 earn about one early contract (100-200 credits) in 8 hours.
const typical = idleHaul({ ...player, crew: player.crew.map(c => ({ ...c, level: 1 })) }, t0 + 8 * HOUR);
assert.ok(typical.credits >= 100 && typical.credits <= 200, `8 hours at three stations: ${typical.credits} credits`);

console.log('idle: OK');
