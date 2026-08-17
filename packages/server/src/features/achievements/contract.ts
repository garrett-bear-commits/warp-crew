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
