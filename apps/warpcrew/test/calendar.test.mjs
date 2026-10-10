// The 28-day login calendar (Phase 2 design §2): one square a day, missed days pause, day 28 is an Epic-or-better hire.
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { CALENDAR_LENGTH, CALENDAR_REWARDS, CALENDAR_MILESTONES, calendarState, claimCalendar, normalizeCalendar } from '../src/systems/calendar.js';
import { RARITY, catalogById } from '../src/data/crewRoster.js';
import { sessionAction } from '../src/systems/sessionLoop.js';
import { renderCalendar, renderNav, renderLog } from '../src/ui/bridge.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { isWarpcrewPlayer } from '../src/core/progress.js';

const DAY = 86400000;
const start = Date.UTC(2026, 9, 10, 12);
assert.equal(CALENDAR_REWARDS.length, CALENDAR_LENGTH);
assert.deepEqual(CALENDAR_MILESTONES, [7, 14, 21, 28]);
assert.equal(CALENDAR_REWARDS[27].hire, 'epic');
const gemsPerCycle = CALENDAR_REWARDS.reduce((n, r) => n + (r.gems || 0), 0);
assert.equal(gemsPerCycle, 145, 'gems a cycle: about 5 a day');

let player = createNewPlayer({ tutorialScript: 5, now: start, rng: () => 0.5 });
const wallet0 = { ...player.wallet };
assert.deepEqual(calendarState(player, start), { cycle: 1, claimed: 0, nextDay: 1, reward: CALENDAR_REWARDS[0], today: '2026-10-10', canClaim: true, claimedToday: false });

// Day 1 pays square 1, once a day.
let r = claimCalendar(player, { now: start });
assert.ok(r.ok);
assert.equal(r.day, 1);
assert.equal(r.player.wallet.credits, wallet0.credits + CALENDAR_REWARDS[0].credits);
assert.equal(r.player.wallet.medals, wallet0.medals + 3);
assert.equal(claimCalendar(r.player, { now: start + 3600000 }).reason, 'calendar_claimed_today');
player = r.player;

// A missed week does not reset it: the next claim is square 2.
r = claimCalendar(player, { now: start + 8 * DAY });
assert.equal(r.day, 2);
assert.equal(r.reward.fuel, 1);
player = r.player;

// Fuel never overfills the tank; Contract Marks go to the hire marks, not the wallet.
const full = { ...player, wallet: { ...player.wallet, fuel: player.fuelMax || 10 } };
assert.equal(claimCalendar({ ...full, calendar: { cycle: 1, claimed: 3, lastDay: null } }, { now: start + 9 * DAY }).player.wallet.fuel, full.fuelMax || 10);
const marks = claimCalendar({ ...player, calendar: { cycle: 1, claimed: 13, lastDay: null } }, { now: start + 9 * DAY });
assert.equal(marks.day, 14);
assert.equal(marks.player.gacha.marks, (player.gacha.marks || 0) + 10);
assert.equal(marks.player.wallet.marks, undefined);

// Day 28: a hire at Epic or better, deterministic, without touching pity, the banner guarantee or marks.
const before = { ...player, calendar: { cycle: 1, claimed: 27, lastDay: null } };
const hire = claimCalendar(before, { now: start + 10 * DAY });
const again = claimCalendar(before, { now: start + 10 * DAY });
assert.equal(hire.day, 28);
assert.ok(RARITY[hire.hired.rarity].rank >= RARITY.epic.rank, `got ${hire.hired.rarity}`);
assert.ok(RARITY[catalogById(hire.hired.instance.templateId).rarity].rank >= RARITY.epic.rank);
assert.equal(again.hired.instance.templateId, hire.hired.instance.templateId, 'the same save always gets the same hire');
for (const key of ['pityRare', 'pityLegend', 'marks', 'featuredGuarantee']) assert.equal(hire.player.gacha[key], before.gacha[key], `${key} untouched`);
assert.equal(hire.player.wallet.gems, before.wallet.gems + 30);
assert.equal(hire.player.gacha.history.at(-1).source, 'calendar');

