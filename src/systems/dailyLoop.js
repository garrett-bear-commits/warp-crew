import { contractDayKey } from './contracts.js';

const MILESTONES = [
  { id: 'contract', label: 'Claim a contract', act: 'goto-contracts' },
  { id: 'improve', label: 'Improve your ship or crew', act: 'daily-improve' },
  { id: 'away', label: 'Launch an away team', act: 'goto-away' },
];

export function defaultDailyLoop(dayKey) {
  return { dayKey, contract: false, improve: false, away: false };
}

export function ensureDailyLoop(player, now = Date.now()) {
  const dayKey = contractDayKey(now);
  if (player.dailyLoop?.dayKey === dayKey) return player;
  return { ...player, dailyLoop: defaultDailyLoop(dayKey) };
}

export function markDailyMilestone(player, milestone, now = Date.now()) {
  const next = ensureDailyLoop(player, now);
  if (!MILESTONES.some((item) => item.id === milestone) || next.dailyLoop[milestone] === true) return next;
  return { ...next, dailyLoop: { ...next.dailyLoop, [milestone]: true } };
}

export function dailyPlan(player, now = Date.now()) {
  const state = ensureDailyLoop(player, now).dailyLoop;
  const completed = MILESTONES.filter((item) => state[item.id] === true).length;
  return { next: MILESTONES.find((item) => state[item.id] !== true) || null, completed, total: 3, complete: completed === 3 };
}
