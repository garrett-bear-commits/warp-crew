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
  { credits: 20, medals: 3 }, { credits: 30, fuel: 1 }, { credits: 20, medals: 8 }, { credits: 40, fuel: 1 },
  { credits: 30, medals: 12 }, { credits: 40, reputation: 2 }, { gems: 30, credits: 80, medals: 15 },
  { credits: 40, medals: 5 }, { credits: 40, fuel: 1 }, { gems: 10, credits: 40 }, { credits: 40, medals: 15 },
  { credits: 60, fuel: 1 }, { medals: 15, reputation: 3 }, { marks: 10, credits: 100 },
  { credits: 60, medals: 8 }, { credits: 60, fuel: 1 }, { gems: 10, credits: 60 }, { credits: 40, medals: 20 },
  { credits: 70, fuel: 2 }, { medals: 20, reputation: 3 }, { gems: 50, credits: 140, medals: 25 },
  { credits: 70, medals: 10 }, { credits: 80, fuel: 2 }, { gems: 15, credits: 70 }, { credits: 60, medals: 25 },
  { credits: 80, fuel: 2 }, { medals: 30, reputation: 5 }, { hire: 'epic', gems: 30 },
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
  const today = dayKey(now);
  // Only a later game day pays: a clock set back to an earlier day never reopens a square (YYYY-MM-DD compares in
  // date order).
  const canClaim = !saved.lastDay || today > saved.lastDay;
  const claimedToday = saved.lastDay === today;
  // A finished cycle reads as finished until the next square can be claimed.
  const rolled = saved.claimed >= CALENDAR_LENGTH && canClaim;
  const cycle = rolled ? saved.cycle + 1 : saved.cycle;
  const claimed = rolled ? 0 : saved.claimed;
  return { cycle, claimed, nextDay: Math.min(claimed + 1, CALENDAR_LENGTH), reward: CALENDAR_REWARDS[Math.min(claimed, CALENDAR_LENGTH - 1)], today,
    canClaim, claimedToday };
}

/** Claim today's square. Returns the reward paid, and the hire on day 28. */
export function claimCalendar(player, { now = trustedNow() } = {}) {
  const state = calendarState(player, now);
  if (!state.canClaim) return { ok: false, reason: 'calendar_claimed_today' };
  const { hire, marks, fuel, ...currencies } = state.reward;
  let next = { ...player, wallet: grant(player.wallet, currencies) };
  // Fuel stops at the tank's size; the reveal shows only what went in.
  const fuelBefore = next.wallet.fuel || 0;
  if (fuel) next = { ...next, wallet: { ...next.wallet, fuel: Math.max(fuelBefore, Math.min(next.fuelMax || 10, fuelBefore + fuel)) } };
  const fuelAdded = (next.wallet.fuel || 0) - fuelBefore;
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
  const paid = { ...currencies, ...(fuelAdded > 0 ? { fuel: fuelAdded } : {}), ...(marks ? { marks } : {}) };
  return { ok: true, player: next, day: state.nextDay, cycle: state.cycle, reward: paid, hired };
}
