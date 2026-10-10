// The 28-day login calendar (Phase 2 design §2): one square a day, missed days pause, day 28 is an Epic-or-better hire.
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { CALENDAR_LENGTH, CALENDAR_REWARDS, CALENDAR_MILESTONES, calendarState, claimCalendar, normalizeCalendar } from '../src/systems/calendar.js';
import { RARITY, catalogById } from '../src/data/crewRoster.js';

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
assert.equal(r.player.wallet.credits, wallet0.credits + 60);
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

console.log('calendar: OK');
