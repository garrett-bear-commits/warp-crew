// Reset every player's journey (runbook reset-all-players): open a new `restart` generation per
// non-erased player. A newer server generation always wins on the client, even with no snapshot,
// so each client starts a fresh save on its next boot, or on its next push if it is in session.
// Wiping tables would not reset anyone: a client whose server copy is empty uploads its local save.
// Old generations keep their snapshots, so admin restore can bring one player back.
//
// Each player resets in its own transaction under the save path's player lock. The restartId is
// derived from (batchId, playerKey), so re-running a batch skips players it already reset.
import { createHash, randomUUID } from 'node:crypto';
import { entitlementFor, type Q, type Tx } from '@foundation/server';

export interface ResetAllPlayersOpts {
  /** UUID naming this reset; reuse it to resume an interrupted run. */
  batchId: string;
  reason: string;
  actor: string;
  apply: boolean;
}

export interface ResetAllPlayersResult {
  /** Non-erased players. */
  players: number;
  /** Players given a new generation by this run. */
  reset: number;
  /** Players this batch had already reset. */
  alreadyReset: number;
  /** Players whose next client boot re-delivers minted purchases into the fresh save. */
  purchasers: number;
  /** Gems those re-deliveries total (paid + sandbox, lifetime). */
  purchasedGems: number;
}

export function batchRestartId(batchId: string, playerKey: string): string {
  const h = createHash('sha256').update(`reset:${batchId}:${playerKey}`).digest('hex');
  // RFC 4122 shape (version 5 nibble, variant 10xx) so it fits the uuid column.
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function resetAllPlayers(
  sql: Q,
  o: ResetAllPlayersOpts,
): Promise<ResetAllPlayersResult> {
  const keys = (
    await sql<
      { player_key: string }[]
    >`SELECT player_key FROM players WHERE erased_at IS NULL ORDER BY player_key`
  ).map((r) => r.player_key);
  const bought = await sql<{ purchasers: number; gems: string }[]>`
    SELECT count(DISTINCT t.player_key)::int AS purchasers, coalesce(sum(t.granted), 0)::text AS gems
    FROM purchase_transactions t JOIN players p ON p.player_key = t.player_key
    WHERE p.erased_at IS NULL AND t.classification IN ('paid', 'sandbox') AND t.granted > 0`;
  const result: ResetAllPlayersResult = {
    players: keys.length,
    reset: 0,
    alreadyReset: 0,
    purchasers: bought[0]?.purchasers ?? 0,
    purchasedGems: Number(bought[0]?.gems ?? 0),
  };
  if (!o.apply) return result;

  for (const playerKey of keys) {
    const restartId = batchRestartId(o.batchId, playerKey);
    const opened = await sql.begin(async (t) => {
      const tx = t as Tx;
      await tx`SELECT pg_advisory_xact_lock(1, hashtext(${playerKey}))`;
      const done =
        await tx`SELECT 1 FROM generations WHERE player_key = ${playerKey} AND restart_id = ${restartId}`;
      if (done.length) return false;
      const cur = await tx<{ generation: number }[]>`
        SELECT generation FROM generations WHERE player_key = ${playerKey} ORDER BY generation DESC LIMIT 1`;
      let next = (cur[0]?.generation ?? -1) + 1;
      // A player who never saved has no lineage yet; clients start at generation 0.
      if (next === 0) {
        await tx`INSERT INTO generations (player_key, generation, kind, actor) VALUES (${playerKey}, 0, 'initial', ${o.actor})`;
        next = 1;
      }
      const entitlement = await entitlementFor(tx, playerKey);
      await tx`
        INSERT INTO generations (player_key, generation, kind, restart_id, entitlement, reason, actor)
        VALUES (${playerKey}, ${next}, 'restart', ${restartId}, ${entitlement}, ${o.reason}, ${o.actor})`;
      return true;
    });
    if (opened) result.reset++;
    else result.alreadyReset++;
  }

  // admin_actions is append-only: each applied run records its own row.
  await sql`
    INSERT INTO admin_actions (admin_key_id, scope, command_type, command_id, target, reason, outcome)
    VALUES (${o.actor}, 'restore', 'lineage.resetAll', ${randomUUID()},
      ${`batch ${o.batchId}: ${result.reset} reset, ${result.alreadyReset} already`}, ${o.reason}, 'ok')`;
  return result;
}
