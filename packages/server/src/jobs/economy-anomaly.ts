// Nightly economy anomaly scan (§8): z-score over the latest anchored save summary scalars; a
// player more than 4σ from the population mean on a key is written to integrity_events. A policy
// may limit the scan to its declared anomaly keys (the rest are analytics scalars).
import type { Db } from '../db/index.ts';
import type { ServerClock } from '../clock/index.ts';
import type { GamePolicy } from '../game/config.ts';
import type { SentryHandle } from '../observability/sentry.ts';

/** Server-written kind: never in the client-submittable INTEGRITY_EVENT_KINDS. */
export const ECONOMY_ANOMALY_KIND = 'economy_anomaly';
/** A player already flagged on a key is not flagged again for it within this window. */
export const ECONOMY_ANOMALY_REFLAG_MS = 7 * 24 * 3_600_000;
const Z_LIMIT = 4;
const MIN_POPULATION = 20;

export interface EconomyAnomalyResult {
  keys: number;
  /** players × keys beyond the limit tonight */
  outliers: number;
  /** newly written integrity events (outliers minus those flagged within the window) */
  flagged: number;
  byKey: Record<string, number>;
}

export async function runEconomyAnomaly(
  db: Db,
  clock: ServerClock,
  policy: Pick<GamePolicy, 'anomalyKeys'>,
  sentry?: Pick<SentryHandle, 'captureMessage'>,
): Promise<EconomyAnomalyResult> {
  const declared = policy.anomalyKeys;
  const only = declared ? db.sql`AND k.key = ANY(${[...declared]}::text[])` : db.sql``;
  const now = new Date(clock.now());
  const since = new Date(clock.now() - ECONOMY_ANOMALY_REFLAG_MS);
  // One statement: stats, outliers, dedupe against recent flags, and a batched insert.
  const rows = await db.sql<
    { keys: number; outliers: number; flagged: number; by_key: Record<string, number> | null }[]
  >`
    WITH latest AS (
      SELECT DISTINCT ON (player_key) player_key, summary FROM save_snapshots
      WHERE disposition = 'anchored' AND summary IS NOT NULL ORDER BY player_key, seq DESC),
    vals AS (
      SELECT l.player_key, k.key, (l.summary->>k.key)::float8 AS v
      FROM latest l, LATERAL jsonb_object_keys(l.summary) k(key)
      WHERE jsonb_typeof(l.summary->k.key) = 'number' ${only}),
    stats AS (
      SELECT key, avg(v) AS mean, coalesce(stddev_pop(v), 0) AS stddev, count(*) AS n
      FROM vals GROUP BY key),
    outliers AS (
      SELECT v.player_key, v.key, v.v, s.mean, s.stddev FROM vals v JOIN stats s USING (key)
      WHERE s.n >= ${MIN_POPULATION} AND s.stddev > 0 AND abs(v.v - s.mean) > ${Z_LIMIT} * s.stddev),
    fresh AS (
      SELECT o.* FROM outliers o WHERE NOT EXISTS (
        SELECT 1 FROM integrity_events e
        WHERE e.player_key = o.player_key AND e.kind = ${ECONOMY_ANOMALY_KIND}
          AND e.at >= ${since} AND e.detail->>'key' = o.key)),
    ins AS (
      INSERT INTO integrity_events (player_key, kind, at, detail, message)
      SELECT player_key, ${ECONOMY_ANOMALY_KIND}, ${now},
             jsonb_build_object('key', key, 'value', v, 'mean', mean, 'stddev', stddev,
                                'z', round(((v - mean) / nullif(stddev, 0))::numeric, 2)),
             'economy anomaly (z > 4)'
      FROM fresh
      RETURNING detail->>'key' AS key)
    SELECT (SELECT count(*) FROM stats)::int AS keys,
           (SELECT count(*) FROM outliers)::int AS outliers,
           (SELECT count(*) FROM ins)::int AS flagged,
           (SELECT jsonb_object_agg(key, n) FROM (SELECT key, count(*)::int AS n FROM ins GROUP BY key) x) AS by_key`;
  const r = rows[0]!;
  const result: EconomyAnomalyResult = {
    keys: r.keys,
    outliers: r.outliers,
    flagged: r.flagged,
    byKey: r.by_key ?? {},
  };
  if (result.flagged > 0)
    sentry?.captureMessage(`economy anomaly: ${result.flagged} new outliers`, {
      level: 'warning',
      fingerprint: ['economy-anomaly'],
      tags: { integrity_kind: ECONOMY_ANOMALY_KIND },
      context: { ...result },
    });
  return result;
}
