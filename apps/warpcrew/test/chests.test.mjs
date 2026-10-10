// Daily orders and chests (Phase 2 design §3): 100 points open the daily chest, five dailies the weekly one;
// published odds, seeded rolls a reload cannot change, and nothing during the tutorial.
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { markDailyMilestone, MILESTONES } from '../src/systems/dailyLoop.js';
import { CHESTS, WEEKLY_CHEST_GOAL, chestOdds, chestState, weekKey, rollChest, openDailyChest, openWeeklyChest } from '../src/systems/chests.js';
import { sessionAction } from '../src/systems/sessionLoop.js';
import { renderOrders, renderNav, renderNoticeStrip } from '../src/ui/bridge.js';
import { renderDailyPlan } from '../src/ui/contractView.js';
import { dailyPlan } from '../src/systems/dailyLoop.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';

const DAY = 86400000;
const monday = Date.UTC(2026, 9, 12, 12);
assert.equal(weekKey(monday), '2026-10-12');
assert.equal(weekKey(monday + 6 * DAY), '2026-10-12', 'Sunday is the same game week');
assert.equal(weekKey(monday + 7 * DAY), '2026-10-19');

// The published odds add up, and every table row is shown.
for (const kind of ['daily', 'weekly']) {
  const odds = chestOdds(kind);
  assert.equal(odds.bonus.length, CHESTS[kind].bonus.length);
  assert.ok(Math.abs(odds.bonus.reduce((n, row) => n + row.chance, 0) - 100) <= 1, `${kind} odds add to 100%`);
  assert.equal(odds.fixed.length, Object.keys(CHESTS[kind].fixed).length);
}

const done = player => MILESTONES.reduce((p, m) => markDailyMilestone(p, m.id, monday), player);
let player = { ...completeFreshTutorial(), wallet: { ...completeFreshTutorial().wallet, fuel: 0 } };
assert.equal(openDailyChest(player, { now: monday }).reason, 'chest_needs_points');
assert.equal(openDailyChest(markDailyMilestone(player, 'contract', monday), { now: monday }).reason, 'chest_needs_points');

// 100 points: the chest opens once, pays inside its table, and the same save on the same day rolls the same chest.
player = done(player);
assert.equal(chestState(player, monday).daily.ready, true);
const opened = openDailyChest(player, { now: monday });
assert.ok(opened.ok, opened.reason);
assert.deepEqual(rollChest(player, 'daily', '2026-10-12'), { reward: opened.reward, shard: opened.shard }, 'a reload rolls the same chest');
assert.ok(opened.reward.credits >= CHESTS.daily.fixed.credits[0] && opened.reward.credits <= CHESTS.daily.fixed.credits[1]);
assert.ok(opened.reward.medals >= 6);
assert.equal(opened.player.dailyLoop.chest, true);
assert.equal(opened.player.chests.opened, 1);
assert.equal(openDailyChest(opened.player, { now: monday + 3600000 }).reason, 'chest_opened_today');
assert.equal(opened.player.gacha.pityRare, player.gacha.pityRare, 'the hire pity is untouched');

// Across many days every bonus row comes up, all inside the table, and a shard always goes to a real merc.
const seen = new Set();
for (let d = 0; d < 200; d++) {
  const roll = rollChest(player, 'daily', `day-${d}`);
  seen.add(roll.shard ? 'shard' : Object.keys(roll.reward).filter(k => !['credits', 'medals'].includes(k))[0]);
  if (roll.shard) assert.ok(player.crew.some(m => m.instanceId === roll.shard.instanceId && !m.isCaptain));
}
assert.deepEqual([...seen].sort(), ['fuel', 'gems', 'marks', 'shard']);

