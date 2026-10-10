// @ts-nocheck
/**
 * Income while away (Phase 2 design §4, docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * Staffed stations earn credits every hour, more with a crew member in their own role and with crew level;
 * Engineering also trickles medals. Income stops when the hold is full: 8 hours, plus 1 hour per Cargo level above
 * the first, up to 16. Time comes from trustedNow, never runs backwards, and away or injured crew earn nothing
 * (stationOutputs only counts ready crew). Rates are starting values for the 30-day sim.
 */
import { stationOutputs, normalizeAssignments } from './stations.js';
import { grant } from './economy.js';
import { trustedNow } from '../shared/time.js';

const HOUR = 3600000;
export const IDLE_RATES = { creditsPerStation: 12, roleBonus: 4, perCrewLevel: 0.5, engineeringMedalsPerHour: 0.5 };
export const HOLD_HOURS = { base: 8, perCargoLevel: 1, max: 16 };
/** Less than this and there is nothing to collect yet (no claim screen for a quick tab switch). */
export const IDLE_MIN_MS = 5 * 60000;
/** The welcome-back screen opens after this long away. */
export const WELCOME_BACK_MS = HOUR;

export function holdHours(player) {
  const cargo = Math.max(1, Number(player?.ship?.systems?.cargo) || 1);
  return Math.min(HOLD_HOURS.max, HOLD_HOURS.base + (cargo - 1) * HOLD_HOURS.perCargoLevel);
}

/** Credits (and Engineering medals) per hour from who is at their stations now. */
export function idleRates(player, now = trustedNow()) {
  const outputs = stationOutputs(player, now);
  const byId = Object.fromEntries((player?.crew || []).map(member => [member.instanceId, member]));
  let credits = 0;
  let medals = 0;
  for (const [stationId, out] of Object.entries(outputs)) {
    const member = out.staffedBy ? byId[out.staffedBy] : null;
    if (!member) continue;
    credits += IDLE_RATES.creditsPerStation + (out.bonus > 0 ? IDLE_RATES.roleBonus : 0) + (member.level || 1) * IDLE_RATES.perCrewLevel;
    if (stationId === 'engineering') medals += IDLE_RATES.engineeringMedalsPerHour;
  }
  return { credits, medals, staffed: Object.values(normalizeAssignments(player)).filter(Boolean).length };
}

/** What waits in the hold now: hours earned (capped), the haul, and whether the hold is full. */
export function idleHaul(player, now = trustedNow()) {
  const since = Number(player?.idle?.since);
  const cap = holdHours(player);
  if (!Number.isFinite(since)) return { hours: 0, capHours: cap, full: false, credits: 0, medals: 0, ready: false };
  const ms = Math.min(Math.max(0, now - since), cap * HOUR);
  const rates = idleRates(player, now);
  const hours = ms / HOUR;
  const credits = Math.floor(rates.credits * hours);
  const medals = Math.floor(rates.medals * hours);
  return { hours, capHours: cap, full: ms >= cap * HOUR, credits, medals, ready: ms >= IDLE_MIN_MS && credits + medals > 0, awayMs: Math.max(0, now - since) };
}

/** Start the clock (after the tutorial) without paying anything. */
export function startIdleClock(player, now = trustedNow()) {
  if (Number.isFinite(Number(player?.idle?.since))) return player;
  return { ...player, idle: { since: now } };
}

/** Collect the hold: the haul goes into the wallet and the clock restarts now. */
export function claimIdle(player, now = trustedNow()) {
  const haul = idleHaul(player, now);
  if (!haul.ready) return { ok: false, reason: Number.isFinite(Number(player?.idle?.since)) ? 'hold_empty' : 'idle_not_started' };
  const reward = { ...(haul.credits ? { credits: haul.credits } : {}), ...(haul.medals ? { medals: haul.medals } : {}) };
  return { ok: true, reward, haul, player: { ...player, wallet: grant(player.wallet, reward), idle: { since: now } } };
}
