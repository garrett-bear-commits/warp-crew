// @ts-nocheck
/**
 * The daily and weekly chests (Phase 2 design §3, docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * 100 points of daily orders (dailyLoop.js) open the daily chest; five daily chests in a game week (Monday to Sunday)
 * open the weekly chest. Chests are free and never sold. Every chest pays its fixed part plus one bonus rolled from a
 * published table (CHESTS, shown on the chest as "Possible contents"). The roll is seeded from the save and the day
 * or week, so a reload never changes it, and it never touches the hire pity or Marks streams.
 */
import { dayKey } from './daily.js';
import { grant } from './economy.js';
import { trustedNow } from '../shared/time.js';
import { hireSeed, hireRng, defaultGacha } from './gacha.js';
import { recomputeCrew } from '../data/crewRoster.js';
import { ensureDailyLoop, dailyPlan } from './dailyLoop.js';

/** Daily chests opened in a week that open the weekly chest. */
export const WEEKLY_CHEST_GOAL = 5;

/**
 * The published tables. fixed: amounts paid every time ([min, max] rolls a whole number in that range).
 * bonus: one row is picked by weight; shard goes to your highest-star merc (towards Ascension).
 */
export const CHESTS = Object.freeze({
  daily: {
    label: 'Daily chest',
    fixed: { credits: [20, 40], medals: [6, 12] },
    bonus: [
      { weight: 35, reward: { fuel: 2 } },
      { weight: 30, reward: { marks: 3 } },
      { weight: 20, reward: { gems: 10 } },
      { weight: 15, shard: 1 },
    ],
  },
  weekly: {
    label: 'Weekly chest',
    fixed: { credits: [80, 120], medals: [20, 30], gems: [20, 20], marks: [5, 5] },
    bonus: [
      { weight: 40, shard: 1 },
      { weight: 35, reward: { fuel: 4 } },
      { weight: 25, reward: { gems: 20 } },
    ],
  },
});

const LABEL = { credits: 'credits', medals: 'medals', fuel: 'fuel', marks: 'Contract Marks', gems: 'gems' };

/** "Possible contents" for the chest: the fixed part, then each bonus with its odds in whole percent. */
export function chestOdds(kind) {
  const table = CHESTS[kind];
  const total = table.bonus.reduce((n, row) => n + row.weight, 0);
  const fixed = Object.entries(table.fixed).map(([currency, [lo, hi]]) => ({ kind: currency, label: lo === hi ? `${lo} ${LABEL[currency]}` : `${lo}-${hi} ${LABEL[currency]}` }));
  const bonus = table.bonus.map(row => ({ chance: Math.round((row.weight / total) * 100),
    label: row.shard ? `${row.shard} shard for your highest-star merc` : Object.entries(row.reward).map(([currency, n]) => `${n} ${LABEL[currency]}`).join(', ') }));
  return { fixed, bonus };
}