// Five daily chests in a week open the weekly chest; a new week starts the count again.
let week = player;
for (let d = 0; d < WEEKLY_CHEST_GOAL; d++) {
  const at = monday + d * DAY;
  week = MILESTONES.reduce((p, m) => markDailyMilestone(p, m.id, at), week);
  assert.equal(openWeeklyChest(week, { now: at }).ok, false);
  week = openDailyChest(week, { now: at }).player;
}
const state = chestState(week, monday + 4 * DAY);
assert.deepEqual([state.weekly.count, state.weekly.ready], [5, true]);
const weekly = openWeeklyChest(week, { now: monday + 4 * DAY });
assert.ok(weekly.ok, weekly.reason);
assert.ok(weekly.reward.gems >= CHESTS.weekly.fixed.gems[0], 'the weekly chest always has gems');
assert.equal(openWeeklyChest(weekly.player, { now: monday + 5 * DAY }).reason, 'chest_opened_this_week');
assert.deepEqual([chestState(weekly.player, monday + 7 * DAY).weekly.count, chestState(weekly.player, monday + 7 * DAY).weekly.opened], [0, false]);

// Through the session: a reward effect with the open-chest art; a shard shows as a card; locked during the tutorial.
const viaSession = sessionAction(player, {}, 'chest-open', { kind: 'daily' }, { now: monday });
assert.ok(viaSession.ok, viaSession.reason);
assert.deepEqual([viaSession.effect.kind, viaSession.effect.source, viaSession.effect.art], ['reward', 'chest', 'art/pixel/ui/chest-daily-open.png']);
assert.deepEqual(viaSession.effect.rewards, opened.reward);
const fresh = createNewPlayer({ tutorialScript: 5, now: monday, rng: () => 0.5 });
assert.equal(sessionAction(done(fresh), {}, 'chest-open', { kind: 'daily' }, { now: monday }).ok, false);
const shardDay = [...Array(400).keys()].find(d => rollChest(player, 'daily', `2026-${String(1 + Math.floor(d / 28)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`).shard);
const shardAt = Date.UTC(2026, Math.floor(shardDay / 28), 1 + (shardDay % 28), 12);
const shardPlayer = MILESTONES.reduce((p, m) => markDailyMilestone(p, m.id, shardAt), player);
const shardOpen = sessionAction(shardPlayer, {}, 'chest-open', { kind: 'daily' }, { now: shardAt });
assert.ok(shardOpen.effect.shard?.portrait && shardOpen.effect.shard.amount === 1, 'the shard card has the merc');
const target = shardOpen.player.crew.find(m => m.name === shardOpen.effect.shard.name) || shardOpen.player.crew.find(m => (m.shards || 0) > 0);
assert.equal(target.shards, 1);

// The Log panel, the hub chip and the Log tab dot.
const html = renderOrders(player, monday);
assert.match(html, /Daily orders · 100\/100/);
assert.match(html, /data-act="chest-open" data-kind="daily"/);
assert.match(html, /Possible contents/);
assert.match(html, /10 gems<\/span><b>20%<\/b>/);
assert.equal(renderDailyPlan(dailyPlan(opened.player, monday)), '', 'no chip once the chest is open');
assert.match(renderDailyPlan(dailyPlan(player, monday)), /Daily chest ready/);
assert.match(renderDailyPlan(dailyPlan(markDailyMilestone(completeFreshTutorial(), 'contract', monday), monday)), /30\/100 · Improve your ship or crew/);
assert.match(renderDailyPlan(dailyPlan(MILESTONES.slice(0, 3).reduce((p, m) => markDailyMilestone(p, m.id, monday), completeFreshTutorial()), monday)),
  /data-act="mission-view" data-view="explore"/);
assert.doesNotMatch(renderOrders(fresh, monday), /data-act="chest-open"/, 'no chest button during the tutorial');

// The hub notice strip: the ready chest (and anything else waiting), nothing during the tutorial or once opened.
const calDone = { cycle: 1, claimed: 1, lastDay: '2026-10-12' };
assert.match(renderNoticeStrip({ ...player, calendar: calDone }, monday), /data-act="chest-open" data-kind="daily"/);
assert.match(renderNoticeStrip({ ...player, calendar: { cycle: 1, claimed: 1, lastDay: '2026-10-11' } }, monday), /data-act="calendar-open"/);
assert.equal(renderNoticeStrip(done(fresh), monday), '');
assert.doesNotMatch(renderNoticeStrip({ ...opened.player, calendar: calDone }, monday), /chest-open/);
assert.match(renderNoticeStrip({ ...weekly.player, calendar: calDone, stats: { ...weekly.player.stats, combatsWon: 10 } }, monday + 4 * DAY), /data-tab="log"/, 'an achievement to claim opens the Log');

console.log('chests: OK');
