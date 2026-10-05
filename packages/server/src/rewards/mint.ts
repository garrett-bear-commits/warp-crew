// Core reward primitive (not a feature entry point) shared by every feature that mints (purchases, achievements, codes, admin,
// placements, daily rewards). Every reward is a grant (ADR-008). Idempotent by (player, grantKey):
// an existing key returns the existing grant; a concurrent insert of the same key raises (never
// swallowed). Client-claim-sourced premium is capped by the per-player lifetime budget.
import type { Tx } from '../db/index.ts';
import type { GrantReward, Grant } from '@foundation/contracts';
import type { GrantSource } from '@foundation/contracts/enums';

export interface MintInput {
  playerKey: string;
  grantKey: string;
  source: GrantSource;
  rewards: GrantReward[];
  reason: string;
  actor: string;
  commandId: string | null;
  ticketRef?: string | null;
  title?: string | null;
  body?: string | null;
  expiresAt?: number | null;
  /** Rewards derive from client claims: premium is capped by the lifetime budget. */
  claimSourced?: boolean;
  claimBudget?: number;
}

export interface MintResult {
  id: number;
  created: boolean;
  grant: Grant;
  /** premium removed to stay within the client-claim budget */
  cappedBy: number;
}

export function premiumOf(rewards: readonly GrantReward[]): number {
  return rewards.reduce((n, r) => (r.kind === 'premium_currency' ? n + r.amount : n), 0);
}

interface GrantRow {
  id: string;
  grant_key: string;
  source: GrantSource;
  rewards: GrantReward[];
  reason: string;
  ticket_ref: string | null;
  title: string | null;
  body: string | null;
  created_at: Date;
  expires_at: Date | null;
  claimed_at: Date | null;
}

export function toGrant(r: GrantRow): Grant {
  const g: Grant = {
    grantKey: r.grant_key,
    source: r.source,
    rewards: r.rewards,
    reason: r.reason,
    createdAt: r.created_at.getTime(),
  };
  if (r.ticket_ref) g.ticketRef = r.ticket_ref;
  if (r.title) g.title = r.title;
  if (r.body) g.body = r.body;
  if (r.expires_at) g.expiresAt = r.expires_at.getTime();
  if (r.claimed_at) g.claimedAt = r.claimed_at.getTime();
  return g;
}

export const GRANT_COLS = `g.id, g.grant_key, g.source, g.rewards, g.reason, g.ticket_ref, g.title, g.body, g.created_at, g.expires_at, (SELECT c.claimed_at FROM grant_claims c WHERE c.grant_id = g.id) AS claimed_at`;

export async function mintGrant(tx: Tx, m: MintInput): Promise<MintResult> {
  await tx`SELECT pg_advisory_xact_lock(1, hashtext(${m.playerKey}))`;
  const existing = await tx.unsafe<GrantRow[]>(
    `SELECT ${GRANT_COLS} FROM grants g WHERE g.player_key = $1 AND g.grant_key = $2`,
    [m.playerKey, m.grantKey],
  );
  if (existing[0])
    return { id: Number(existing[0].id), created: false, grant: toGrant(existing[0]), cappedBy: 0 };
  let rewards = m.rewards;
  let cappedBy = 0;
  if (m.claimSourced) {
    const used = await tx<
      { n: string }[]
    >`SELECT coalesce(sum(premium_amount),0)::text AS n FROM grants WHERE player_key = ${m.playerKey} AND claim_sourced`;
    const remaining = Math.max(0, (m.claimBudget ?? 0) - Number(used[0]?.n ?? 0));
    const want = premiumOf(rewards);
    if (want > remaining) {
      cappedBy = want - remaining;
      let left = remaining;
      rewards = rewards.map((r) => {
        if (r.kind !== 'premium_currency') return r;
        const give = Math.min(r.amount, left);
        left -= give;
        return { ...r, amount: give };
      });
    }
  }
  const premium = premiumOf(rewards);
  const rows = await tx<GrantRow[]>`
    INSERT INTO grants (player_key, grant_key, source, rewards, premium_amount, reason, ticket_ref, title, body, actor, command_id, claim_sourced, expires_at)
    VALUES (${m.playerKey}, ${m.grantKey}, ${m.source}, ${tx.json(rewards as never)}, ${premium}, ${m.reason}, ${m.ticketRef ?? null}, ${m.title ?? null}, ${m.body ?? null}, ${m.actor}, ${m.commandId}, ${m.claimSourced ?? false}, ${m.expiresAt ? new Date(m.expiresAt) : null})
    RETURNING id, grant_key, source, rewards, reason, ticket_ref, title, body, created_at, expires_at, NULL::timestamptz AS claimed_at`;
  return { id: Number(rows[0]!.id), created: true, grant: toGrant(rows[0]!), cappedBy };
}
