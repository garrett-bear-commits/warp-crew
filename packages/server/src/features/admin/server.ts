// admin feature (§4.3): admin_actions replay, player overview, inspector reads (timeline · history
// · blob), the five write actions live in their owning features (letter, grant, cohort grant,
// publish, restore) and here: player flags, outbox replay, rebuild-projection. Scoped keys; every
// call audited by the bus. The inspector page itself is a static origin (ADR-021).
import type { FastifyInstance } from 'fastify';
import {
  AdminPlayerFlagBody,
  AdminOutboxReplayBody,
  AdminRebuildProjectionBody,
  type PlayerOverview,
  type TimelineResponse,
  type AdminActionsResponse,
  type OutboxDeadLettersResponse,
  type AdminRebuildProjectionResult,
  type SaveHistoryResponse,
  type SaveBlobResponse,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import * as saves from '../../db/snapshots.ts';
import { entitlementFor } from '../../game/facts.ts';
import { actorLabel } from '../../cqrs/bus.ts';

type RebuildRes = Omit<AdminRebuildProjectionResult, 'serverNow' | 'requestId'>;

export const SetPlayerFlag = defineCommand<typeof AdminPlayerFlagBody, { ok: true }>({
  type: 'admin.setPlayerFlag',
  schema: AdminPlayerFlagBody,
  actorPolicy: { admin: 'support' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
});
export const OutboxReplay = defineCommand<typeof AdminOutboxReplayBody, { ok: true }>({
  type: 'admin.outboxReplay',
  schema: AdminOutboxReplayBody,
  actorPolicy: { admin: 'support' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
});
export const RebuildProjection = defineCommand<typeof AdminRebuildProjectionBody, RebuildRes>({
  type: 'admin.rebuildProjection',
  schema: AdminRebuildProjectionBody,
  actorPolicy: { admin: 'restore' },
  scope: 'game',
  lock: 'game',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

export function registerAdmin(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(SetPlayerFlag, OutboxReplay, RebuildProjection);

  bus.register(SetPlayerFlag, async (input, exec, tx) => {
    if (exec.actor.kind !== 'admin') throw new AppError('forbidden', 'admin only');
    await tx!`INSERT INTO player_flags (player_key, flag, enabled, until, reason, admin_key_id) VALUES (${input.playerKey}, ${input.flag}, ${input.enabled}, ${input.until ? new Date(input.until) : null}, ${input.reason}, ${exec.actor.keyId})
      ON CONFLICT (player_key, flag) DO UPDATE SET enabled = EXCLUDED.enabled, until = EXCLUDED.until, reason = EXCLUDED.reason, admin_key_id = EXCLUDED.admin_key_id, updated_at = now()`;
    return { ok: true as const };
  });

  bus.register(OutboxReplay, async (input, exec, tx) => {
    // replay rides the command's own transaction (audit F7): one connection, atomic with the audit row
    const ok = await ctx.outbox.replayInTx(tx!, input.outboxId, input.consumer, actorLabel(exec));
    if (!ok) throw new AppError('not_found', 'outbox row not found');
    return { ok: true as const };
  });

  bus.register(RebuildProjection, async (input, _exec, tx) => {
    const t = tx!;
    let rows = 0;
    switch (input.projection) {
      case 'players_overview': {
        // players is rebuilt from ledgers: first/last seen from commands + snapshots
        const r = await t`
          INSERT INTO players (player_key, first_seen_at, last_seen_at, registered, seen_days, last_seen_day)
          SELECT x.player_key, min(x.at), max(x.at), false, count(DISTINCT (x.at AT TIME ZONE 'UTC')::date), max((x.at AT TIME ZONE 'UTC')::date)
          FROM (SELECT player_key, received_at AS at FROM save_snapshots UNION ALL SELECT scope_key, received_at FROM commands WHERE scope_key <> 'game') x
          GROUP BY x.player_key
          ON CONFLICT (player_key) DO UPDATE SET first_seen_at = LEAST(players.first_seen_at, EXCLUDED.first_seen_at), last_seen_at = GREATEST(players.last_seen_at, EXCLUDED.last_seen_at), seen_days = GREATEST(players.seen_days, EXCLUDED.seen_days)`;
        rows = r.count;
        break;
      }
      case 'entitlements': {
        // entitlement is derived on read (Σpaid − Σrefunded); verify by recount
        const r = await t<
          { n: number }[]
        >`SELECT count(DISTINCT player_key)::int AS n FROM purchase_transactions`;
        rows = r[0]?.n ?? 0;
        break;
      }
      case 'leaderboard_entries': {
        const seasons = await t<
          { board_key: string; season_key: string }[]
        >`SELECT board_key, season_key FROM leaderboard_seasons`;
        for (const s of seasons) {
          await t`DELETE FROM leaderboard_entries WHERE board_key = ${s.board_key} AND season_key = ${s.season_key}`;
          const r = await t`
            INSERT INTO leaderboard_entries (board_key, season_key, player_key, best_submission_id, score, elapsed_ms)
            SELECT DISTINCT ON (x.player_key) x.board_key, x.season_key, x.player_key, x.id, x.score, x.elapsed_ms
            FROM leaderboard_submissions x LEFT JOIN leaderboard_reviews rv ON rv.submission_id = x.id
            WHERE x.board_key = ${s.board_key} AND x.season_key = ${s.season_key}
              AND ((x.visibility = 'visible' AND rv.action IS DISTINCT FROM 'reject') OR (x.visibility = 'quarantined' AND rv.action = 'approve'))
            ORDER BY x.player_key, x.score DESC, x.elapsed_ms ASC, x.id ASC`;
          rows += r.count;
        }
        break;
      }
      case 'achievement_progress': {
        // unlocks are the ledger; progress rows without an unlock are recomputed by the next evaluate
        const r =
          await t`UPDATE achievement_progress p SET unlocked = EXISTS (SELECT 1 FROM achievement_unlocks u WHERE u.player_key = p.player_key AND u.achievement_id = p.achievement_id),
          grant_key = (SELECT u.grant_key FROM achievement_unlocks u WHERE u.player_key = p.player_key AND u.achievement_id = p.achievement_id),
          unlocked_at = (SELECT u.at FROM achievement_unlocks u WHERE u.player_key = p.player_key AND u.achievement_id = p.achievement_id)`;
        rows = r.count;
        break;
      }
    }
    return { projection: input.projection, rows, duplicate: false };
  });

  route<typeof AdminPlayerFlagBody, typeof import('@foundation/contracts').Ok>(
    app,
    ctx,
    'admin.playerFlag',
    async ({ body, exec }) =>
      bus.execute(SetPlayerFlag, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminOutboxReplayBody, typeof import('@foundation/contracts').Ok>(
    app,
    ctx,
    'admin.outboxReplay',
    async ({ body, exec }) =>
      bus.execute(OutboxReplay, { commandId: body.commandId, payload: body }, exec!),
  );
  route<
    typeof AdminRebuildProjectionBody,
    typeof import('@foundation/contracts').AdminRebuildProjectionResult
  >(app, ctx, 'admin.rebuildProjection', async ({ body, exec }) =>
    bus.execute(RebuildProjection, { commandId: body.commandId, payload: body }, exec!),
  );

  route<
    undefined,
    typeof import('@foundation/contracts').PlayerOverview,
    typeof import('@foundation/contracts').AdminPlayerParams
  >(app, ctx, 'admin.player', async ({ params, now }) => {
    const sql = ctx.db.sql;
    const pk = params.playerKey;
    const p = await sql<
      {
        first_seen_at: Date;
        last_seen_at: Date;
        registered: boolean;
        last_build: string | null;
        erased_at: Date | null;
      }[]
    >`SELECT first_seen_at, last_seen_at, registered, last_build, erased_at FROM players WHERE player_key = ${pk}`;
    const gen = await saves.activeGeneration(sql, pk);
    const anchor = gen ? await saves.anchorRow(sql, pk, gen.generation) : null;
    const pending = gen
      ? await saves.pendingQuarantineRow(
          sql,
          pk,
          gen.generation,
          anchor ? Number(anchor.progress) : null,
        )
      : null;
    const flags = await sql<
      {
        flag: 'purchases_disabled' | 'boards_hidden' | 'grants_frozen';
        until: Date | null;
        reason: string;
      }[]
    >`SELECT flag, until, reason FROM player_flags WHERE player_key = ${pk} AND enabled AND (until IS NULL OR until > ${new Date(now)})`;
    const strikes = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM player_strikes WHERE player_key = ${pk}`;
    const paid = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM purchase_transactions WHERE player_key = ${pk} AND classification = 'paid'`;
    const grantsPending = await sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM grants g WHERE g.player_key = ${pk} AND NOT EXISTS (SELECT 1 FROM grant_claims c WHERE c.grant_id = g.id)`;
    const out: Omit<PlayerOverview, 'serverNow' | 'requestId'> = {
      playerKey: pk,
      ...(p[0]
        ? { firstSeenAt: p[0].first_seen_at.getTime(), lastSeenAt: p[0].last_seen_at.getTime() }
        : {}),
      registered: p[0]?.registered ?? false,
      ...(p[0]?.last_build ? { lastBuildVersion: p[0].last_build } : {}),
      generation: gen?.generation ?? 0,
      generationKind: gen?.kind ?? 'initial',
      ...(anchor ? { anchor: saves.toMeta(anchor) } : {}),
      ...(pending ? { pendingQuarantine: saves.toMeta(pending) } : {}),
      entitlement: await entitlementFor(sql, pk),
      paidCount: paid[0]?.n ?? 0,
      flags: flags.map((f) => ({
        flag: f.flag,
        ...(f.until ? { until: f.until.getTime() } : {}),
        reason: f.reason,
      })),
      strikes: strikes[0]?.n ?? 0,
      grantsPending: grantsPending[0]?.n ?? 0,
      erased: !!p[0]?.erased_at,
    };
    return out;
  });

  route<
    undefined,
    typeof import('@foundation/contracts').TimelineResponse,
    typeof import('@foundation/contracts').AdminPlayerParams
  >(app, ctx, 'admin.timeline', async ({ params }) => {
    const rows = await ctx.db.sql<
      { at: Date; kind: string; ref: string; summary: string; detail: unknown }[]
    >`SELECT at, kind, ref, summary, detail FROM player_timeline WHERE player_key = ${params.playerKey} ORDER BY at DESC LIMIT 500`;
    const out: Omit<TimelineResponse, 'serverNow' | 'requestId'> = {
      playerKey: params.playerKey,
      items: rows.map((r) => ({
        at: r.at.getTime(),
        kind: r.kind,
        ref: r.ref,
        summary: r.summary,
        ...(r.detail !== null ? { detail: r.detail } : {}),
      })),
    };
    return out;
  });

  route<
    undefined,
    typeof import('@foundation/contracts').SaveHistoryResponse,
    typeof import('@foundation/contracts').AdminPlayerParams,
    typeof import('@foundation/contracts').SaveHistoryQuery
  >(app, ctx, 'admin.history', async ({ params, query }) => {
    const gen = await saves.activeGeneration(ctx.db.sql, params.playerKey);
    const rows = await saves.history(
      ctx.db.sql,
      params.playerKey,
      query.generation ?? null,
      query.limit ?? 100,
      query.beforeSeq ?? null,
    );
    const out: Omit<SaveHistoryResponse, 'serverNow' | 'requestId'> = {
      generation: query.generation ?? gen?.generation ?? 0,
      items: rows.map(saves.toMeta),
    };
    return out;
  });

  route<undefined, typeof import('@foundation/contracts').SaveBlobResponse>(
    app,
    ctx,
    'admin.blob',
    async ({ params }) => {
      const p = params as { playerKey: string; seq: string };
      const row = await saves.snapshotBySeq(ctx.db.sql, p.playerKey, Number(p.seq));
      if (!row) throw new AppError('not_found', 'no such seq');
      const blob = await saves.blobById(ctx.db.sql, Number(row.id));
      if (blob === null) throw new AppError('not_found', 'blob pruned');
      const out: Omit<SaveBlobResponse, 'serverNow' | 'requestId'> = {
        seq: Number(row.seq),
        generation: row.generation,
        enc: 'json',
        blob,
        blobSha256: row.blob_sha256,
      };
      return out;
    },
  );

  route<undefined, typeof import('@foundation/contracts').AdminActionsResponse>(
    app,
    ctx,
    'admin.actions',
    async () => {
      const rows = await ctx.db.sql<
        {
          id: string;
          admin_key_id: string;
          scope: string;
          command_type: string;
          command_id: string;
          target: string | null;
          reason: string | null;
          at: Date;
          outcome: string;
        }[]
      >`SELECT id, admin_key_id, scope, command_type, command_id, target, reason, at, outcome FROM admin_actions ORDER BY at DESC LIMIT 500`;
      const out: Omit<AdminActionsResponse, 'serverNow' | 'requestId'> = {
        items: rows.map((r) => ({
          id: Number(r.id),
          adminKeyId: r.admin_key_id,
          scope: r.scope,
          commandType: r.command_type,
          commandId: r.command_id,
          ...(r.target ? { target: r.target } : {}),
          ...(r.reason ? { reason: r.reason } : {}),
          at: r.at.getTime(),
          outcome: r.outcome,
        })),
      };
      return out;
    },
  );

  route<undefined, typeof import('@foundation/contracts').OutboxDeadLettersResponse>(
    app,
    ctx,
    'admin.deadLetters',
    async () => {
      const rows = await ctx.db.sql<
        {
          id: string;
          outbox_id: string;
          consumer: string;
          kind: string;
          attempts: number;
          last_error: string;
          dead_at: Date;
          replayed_at: Date | null;
        }[]
      >`SELECT l.id, l.outbox_id, l.consumer, o.kind, l.attempts, l.last_error, l.dead_at, l.replayed_at FROM outbox_dead_letters l JOIN outbox o ON o.id = l.outbox_id ORDER BY l.dead_at DESC LIMIT 500`;
      const out: Omit<OutboxDeadLettersResponse, 'serverNow' | 'requestId'> = {
        items: rows.map((r) => ({
          id: Number(r.id),
          outboxId: Number(r.outbox_id),
          consumer: r.consumer,
          kind: r.kind,
          attempts: r.attempts,
          lastError: r.last_error,
          deadAt: r.dead_at.getTime(),
          ...(r.replayed_at ? { replayedAt: r.replayed_at.getTime() } : {}),
        })),
      };
      return out;
    },
  );
}
