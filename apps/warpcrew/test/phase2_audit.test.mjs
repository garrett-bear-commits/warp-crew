// Regression tests for the independent Phase 2 audit (docs/audits/2026-10-10-phase2-audit.md). Each failed before
// its fix. M4 and L1 (main.js wiring) are guarded in reward_reveal.test.mjs; the server half of L6 is
// apps/server/test/unit/warpcrew-client-parity.test.ts.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { createNewPlayer, migratePlayer, tickCrewStatus } from '../src/systems/player.js';
import { calendarState, claimCalendar, CALENDAR_LENGTH } from '../src/systems/calendar.js';
import { applyDailyLogin } from '../src/systems/daily.js';
import { mapJumps } from '../src/systems/exploreNudge.js';
import { idleHaul, claimIdle, startIdleClock, idleRates } from '../src/systems/idle.js';
import { assignStation } from '../src/systems/stations.js';
import { sessionAction, prepareSession } from '../src/systems/sessionLoop.js';
import { applyExpeditionResult } from '../src/systems/expedition.js';
import { holdFullAt } from '../src/systems/notifications.js';
import { openDailyChest, rollChest, CHESTS } from '../src/systems/chests.js';
import { markDailyMilestone, MILESTONES } from '../src/systems/dailyLoop.js';
import { claimAchievement } from '../src/systems/achievements.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { decodePlayer } from '../src/core/codec.js';
import { renderLog, renderCalendar } from '../src/ui/bridge.js';
import { simulateFreePlayer30Days } from '../src/sim/contractEconomy.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const t0 = Date.UTC(2026, 9, 12, 9);
const hub = () => {
  let p = completeFreshTutorial();
  p = { ...p, activeExpedition: null, shipBuild: null, crew: p.crew.map(c => ({ ...c, status: 'ready', injuredUntil: 0 })) };
  const seat = { pilot: 'helm', engineer: 'engineering', gunner: 'weapons' };
  for (const m of p.crew) if (seat[m.role]) p = assignStation(p, m.instanceId, seat[m.role], t0).player;
  return { ...p, idle: { since: t0 } };
};

test('H1: a clock set back to an earlier day never reopens a calendar square or the free hire', () => {
  let p = hub();
  p = claimCalendar(p, { now: t0 }).player;
  const yesterday = t0 - DAY;
  assert.equal(calendarState(p, yesterday).canClaim, false, 'yesterday is not a new day');
  assert.equal(claimCalendar(p, { now: yesterday }).ok, false);
  let claims = 0;
  for (let i = 0; i < 20; i++) {
    for (const at of [yesterday, t0]) { const r = claimCalendar(p, { now: at }); if (r.ok) { claims++; p = r.player; } }
  }
  assert.equal(claims, 0, 'switching between yesterday and today pays nothing');
  assert.equal(claimCalendar(p, { now: t0 + DAY }).ok, true, 'the real next day still pays');
  const logged = applyDailyLogin({ ...createNewPlayer(), lastLoginDay: '2026-10-12', dailyPullAvailable: false }, yesterday);
  assert.equal(logged.isNewDay, false, 'the free hire does not reset on an earlier day');
  assert.equal(logged.player.dailyPullAvailable, false);
});

test('H2: a lost contract does not stop map jumps from counting (the jump order)', () => {
  const p = hub();
  const lost = { ...p, stats: { ...p.stats, jumps: 5, contractsCompleted: 4, contractsLost: 2 } };
  assert.equal(mapJumps(lost), 1, 'two losses are already among the four completed contracts');
  assert.equal(mapJumps({ ...lost, stats: { ...lost.stats, jumps: 6 } }), 2, 'a real jump raises it');
});

test('M1: moving the clock forward and back never refills the hold', () => {
  let p = hub();
  let collected = 0;
  const forward = t0 + 9 * HOUR;
  for (let i = 0; i < 10; i++) {
    const r = claimIdle(p, forward);
    if (r.ok) { collected++; p = r.player; }
    p = prepareSession(p, t0 + i * 60000); // back to real time: the session must not reset the clock
    p = startIdleClock(p, t0 + i * 60000);
  }
  assert.equal(collected, 1, 'one forward jump pays once, never again');
  assert.equal(idleHaul(p, t0 + 2 * HOUR).credits, 0, 'nothing builds until real time passes the saved start');
});

