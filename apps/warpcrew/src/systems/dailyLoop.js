import { trustedNow } from '../shared/time.js';
import { contractDayKey } from './contracts.js';

/**
 * The day's orders (Phase 2 design §3): five tasks worth 120 points; 100 open the daily chest (chests.js), so a captain
 * can skip the star-map jump or the fight on a day but never the contract. view: the Missions view the hub chip opens.
 */
export const MILESTONES = [
  { id: 'contract', label: 'Claim a contract', act: 'goto-contracts', points: 30 },
  { id: 'improve', label: 'Improve your ship or crew', act: 'daily-improve', points: 25 },
  { id: 'away', label: 'Launch an away team', act: 'goto-away', points: 25 },
  { id: 'jump', label: 'Make a jump on the star map', act: 'mission-view', view: 'explore', points: 20 },
  { id: 'win', label: 'Win a fight', act: 'goto-contracts', points: 20 },
];
/** Points that open the daily chest. */
export const CHEST_POINTS = 100;

export function defaultDailyLoop(dayKey) {
  return { dayKey, contract: false, improve: false, away: false, jump: false, win: false, chest: false };
}

export function ensureDailyLoop(player, now = trustedNow()) {
  const dayKey = contractDayKey(now);
  if (player.dailyLoop?.dayKey === dayKey) return player;
  return { ...player, dailyLoop: defaultDailyLoop(dayKey) };
}

export function markDailyMilestone(player, milestone, now = trustedNow()) {
  const next = ensureDailyLoop(player, now);
  if (!MILESTONES.some((item) => item.id === milestone) || next.dailyLoop[milestone] === true) return next;
  return { ...next, dailyLoop: { ...next.dailyLoop, [milestone]: true } };
}

/** Today's orders: the next one to do, how many are done, points so far and the chest. */
export function dailyPlan(player, now = trustedNow()) {
  const state = ensureDailyLoop(player, now).dailyLoop;
  const done = MILESTONES.filter((item) => state[item.id] === true);
  const points = done.reduce((n, item) => n + item.points, 0);
  const chestOpened = state.chest === true;
  return { next: MILESTONES.find((item) => state[item.id] !== true) || null, completed: done.length, total: MILESTONES.length,
    complete: done.length === MILESTONES.length, points, goal: CHEST_POINTS, chestReady: points >= CHEST_POINTS && !chestOpened, chestOpened };
}
