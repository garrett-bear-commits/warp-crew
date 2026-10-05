// achievements contract entry (isomorphic): schemas/types + the pure evaluator shared by the
// server (authoritative, over ledgers) and the client (preview over local state).
export type {
  AchievementsDocument,
  AchievementDefinition,
  Criterion,
  AchievementProgress,
  DailyRewardsDocument,
  AchievementsMeResponse,
  AchievementsEvaluateResult,
  DailyClaimResult,
  DailyStatusResponse,
  DailyClaimRecord,
} from '@foundation/contracts';
import type { AchievementDefinition, Criterion, AchievementProgress } from '@foundation/contracts';

/** Facts the evaluator reads. server_fact keys come from ledgers; client_claim keys from the summary/journal. */
export interface EvalFacts {
  serverFacts: Record<string, number>;
  progress: number;
  summary: Record<string, number>;
  journalEventCounts: Record<string, number>;
}

export function criterionValue(c: Criterion, f: EvalFacts): number {
  if (c.source === 'server_fact') return f.serverFacts[c.fact] ?? 0;
  if (c.fact === 'progress') return f.progress;
  if (c.fact === 'summary') return c.key ? (f.summary[c.key] ?? 0) : 0;
  return c.key ? (f.journalEventCounts[c.key] ?? 0) : 0;
}

export function evaluateAchievement(
  def: AchievementDefinition,
  f: EvalFacts,
  now: number,
): { unlocked: boolean; progress: AchievementProgress['progress'] } {
  if (def.window && (now < def.window.startsAt || now >= def.window.endsAt)) {
    return {
      unlocked: false,
      progress: def.criteria.map((c, index) => ({
        index,
        current: 0,
        target: c.value,
        source: c.source,
      })),
    };
  }
  const progress = def.criteria.map((c, index) => ({
    index,
    current: Math.min(criterionValue(c, f), c.value),
    target: c.value,
    source: c.source,
  }));
  return { unlocked: progress.every((p) => p.current >= p.target), progress };
}

/** An achievement's rewards derive from client claims iff any criterion is client_claim-sourced. */
export function isClaimSourced(def: AchievementDefinition): boolean {
  return def.criteria.some((c) => c.source === 'client_claim');
}

/** One rolling period of the daily reward. */
export const DAILY_PERIOD_MS = 86_400_000;

export interface DailyClaimRow {
  /** Server UTC day (YYYY-MM-DD) the claim was recorded under. */
  day: string;
  /** Server-clock claim time, epoch ms. */
  at: number;
  ladderDay: number;
  grantKey: string;
}

export interface DailyDecisionInput {
  cadence: 'utc_day' | 'rolling_24h';
  /** Server clock, epoch ms. */
  now: number;
  /** The claim recorded under today's UTC day (read by the utc_day cadence). */
  today: DailyClaimRow | null;
  /** The player's most recent claim, any day and generation. */
  last: DailyClaimRow | null;
  /** Latest anchored progress of the current generation. */
  progress: number;
  minProgress: number;
  ladderLen: number;
  generation: number;
}

export type DailyDecision =
  | { kind: 'claim'; day: string; ladderDay: number; grantKey: string; nextEligibleAt: number }
  | { kind: 'cooldown'; ladderDay: number; grantKey: string; nextEligibleAt: number }
  | { kind: 'not_eligible'; nextEligibleAt: number };

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Decide a daily claim on the server clock (pure). `utc_day`: once per UTC day, the ladder
 * advances on consecutive days. `rolling_24h`: the next claim opens exactly 24 h after the last
 * server-stamped claim (a clock set back stays locked), missed days never stack, the ladder
 * advances when a claim lands within 24 h of opening, and grant keys carry the generation
 * (`daily:g<generation>:<UTC day>`); two claims 24 h apart never share a UTC day.
 */
export function decideDailyClaim(i: DailyDecisionInput): DailyDecision {
  const len = Math.max(1, i.ladderLen);
  const next = (last: DailyClaimRow) => (last.ladderDay % len) + 1;
  if (i.cadence === 'rolling_24h') {
    if (i.last && !(i.now >= i.last.at + DAILY_PERIOD_MS))
      return {
        kind: 'cooldown',
        ladderDay: i.last.ladderDay,
        grantKey: i.last.grantKey,
        nextEligibleAt: i.last.at + DAILY_PERIOD_MS,
      };
    if (i.progress < i.minProgress) return { kind: 'not_eligible', nextEligibleAt: i.now };
    const day = utcDay(i.now);
    return {
      kind: 'claim',
      day,
      ladderDay: i.last && i.now < i.last.at + 2 * DAILY_PERIOD_MS ? next(i.last) : 1,
      grantKey: `daily:g${i.generation}:${day}`,
      nextEligibleAt: i.now + DAILY_PERIOD_MS,
    };
  }
  const now = new Date(i.now);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const nextEligibleAt = dayStart + DAILY_PERIOD_MS;
  if (i.today)
    return {
      kind: 'cooldown',
      ladderDay: i.today.ladderDay,
      grantKey: i.today.grantKey,
      nextEligibleAt,
    };
  if (i.progress < i.minProgress) return { kind: 'not_eligible', nextEligibleAt: i.now };
  const day = utcDay(i.now);
  const yesterday = utcDay(dayStart - DAILY_PERIOD_MS);
  return {
    kind: 'claim',
    day,
    ladderDay: i.last && i.last.day === yesterday ? next(i.last) : 1,
    grantKey: `daily:${day}`,
    nextEligibleAt,
  };
}