test('M2: a station, an away team or a Cargo upgrade only pays from the moment it changes', () => {
  // (a) Nobody staffed for 8 hours, then everyone sits down: nothing for the 8 hours.
  let empty = { ...hub(), stationAssignments: {} };
  assert.equal(idleRates(empty, t0).credits, 0);
  const crewId = empty.crew.find(m => m.role === 'pilot').instanceId;
  const seated = sessionAction(empty, {}, 'station-assign', { id: crewId, station: 'helm' }, { now: t0 + 8 * HOUR });
  assert.ok(seated.ok, seated.reason);
  assert.equal(idleHaul(seated.player, t0 + 8 * HOUR).credits, 0, 'not paid backwards');
  assert.ok(idleHaul(seated.player, t0 + 10 * HOUR).credits > 0, 'paid from then on');
  assert.equal(idleHaul(empty, t0 + 30 * HOUR).hours, 0, 'empty stations never fill the hold with nothing');
  // (b) A full hold, then a Cargo upgrade: the stopped hours stay stopped.
  const full = hub();
  const before = idleHaul(full, t0 + 10 * HOUR);
  assert.equal(before.full, true);
  const upgraded = sessionAction({ ...full, wallet: { ...full.wallet, credits: 100000 } }, {}, 'ship-upgrade', { system: 'cargo' }, { now: t0 + 10 * HOUR });
  assert.ok(upgraded.ok, upgraded.reason);
  assert.equal(idleHaul(upgraded.player, t0 + 10 * HOUR).credits, before.credits, 'the bigger hold does not reopen past hours');
  assert.ok(idleHaul(upgraded.player, t0 + 11 * HOUR).credits > before.credits, 'it fills on from now');
  // (c) A crew member healing at a station earns from the heal on.
  const hurt = hub();
  const id = hurt.crew.find(m => m.role === 'gunner').instanceId;
  const injured = { ...hurt, crew: hurt.crew.map(m => m.instanceId === id ? { ...m, status: 'injured', injuredUntil: t0 + 4 * HOUR } : m) };
  const healed = tickCrewStatus(injured, t0 + 6 * HOUR);
  assert.equal(idleHaul(healed, t0 + 6 * HOUR).credits, idleHaul(injured, t0 + 6 * HOUR).credits, 'the time laid up pays at the lower rate');
  // (d) An away team coming home earns at its station from its return.
  const away = { ...hurt, activeExpedition: { endAt: t0 + 5 * HOUR, payload: { planetId: 'dustfall' } },
    crew: hurt.crew.map(m => m.instanceId === id ? { ...m, status: 'expedition' } : m) };
  const home = applyExpeditionResult(away, { ready: true, success: true, crewInstanceIds: [id], rewards: {}, planet: { id: 'dustfall' } }, { now: t0 + 6 * HOUR });
  assert.ok(home.ok);
  assert.equal(idleHaul(home.player, t0 + 6 * HOUR).credits, idleHaul(away, t0 + 6 * HOUR).credits, 'the time away pays at the lower rate');
});

test('M3: the sim collects the hold after the away team is home, as a real boot does', () => {
  const run = simulateFreePlayer30Days({ seed: 4219, strategy: 'balanced', flow: 'guided', days: 6 });
  const both = run.days.filter(day => day.rewardsBySource['expedition-claim'] && day.rewardsBySource.idle);
  assert.ok(both.length > 0);
  for (const day of both) {
    const keys = Object.keys(day.rewardsBySource);
    assert.ok(keys.indexOf('expedition-claim') < keys.indexOf('idle'), `day ${day.day}: away team home first`);
  }
});

test('L2: the "Hold full" text never lands tomorrow (next to the comeback text) or at night', () => {
  const p = { ...hub(), wallet: { ...hub().wallet, fuel: 10 } };
  assert.equal(holdFullAt(p, t0 + HOUR), t0 + 8 * HOUR, 'fills at 17:00 the same day: sent');
  const evening = { ...p, idle: { since: Date.UTC(2026, 9, 12, 20) } };
  assert.equal(holdFullAt(evening, Date.UTC(2026, 9, 12, 20, 30)), null, 'fills at 04:00 tomorrow: skipped');
  const night = { ...p, idle: { since: Date.UTC(2026, 9, 11, 21) } };
  assert.equal(holdFullAt(night, Date.UTC(2026, 9, 12, 1)), null, 'fills at 05:00 today: skipped (night)');
  const morning = { ...p, idle: { since: Date.UTC(2026, 9, 12, 0) } };
  assert.equal(holdFullAt(morning, Date.UTC(2026, 9, 12, 0, 30)), Date.UTC(2026, 9, 12, 8), 'fills at 08:00: sent');
});