// After 28 a new cycle starts at square 1.
const next = calendarState(hire.player, start + 11 * DAY);
assert.deepEqual([next.cycle, next.nextDay, next.canClaim], [2, 1, true]);
assert.equal(claimCalendar(hire.player, { now: start + 11 * DAY }).player.calendar.cycle, 2);

// A damaged or edited calendar is cleaned on read.
assert.deepEqual(normalizeCalendar({ cycle: -3, claimed: 99, lastDay: 'yesterday' }), { cycle: 1, claimed: 28, lastDay: null });
assert.deepEqual(normalizeCalendar(null), { cycle: 1, claimed: 0, lastDay: null });

// Through the session (the engine path): a reward effect, never during the tutorial, and the day-28 crew card.
const fresh = createNewPlayer({ tutorialScript: 5, now: start, rng: () => 0.5 });
assert.equal(sessionAction(fresh, {}, 'calendar-claim', {}, { now: start }).ok, false, 'locked during the tutorial');
const done = completeFreshTutorial();
const viaSession = sessionAction(done, {}, 'calendar-claim', {}, { now: start });
assert.ok(viaSession.ok, viaSession.reason);
assert.deepEqual([viaSession.effect.kind, viaSession.effect.source, viaSession.effect.title], ['reward', 'calendar', 'Day 1 of 28']);
assert.deepEqual(viaSession.effect.rewards, CALENDAR_REWARDS[0]);
assert.equal(viaSession.effect.crew, null);
assert.equal(sessionAction(viaSession.player, {}, 'calendar-claim', {}, { now: start + 3600000 }).reason, 'calendar_claimed_today');
const day28 = sessionAction({ ...done, calendar: { cycle: 1, claimed: 27, lastDay: '2026-10-01' } }, {}, 'calendar-claim', {}, { now: start });
assert.ok(day28.ok, day28.reason);
assert.ok(RARITY[day28.effect.crew.rarity].rank >= RARITY.epic.rank, 'the day-28 card shows an Epic or better');
assert.match(day28.effect.subtitle, /joins the crew/);
assert.ok(day28.effect.crew.portrait);
assert.deepEqual(day28.events.find(e => e.event === 'calendar_claimed').fields, { day: 28, cycle: 1, gems: 30, hire: day28.effect.crew.rarity });

// The sheet: 28 squares, today glowing, a claim button; claimed squares tick off; the Log row and tab dot.
const sheet = renderCalendar(done, start);
assert.equal(sheet.match(/class="cal-day/g).length, CALENDAR_LENGTH);
assert.equal(sheet.match(/is-today/g).length, 1);
assert.match(sheet, /data-act="calendar-claim"/);
const after = renderCalendar(viaSession.player, start);
assert.doesNotMatch(after, /data-act="calendar-claim"/);
assert.equal(after.match(/is-done/g).length, 1);
assert.match(after, /Back tomorrow/);
assert.match(renderLog(done, [], { goals: [] }), /Day 1 of 28 is ready[\s\S]*data-act="calendar-open"/);
assert.match(renderNav('ship', done, false, ['ship', 'crew', 'missions', 'shop', 'log']), /nav-badge/);
assert.doesNotMatch(renderLog(fresh, [], { goals: [] }), /calendar-open/, 'no calendar during the tutorial');

// The save check: a real calendar passes; an edited one (past 28, a fake day) is refused.
assert.equal(isWarpcrewPlayer(day28.player), true);
assert.equal(isWarpcrewPlayer({ ...done, calendar: { cycle: 1, claimed: 40, lastDay: null } }), false);
assert.equal(isWarpcrewPlayer({ ...done, calendar: { cycle: 0, claimed: 3, lastDay: null } }), false);
assert.equal(isWarpcrewPlayer({ ...done, calendar: { cycle: 1, claimed: 3, lastDay: 'tomorrow' } }), false);

console.log('calendar: OK');