/** The Monday that starts the game week holding this game day (YYYY-MM-DD). */
export function weekKey(now = trustedNow()) {
  const [y, m, d] = dayKey(now).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** The saved weekly count, cleaned and reset when a new week starts. */
export function chestWeek(player, now = trustedNow()) {
  const week = weekKey(now);
  const saved = player?.chests;
  if (saved?.weekKey !== week) return { weekKey: week, opened: 0, weeklyClaimed: false };
  return { weekKey: week, opened: Math.min(7, Math.max(0, Number.isInteger(saved.opened) ? saved.opened : 0)), weeklyClaimed: saved.weeklyClaimed === true };
}

/** Where both chests stand now. */
export function chestState(player, now = trustedNow()) {
  const plan = dailyPlan(player, now);
  const week = chestWeek(player, now);
  return { daily: { ready: plan.chestReady, opened: plan.chestOpened, points: plan.points, goal: plan.goal },
    weekly: { ready: week.opened >= WEEKLY_CHEST_GOAL && !week.weeklyClaimed, opened: week.weeklyClaimed, count: Math.min(week.opened, WEEKLY_CHEST_GOAL), goal: WEEKLY_CHEST_GOAL } };
}

/** The merc a shard goes to: most stars, then the longest-serving (lowest id); never the captain. */
function shardTarget(player) {
  return [...(player.crew || []), ...(player.reserve || [])]
    .filter(member => !member.isCaptain && member.instanceId !== player.captainInstanceId)
    .sort((a, b) => (b.stars || 1) - (a.stars || 1) || String(a.instanceId).localeCompare(String(b.instanceId)))[0] || null;
}

/** Roll one chest on its own stream. Same save, same day (or week): same contents. */
export function rollChest(player, kind, key) {
  const table = CHESTS[kind];
  const rng = hireRng(hireSeed(player), `chest:${kind}:${key}`);
  const reward = {};
  for (const [currency, [lo, hi]] of Object.entries(table.fixed)) reward[currency] = lo + Math.floor(rng() * (hi - lo + 1));
  const total = table.bonus.reduce((n, row) => n + row.weight, 0);
  let pick = rng() * total;
  const row = table.bonus.find(item => (pick -= item.weight) < 0) || table.bonus.at(-1);
  let shard = null;
  if (row.shard) {
    const target = shardTarget(player);
    // Nobody to give it to yet: medals instead.
    if (target) shard = { instanceId: target.instanceId, templateId: target.templateId, amount: row.shard };
    else reward.medals = (reward.medals || 0) + 15;
  } else for (const [currency, n] of Object.entries(row.reward)) reward[currency] = (reward[currency] || 0) + n;
  return { reward, shard };
}

/**
 * Pay a rolled chest: currencies to the wallet, fuel up to the cap, Marks to the hire state, a shard to its merc.
 * Returns the player and what was actually paid (fuel past a full tank is not).
 */
function payChest(player, { reward, shard }) {
  const { fuel, marks, ...currencies } = reward;
  let next = { ...player, wallet: grant(player.wallet, currencies) };
  const fuelBefore = next.wallet.fuel || 0;
  if (fuel) next = { ...next, wallet: { ...next.wallet, fuel: Math.max(fuelBefore, Math.min(next.fuelMax || 10, fuelBefore + fuel)) } };
  const fuelAdded = (next.wallet.fuel || 0) - fuelBefore;
  if (marks) next = { ...next, gacha: { ...defaultGacha(), ...(next.gacha || {}), marks: (next.gacha?.marks || 0) + marks } };
  if (shard) {
    const give = member => member.instanceId === shard.instanceId ? recomputeCrew({ ...member, shards: (member.shards || 0) + shard.amount }) : member;
    next = { ...next, crew: (next.crew || []).map(give), reserve: (next.reserve || []).map(give) };
  }
  const { fuel: _rolled, ...rest } = reward;
  return { player: next, paid: { ...rest, ...(fuelAdded > 0 ? { fuel: fuelAdded } : {}) } };
}

/** Open today's daily chest (100 points of orders). */
export function openDailyChest(player, { now = trustedNow() } = {}) {
  const state = chestState(player, now);
  if (state.daily.opened) return { ok: false, reason: 'chest_opened_today' };
  if (!state.daily.ready) return { ok: false, reason: 'chest_needs_points' };
  const day = dayKey(now);
  const roll = rollChest(player, 'daily', day);
  const week = chestWeek(player, now);
  const opened = ensureDailyLoop(player, now);
  const paid = payChest({ ...opened, dailyLoop: { ...opened.dailyLoop, chest: true } }, roll);
  const next = { ...paid.player, chests: { ...week, opened: week.opened + 1 } };
  return { ok: true, player: next, kind: 'daily', reward: paid.paid, rolled: roll.reward, shard: roll.shard };
}

/** Open this week's weekly chest (five daily chests this week). */
export function openWeeklyChest(player, { now = trustedNow() } = {}) {
  const state = chestState(player, now);
  if (state.weekly.opened) return { ok: false, reason: 'chest_opened_this_week' };
  if (!state.weekly.ready) return { ok: false, reason: 'chest_needs_dailies' };
  const week = chestWeek(player, now);
  const roll = rollChest(player, 'weekly', week.weekKey);
  const paid = payChest(player, roll);
  const next = { ...paid.player, chests: { ...week, weeklyClaimed: true } };
  return { ok: true, player: next, kind: 'weekly', reward: paid.paid, rolled: roll.reward, shard: roll.shard };
}