test('L3: the reveal shows only the fuel that went into the tank', () => {
  const p = hub();
  const tankFull = { ...p, wallet: { ...p.wallet, fuel: p.fuelMax || 10 }, calendar: { cycle: 1, claimed: 1, lastDay: '2026-10-11' } };
  const square2 = claimCalendar(tankFull, { now: t0 });
  assert.equal(square2.reward.fuel, undefined, 'square 2 is fuel; a full tank takes none');
  let chest = MILESTONES.reduce((q, m) => markDailyMilestone(q, m.id, t0), { ...tankFull });
  const day = [...Array(60).keys()].map(d => t0 + d * DAY).find(at => rollChest(chest, 'daily', new Date(at).toISOString().slice(0, 10)).reward.fuel);
  chest = MILESTONES.reduce((q, m) => markDailyMilestone(q, m.id, day), chest);
  const opened = openDailyChest(chest, { now: day });
  assert.ok(opened.ok && opened.rolled.fuel === CHESTS.daily.bonus[0].reward.fuel);
  assert.equal(opened.reward.fuel, undefined, 'the rolled fuel did not fit');
});

test('L4: collecting often loses nothing: fractions stay banked and Engineering medals arrive', () => {
  const once = claimIdle(hub(), t0 + 8 * HOUR).reward;
  let p = hub();
  const total = { credits: 0, medals: 0 };
  for (let h = 1; h <= 8; h++) {
    const r = claimIdle(p, t0 + h * HOUR);
    if (r.ok) { p = r.player; total.credits += r.reward.credits || 0; total.medals += r.reward.medals || 0; }
  }
  assert.ok(once.credits - total.credits <= 1, `hourly ${total.credits} vs once ${once.credits}`);
  assert.equal(total.medals, once.medals || 0, 'medals arrive');
});

test('L5: after square 28 the calendar reads finished, not "day 0"', () => {
  const p = { ...hub(), calendar: { cycle: 1, claimed: 27, lastDay: '2026-10-11' } };
  const done = claimCalendar(p, { now: t0 }).player;
  const state = calendarState(done, t0);
  assert.deepEqual([state.cycle, state.claimed, state.canClaim], [1, CALENDAR_LENGTH, false]);
  assert.match(renderLog(done, [], { goals: [] }), /Day 28 of 28 claimed/);
  assert.match(renderCalendar(done, t0), /Cycle 1 · day 28 of 28/);
  assert.equal(calendarState(done, t0 + DAY).cycle, 2, 'the next day starts cycle 2');
});

test('L6: an odd saved calendar or idle clock is cleaned on load, never a refused save', () => {
  const p = hub();
  for (const odd of [{ calendar: { cycle: 1, claimed: 29, lastDay: '2026-10-11' } }, { calendar: { cycle: 1, claimed: 3 } },
    { idle: { since: 'yesterday' } }, { idle: { since: t0, banked: { credits: -4, medals: 'x', hours: 99 } } }]) {
    const loaded = decodePlayer(JSON.parse(JSON.stringify({ ...p, ...odd })));
    assert.equal(isWarpcrewPlayer(loaded), true, JSON.stringify(odd));
  }
  assert.equal(migratePlayer({ ...p, idle: { since: 'yesterday' } }).idle, undefined);
  assert.deepEqual(migratePlayer({ ...p, calendar: { cycle: 1, claimed: 29 } }).calendar, { cycle: 1, claimed: 28, lastDay: null });
});

test('L7: a crafted achievement id is refused, not a crash', () => {
  const p = hub();
  for (const id of ['__proto__', 'constructor', 'toString', 7, null]) {
    assert.equal(claimAchievement(p, id).ok, false);
    assert.equal(sessionAction(p, {}, 'achievement-claim', { id }, { now: t0 }).ok, false);
  }
});
