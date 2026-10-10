// @ts-nocheck
/**
 * Income while away (Phase 2 design §4, docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * Staffed stations earn credits every hour, more with a crew member in their own role and with crew level;
 * Engineering also trickles medals. Income stops when the hold is full: 8 hours, plus 1 hour per Cargo level above
 * the first, up to 16. Time comes from trustedNow and never runs backwards; away or injured crew earn nothing
 * (stationOutputs only counts ready crew). The clock banks what it earned whenever the setup changes (settleIdle),
 * so a new station, level or Cargo upgrade only pays from then on. Rates are tuned in the 30-day sim.
 */
import { stationOutputs, normalizeAssignments } from './stations.js';
import { grant } from './economy.js';
import { trustedNow } from '../shared/time.js';

const HOUR = 3600000;
// Tuned in the 30-day sim: three staffed stations at level 1 earn about one contract's credits in 8 hours.
export const IDLE_RATES = { creditsPerStation: 4, roleBonus: 2, perCrewLevel: 0.25, engineeringMedalsPerHour: 0.5 };
export const HOLD_HOURS = { base: 8, perCargoLevel: 1, max: 16 };
/** Less than this and there is nothing to collect yet (no claim screen for a quick tab switch). */
export const IDLE_MIN_MS = 5 * 60000;
/** The welcome-back screen opens when the hold holds at least this much income time. */
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

const amount = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const tidy = n => Math.round(n * 10000) / 10000;

/**
 * The saved clock, cleaned: since (a time) and what is banked so far ({ credits, medals, hours }, fractions kept).
 * Anything else (a missing or edited clock) reads as no clock at all.
 */
export function normalizeIdle(saved) {
  const since = Number(saved?.since);
  if (!saved || typeof saved !== 'object' || !Number.isFinite(since) || since <= 0) return undefined;
  const b = saved.banked;
  const banked = b && typeof b === 'object'
    ? { credits: Math.min(100000, amount(b.credits)), medals: Math.min(10000, amount(b.medals)), hours: Math.min(HOLD_HOURS.max, amount(b.hours)) } : null;
  return banked ? { since, banked } : { since };
}

/** The exact (unrounded) haul: the banked part plus the stretch since the clock last moved, at today's rate. */
function accrued(player, now) {
  const idle = normalizeIdle(player?.idle);
  if (!idle) return null;
  const cap = holdHours(player);
  const bank = idle.banked || { credits: 0, medals: 0, hours: 0 };
  const rates = idleRates(player, now);
  // Only earning hours fill the hold: time with nobody at a station neither pays nor uses it up.
  const earning = rates.credits + rates.medals > 0;
  const hours = earning ? Math.min(Math.max(0, cap - bank.hours), Math.max(0, now - idle.since) / HOUR) : 0;
  return { since: idle.since, cap, hours: bank.hours + hours, credits: bank.credits + rates.credits * hours, medals: bank.medals + rates.medals * hours };
}

/** What waits in the hold now: hours earned (capped), the haul, and whether the hold is full. */
export function idleHaul(player, now = trustedNow()) {
  const cap = holdHours(player);
  const a = accrued(player, now);
  if (!a) return { hours: 0, capHours: cap, full: false, credits: 0, medals: 0, ready: false, awayMs: 0 };
  const credits = Math.floor(a.credits);
  const medals = Math.floor(a.medals);
  return { hours: a.hours, capHours: cap, full: a.hours >= cap - 1e-9, credits, medals,
    ready: a.hours * HOUR >= IDLE_MIN_MS && credits + medals > 0, awayMs: Math.max(0, now - a.since) };
}

/**
 * Start the clock (after the tutorial) without paying anything. A saved start stays as it is, even one later than
 * now (a clock that ran backwards): the hold earns nothing until real time passes it, so moving the clock forward
 * and back again never refills it.
 */
export function startIdleClock(player, now = trustedNow()) {
  if (normalizeIdle(player?.idle)) return player;
  return { ...player, idle: { since: now } };
}

/** Bank the hold up to now at the current rate and hold size, so a later change only counts from now on. */
export function bankIdle(player, now = trustedNow()) {
  const a = accrued(player, now);
  if (!a || a.since >= now) return player;
  return { ...player, idle: { since: now, banked: { credits: tidy(a.credits), medals: tidy(a.medals), hours: tidy(a.hours) } } };
}

const rateKey = (player, now) => {
  const r = idleRates(player, now);
  return `${r.credits}|${r.medals}|${holdHours(player)}`;
};

/**
 * After anything that changes who earns or how big the hold is (a station, a level, an away team leaving or coming
 * home, an injury healing, a Cargo upgrade): bank what the old setup earned, so the new one is never paid backwards.
 * Leaves alone a change to the clock itself (a collection).
 */
export function settleIdle(before, after, now = trustedNow()) {
  if (!before?.idle || !after?.idle || before.idle !== after.idle) return after;
  if (rateKey(before, now) === rateKey(after, now)) return after;
  const banked = bankIdle(before, now);
  return banked === before ? after : { ...after, idle: banked.idle };
}

/** Collect the hold: the whole credits and medals go into the wallet; fractions stay banked for next time. */
export function claimIdle(player, now = trustedNow()) {
  const haul = idleHaul(player, now);
  if (!haul.ready) return { ok: false, reason: normalizeIdle(player?.idle) ? 'hold_empty' : 'idle_not_started' };
  const a = accrued(player, now);
  const reward = { ...(haul.credits ? { credits: haul.credits } : {}), ...(haul.medals ? { medals: haul.medals } : {}) };
  // The clock never moves backwards: a start later than now (the device clock was set back) is kept.
  const idle = { since: Math.max(now, a.since), banked: { credits: tidy(a.credits - haul.credits), medals: tidy(a.medals - haul.medals), hours: 0 } };
  return { ok: true, reward, haul, player: { ...player, wallet: grant(player.wallet, reward), idle } };
}

/** "8 h", "2 h 15 min", "30 min": how long the stations ran, for the claim screens. */
export function formatHoldSpan(hours) {
  const minutes = Math.floor(Math.max(0, hours) * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** How full the hold is, 0..100. */
export function holdPercent(haul) {
  return haul.full ? 100 : Math.round((haul.hours / haul.capHours) * 100);
}
