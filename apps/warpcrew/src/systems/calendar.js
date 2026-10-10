// @ts-nocheck
/**
 * The 28-day login calendar (Phase 2 design §2, docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * One square a game day, at the shared midnight reset (dayKey). A missed day does not reset the calendar: the next
 * square simply waits. Every seventh square is a bigger one; day 28 is a guaranteed Epic-or-better hire. That hire
 * rolls on its own seeded stream and leaves the hire pity, banner guarantee and Contract Marks untouched, so the
 * banner math is unchanged. After day 28 a new cycle starts.
 */
import { dayKey } from './daily.js';
import { grant } from './economy.js';
import { trustedNow } from '../shared/time.js';
import { pullMerc, applyPullToRoster, recordPull, hireSeed, hireRng, defaultGacha } from './gacha.js';

export const CALENDAR_LENGTH = 28;
/** Square n (1-based) pays CALENDAR_REWARDS[n - 1]. marks are Contract Marks; hire is the guaranteed hire's floor. */
export const CALENDAR_REWARDS = [
  { credits: 60, medals: 3 }, { credits: 80, fuel: 1 }, { credits: 60, medals: 8 }, { credits: 100, fuel: 1 },
  { credits: 80, medals: 12 }, { credits: 120, reputation: 2 }, { gems: 30, credits: 250, medals: 15 },
  { credits: 100, medals: 5 }, { credits: 120, fuel: 1 }, { gems: 10, credits: 100 }, { credits: 100, medals: 15 },
  { credits: 150, fuel: 1 }, { medals: 15, reputation: 3 }, { marks: 10, credits: 300 },
  { credits: 150, medals: 8 }, { credits: 160, fuel: 1 }, { gems: 10, credits: 150 }, { credits: 120, medals: 20 },
  { credits: 200, fuel: 2 }, { medals: 20, reputation: 3 }, { gems: 50, credits: 400, medals: 25 },
  { credits: 200, medals: 10 }, { credits: 220, fuel: 2 }, { gems: 15, credits: 200 }, { credits: 150, medals: 25 },
  { credits: 250, fuel: 2 }, { medals: 30, reputation: 5 }, { hire: 'epic', gems: 30 },
];
/** The bigger squares, drawn larger on the calendar. */
export const CALENDAR_MILESTONES = [7, 14, 21, 28];

/** The saved calendar, cleaned: the cycle number, squares claimed in it (0..28) and the game day of the last claim. */
export function normalizeCalendar(saved) {
  const cycle = Number.isInteger(saved?.cycle) && saved.cycle >= 1 ? saved.cycle : 1;
  const claimed = Number.isInteger(saved?.claimed) ? Math.min(CALENDAR_LENGTH, Math.max(0, saved.claimed)) : 0;
  const lastDay = typeof saved?.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.lastDay) ? saved.lastDay : null;
  return { cycle, claimed, lastDay };
}

/** Where the captain is: which square is next, its reward, and whether today's square is still to claim. */
export function calendarState(player, now = trustedNow()) {
  const saved = normalizeCalendar(player?.calendar);
  const rolled = saved.claimed >= CALENDAR_LENGTH;
  const cycle = rolled ? saved.cycle + 1 : saved.cycle;
  const claimed = rolled ? 0 : saved.claimed;
  const today = dayKey(now);
  return { cycle, claimed, nextDay: claimed + 1, reward: CALENDAR_REWARDS[claimed], today,
    canClaim: saved.lastDay !== today, claimedToday: saved.lastDay === today };
}

/** Claim today's square. Returns the reward paid, and the hire on day 28. */
export function claimCalendar(player, { now = trustedNow() } = {}) {
  const state = calendarState(player, now);
  if (!state.canClaim) return { ok: false, reason: 'calendar_claimed_today' };
  const { hire, marks, fuel, ...currencies } = state.reward;
  let next = { ...player, wallet: grant(player.wallet, currencies) };
  if (fuel) next = { ...next, wallet: { ...next.wallet, fuel: Math.min(next.fuelMax || 10, (next.wallet.fuel || 0) + fuel) } };
  if (marks) next = { ...next, gacha: { ...defaultGacha(), ...(next.gacha || {}), marks: (next.gacha?.marks || 0) + marks } };
  let hired = null;
  if (hire) {
    const { instance, rarity } = pullMerc({ reputation: next.wallet.reputation, gacha: defaultGacha(), minRarity: hire,
      rng: hireRng(hireSeed(next), `calendar:${state.cycle}`) });
    const applied = applyPullToRoster(next, instance);
    next = { ...applied.player, gacha: recordPull({ ...defaultGacha(), ...(applied.player.gacha || {}) }, applied.instance, applied.kind, 'calendar') };
    hired = { instance: applied.instance, rarity, kind: applied.kind, sold: applied.sold };
  }
  next = { ...next, calendar: { cycle: state.cycle, claimed: state.claimed + 1, lastDay: state.today } };
  const paid = { ...currencies, ...(fuel ? { fuel } : {}), ...(marks ? { marks } : {}) };
  return { ok: true, player: next, day: state.nextDay, cycle: state.cycle, reward: paid, hired };
}
