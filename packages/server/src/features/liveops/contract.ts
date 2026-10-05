// liveops contract entry (isomorphic): schemas/types re-exported + pure evaluators (flags rollout,
// segment predicates) shared by server and client preview.
export type {
  FlagDefinition,
  FlagState,
  FlagValue,
  ScheduleWindow,
  SegmentPredicate,
  ConfigResponse,
  ContentDocumentResponse,
  ContentVersionInfo,
} from '@foundation/contracts';
export { CONTENT_KINDS, FLAG_TYPES } from '@foundation/contracts/enums';

export type Facts = Record<string, string | number | boolean>;

/** Evaluate a JSON predicate over declared facts. Unknown facts evaluate to false (fail closed). */
export function evaluateSegment(
  p: import('@foundation/contracts').SegmentPredicate,
  facts: Facts,
): boolean {
  if ('all' in p) return p.all.every((x) => evaluateSegment(x, facts));
  if ('any' in p) return p.any.some((x) => evaluateSegment(x, facts));
  if ('not' in p) return !evaluateSegment(p.not, facts);
  const v = facts[p.fact];
  if (v === undefined) return false;
  switch (p.op) {
    case 'eq':
      return v === p.value;
    case 'neq':
      return v !== p.value;
    case 'gt':
      return typeof v === 'number' && typeof p.value === 'number' && v > p.value;
    case 'gte':
      return typeof v === 'number' && typeof p.value === 'number' && v >= p.value;
    case 'lt':
      return typeof v === 'number' && typeof p.value === 'number' && v < p.value;
    case 'lte':
      return typeof v === 'number' && typeof p.value === 'number' && v <= p.value;
    case 'in':
      return Array.isArray(p.value) && (p.value as unknown[]).includes(v);
  }
  return false;
}

/** Sticky rollout hash: FNV-1a over `${key}:${playerKey}` → [0, 100). Deterministic, no crypto (browser-safe). */
export function rolloutBucket(flagKey: string, playerKey: string): number {
  const s = `${flagKey}:${playerKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Resolve one flag for a player. Returns {value, shadow} where value is the applied value (fallback outside rollout / before activateAt / when disabled). */
export function resolveFlag(
  f: import('@foundation/contracts').FlagState,
  playerKey: string | null,
  now: number,
  inSegment: boolean,
): { value: import('@foundation/contracts').FlagValue; on: boolean } {
  if (!f.enabled) return { value: f.fallback, on: false };
  if (f.activateAt !== undefined && now < f.activateAt) return { value: f.fallback, on: false };
  if (f.segmentId && !inSegment) return { value: f.fallback, on: false };
  if (f.rolloutPercent < 100) {
    if (!playerKey) return { value: f.fallback, on: false };
    if (rolloutBucket(f.key, playerKey) >= f.rolloutPercent)
      return { value: f.fallback, on: false };
  }
  return { value: f.value, on: true };
}
