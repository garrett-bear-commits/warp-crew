// Declared per-player facts (server_fact) used by segments, cohort grants and achievements.
// Everything here comes from ledgers/projections; the only client claim included is `progress`
// (tagged as such by consumers).
import type { Q } from '../db/index.ts';
import type { Facts } from '../features/liveops/contract.ts';

export const DECLARED_FACTS = [
  'registered',
  'seen_days',
  'days_since_first_seen',
  'days_since_last_seen',
  'paid_count',
  'paid_total',
  'entitlement',
  'generation',
  'progress',
  'build',
  'strikes',
  'grants_claimed',
  'codes_redeemed',
  'placements_confirmed',
] as const;

export async function playerFacts(q: Q, playerKey: string, now: number): Promise<Facts> {
  const p = await q<
    {
      registered: boolean;
      seen_days: number;
      first_seen_at: Date;
      last_seen_at: Date;
      last_build: string | null;
    }[]
  >`SELECT registered, seen_days, first_seen_at, last_seen_at, last_build FROM players WHERE player_key = ${playerKey}`;
  const paid = await q<
    { n: number; total: string }[]
  >`SELECT count(*)::int AS n, coalesce(sum(granted),0)::text AS total FROM purchase_transactions WHERE player_key = ${playerKey} AND classification = 'paid' AND duplicate_of IS NULL`;
  const adj = await q<
    { n: string }[]
  >`SELECT coalesce(sum(delta),0)::text AS n FROM purchase_adjustments WHERE player_key = ${playerKey}`;
  const gen = await q<
    { generation: number }[]
  >`SELECT max(generation)::int AS generation FROM generations WHERE player_key = ${playerKey}`;
  const prog = await q<{ progress: string | null }[]>`
    SELECT s.progress::text AS progress FROM save_snapshots s WHERE s.player_key = ${playerKey} AND s.generation = (SELECT max(generation) FROM generations WHERE player_key = ${playerKey})
      AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote')) ORDER BY s.progress DESC, s.seq DESC LIMIT 1`;
  const strikes = await q<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM player_strikes WHERE player_key = ${playerKey}`;
  const claimed = await q<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM grant_claims WHERE player_key = ${playerKey}`;
  const codes = await q<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM code_redemptions WHERE player_key = ${playerKey}`;
  const placements = await q<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM leaderboard_placements WHERE player_key = ${playerKey} AND state = 'confirmed'`;
  const row = p[0];
  const day = 86_400_000;
  return {
    registered: row?.registered ?? false,
    seen_days: row?.seen_days ?? 0,
    days_since_first_seen: row ? Math.floor((now - row.first_seen_at.getTime()) / day) : 0,
    days_since_last_seen: row ? Math.floor((now - row.last_seen_at.getTime()) / day) : 0,
    paid_count: paid[0]?.n ?? 0,
    paid_total: Number(paid[0]?.total ?? 0),
    entitlement: Math.max(0, Number(paid[0]?.total ?? 0) + Number(adj[0]?.n ?? 0)),
    generation: gen[0]?.generation ?? 0,
    progress: Number(prog[0]?.progress ?? 0),
    build: row?.last_build ?? '',
    strikes: strikes[0]?.n ?? 0,
    grants_claimed: claimed[0]?.n ?? 0,
    codes_redeemed: codes[0]?.n ?? 0,
    placements_confirmed: placements[0]?.n ?? 0,
  };
}

/** entitlement for a restart = Σpaid − Σrefunded (ADR-007), read from the purchase ledgers. */
export async function entitlementFor(q: Q, playerKey: string): Promise<number> {
  const paid = await q<
    { n: string }[]
  >`SELECT coalesce(sum(granted), 0)::text AS n FROM purchase_transactions WHERE player_key = ${playerKey} AND classification = 'paid'`;
  const adj = await q<
    { n: string }[]
  >`SELECT coalesce(sum(delta), 0)::text AS n FROM purchase_adjustments WHERE player_key = ${playerKey}`;
  return Math.max(0, Number(paid[0]?.n ?? 0) + Number(adj[0]?.n ?? 0));
}

/** All known player keys (for cohort operations); paginated by key. */
export async function allPlayerKeys(
  q: Q,
  afterKey: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await q<
    { player_key: string }[]
  >`SELECT player_key FROM players WHERE erased_at IS NULL AND (${afterKey}::text IS NULL OR player_key > ${afterKey}) ORDER BY player_key LIMIT ${limit}`;
  return rows.map((r) => r.player_key);
}
