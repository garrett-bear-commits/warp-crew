// saves feature (§4.3, ADR-006): save_snapshots (+ save_blobs), placement guard, deepest anchor,
// retention, history, blob-by-seq, pendingQuarantine, terminal reviews.
import type { FastifyInstance } from 'fastify';
import {
  SaveWriteBody,
  type SaveWriteResult,
  type SaveCurrentResponse,
  type SaveHistoryResponse,
  type SaveBlobResponse,
  type SnapshotMeta,
  AdminSaveReviewBody,
  type AdminSaveReviewResult,
} from '@foundation/contracts';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { decodeBlob } from '../../codec/blob.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import { place } from './placement.ts';
import * as repo from '../../db/snapshots.ts';
import { actorLabel } from '../../cqrs/bus.ts';

type WriteResult = Omit<SaveWriteResult, 'serverNow' | 'requestId'>;
type ReviewResult = Omit<AdminSaveReviewResult, 'serverNow' | 'requestId'>;

/**
 * Replay semantics for a retried commandId (§4.1, audit F3): a retry of an ANCHORED write replays
 * `duplicate` (the row exists, nothing new happened); a retry of a refused or quarantined write
 * replays the ORIGINAL disposition with its reason/flags/divergence so the client never turns a
 * refusal into "saved to cloud". The tombstone keeps the full result so the same holds after > 7 d.
 */
export function replaySaveResult(stored: WriteResult): WriteResult {
  if (stored.disposition === 'anchored') return { ...stored, disposition: 'duplicate' };
  return stored;
}

export function saveTombstoneRef(r: WriteResult): string {
  return JSON.stringify(r);
}

export function saveFromTombstone(ref: string | null): WriteResult {
  const t = JSON.parse(ref ?? '{}') as Partial<WriteResult>;
  const base: WriteResult = {
    disposition: t.disposition ?? 'anchored',
    seq: t.seq ?? 0,
    generation: t.generation ?? 0,
    currentProgress: t.currentProgress ?? 0,
    blobSha256: t.blobSha256 ?? '0'.repeat(64),
  };
  if (t.reason) base.reason = t.reason;
  if (t.flags && t.flags.length) base.flags = t.flags;
  if (t.divergent) base.divergent = t.divergent;
  return replaySaveResult(base);
}

export const SavesWrite = defineCommand<typeof SaveWriteBody, WriteResult>({
  type: 'saves.write',
  schema: SaveWriteBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '7d' },
  tx: 'required',
  limit: 'saves.write',
  replay: { fromStored: replaySaveResult, fromTombstone: saveFromTombstone },
  outcomeRef: saveTombstoneRef,
});

export const SavesReview = defineCommand<typeof AdminSaveReviewBody, ReviewResult>({
  type: 'saves.review',
  schema: AdminSaveReviewBody,
  actorPolicy: { admin: 'restore' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

export const SAVE_RULE_VERSION = 'v1';

export function registerSaves(app: FastifyInstance, ctx: AppContext): void {
  const { bus, game, policy } = ctx;
  ctx.declaredCommands.push(SavesWrite, SavesReview);

  const writeHandler = async (
    input: typeof SaveWriteBody extends infer S
      ? S extends { static: infer T }
        ? T
        : never
      : never,
    exec: import('../../cqrs/define.ts').ExecCtx,
    tx: import('../../db/index.ts').Tx | null,
  ): Promise<WriteResult> => {
    const playerKey = exec.playerKey!;
    const t = tx!;
    const source = exec.transport === 'beacon' ? 'beacon' : 'client';
    const gen = await repo.ensureLineage(t, playerKey, actorLabel(exec));
    if (await repo.isErased(t, playerKey)) {
      // erased players: nothing is stored under the old key; the client sees verdict `erased`
      throw new AppError('forbidden', 'player erased', { erased: true });
    }
    const decoded = await decodeBlob(input.enc, input.blob, game.blobLimits);
    let blobValid = decoded.ok;
    let summary = input.summary ?? null;
    let schemaVersion = input.schemaVersion;
    let plausible: boolean | undefined;
    if (decoded.ok) {
      const pol = policy.validateBlob(decoded.value);
      blobValid = pol.ok;
      if (pol.summary) summary = pol.summary;
      if (pol.schemaVersion !== undefined) schemaVersion = pol.schemaVersion;
      if (summary && policy.summaryPlausible)
        plausible = policy.summaryPlausible(summary, input.progress);
    }
    const head = await repo.storedHead(t, playerKey, gen.generation);
    const last = await repo.lastRow(t, playerKey);
    const placement = place(
      {
        generation: input.generation,
        progress: input.progress,
        clientSeq: input.clientSeq,
        baseSeq: input.baseSeq,
        sessionId: input.sessionId,
        savedAt: input.savedAt,
        schemaVersion,
        blobValid,
        bytes: decoded.ok ? decoded.bytes : Buffer.byteLength(input.blob),
        summary: summary ?? undefined,
        summaryPlausible: plausible,
      },
      head,
      last,
      {
        activeGeneration: gen.generation,
        now: exec.now,
        knownSchemaVersions: game.knownSchemaVersions,
        maxProgressPerHour: game.maxProgressPerHour,
      },
    );
    // blob_too_large is a refusal reason of its own
    const reason =
      placement.reason === 'malformed' && !decoded.ok && decoded.reason === 'blob_too_large'
        ? 'blob_too_large'
        : placement.reason;
    // refused blobs are kept for the first N per hour only
    let keepBlob = decoded.ok;
    if (keepBlob && placement.disposition === 'stored_refused')
      keepBlob =
        (await repo.refusedBlobsThisHour(t, playerKey, exec.now)) <
        game.retention.refusedBlobsPerHour;
    const sha = decoded.ok ? decoded.sha256 : '0'.repeat(64);
    await repo.insertSnapshot(t, {
      playerKey,
      generation: gen.generation,
      seq: placement.seq,
      clientSeq: input.clientSeq,
      baseSeq: input.baseSeq,
      sessionId: input.sessionId,
      commandId: (input as { commandId: string }).commandId,
      progress: input.progress,
      savedAt: input.savedAt,
      bytes: decoded.ok ? decoded.bytes : 0,
      encBytes: Buffer.byteLength(input.blob, 'utf8'),
      blobSha256: sha,
      schemaVersion,
      buildVersion: input.buildVersion,
      source,
      disposition: placement.disposition,
      rejectReason: reason ?? null,
      flags: placement.flags,
      summary,
      enc: input.enc,
      reason: input.reason,
      blobJson: keepBlob && decoded.ok ? decoded.json : null,
    });
    const currentProgress =
      placement.disposition === 'anchored'
        ? Math.max(input.progress, head?.progress ?? 0)
        : (head?.progress ?? 0);
    await ctx.outbox.emit(t, {
      kind: 'save.written',
      playerKey,
      payload: {
        seq: placement.seq,
        disposition: placement.disposition,
        progress: input.progress,
        generation: gen.generation,
        flags: placement.flags,
        summary,
        source,
      },
      commandId: (input as { commandId: string }).commandId,
    });
    const out: WriteResult = {
      disposition: placement.disposition,
      seq: placement.seq,
      currentProgress,
      generation: gen.generation,
      blobSha256: sha,
    };
    void source;
    if (reason) out.reason = reason;
    if (placement.flags.length) out.flags = placement.flags;
    if (placement.divergent) out.divergent = placement.divergent;
    return out;
  };

  bus.register(SavesWrite, writeHandler);

  bus.register(SavesReview, async (input, exec, tx) => {
    const rows = await tx!<
      { outcome: string }[]
    >`SELECT promote_snapshot(${input.playerKey}, ${input.seq}, ${input.action}, ${actorLabel(exec)}, ${SAVE_RULE_VERSION}, ${input.reason}) AS outcome`;
    const outcome = rows[0]!.outcome as ReviewResult['outcome'];
    const gen = await repo.activeGeneration(tx!, input.playerKey);
    const anchor = gen ? await repo.anchorRow(tx!, input.playerKey, gen.generation) : null;
    if (outcome === 'promoted' || outcome === 'rejected') {
      await ctx.outbox.emit(tx!, {
        kind: 'save.reviewed',
        playerKey: input.playerKey,
        payload: { seq: input.seq, action: input.action, outcome },
        commandId: input.commandId,
      });
    }
    const out: ReviewResult = { outcome, duplicate: false };
    if (anchor) out.anchorSeq = Number(anchor.seq);
    return out;
  });

  route<typeof SaveWriteBody, typeof import('@foundation/contracts').SaveWriteResult>(
    app,
    ctx,
    'saves.write',
    async ({ body, exec }) => {
      const { commandId, ...payload } = body;
      return bus.execute(SavesWrite, { commandId, payload: { commandId, ...payload } }, exec!);
    },
  );

  route<
    typeof import('@foundation/contracts').SaveBeaconBody,
    typeof import('@foundation/contracts').SaveWriteResult
  >(app, ctx, 'saves.beacon', async ({ body, exec }) => {
    // auth/transport fields are stripped before hashing so a retry via PUT and via beacon share one commandId
    const { playerKey: _pk, token: _t, requestId: _r, ...payload } = body;
    return bus.execute(
      SavesWrite,
      { commandId: payload.commandId, payload },
      { ...exec!, transport: 'beacon' },
    );
  });

  route<typeof AdminSaveReviewBody, typeof import('@foundation/contracts').AdminSaveReviewResult>(
    app,
    ctx,
    'admin.reviewSave',
    async ({ body, exec }) =>
      bus.execute(SavesReview, { commandId: body.commandId, payload: body }, exec!),
  );

  route<
    undefined,
    typeof import('@foundation/contracts').SaveCurrentResponse,
    undefined,
    typeof import('@foundation/contracts').CurrentQuery
  >(app, ctx, 'saves.current', async ({ exec, query }) => {
    const playerKey = exec!.playerKey!;
    const sql = ctx.db.sql;
    const gen = await repo.activeGeneration(sql, playerKey);
    if (!gen)
      return { empty: true, generation: 0 } satisfies Omit<
        SaveCurrentResponse,
        'serverNow' | 'requestId'
      >;
    const lineage = {
      generation: gen.generation,
      kind: gen.kind,
      openedAt: gen.opened_at.getTime(),
      ...(gen.seed_seq !== null ? { seedSeq: Number(gen.seed_seq) } : {}),
    };
    if (gen.kind === 'erased')
      return { empty: true, generation: gen.generation, lineage, erased: true };
    const anchor = await repo.anchorRow(sql, playerKey, gen.generation);
    const pending = await repo.pendingQuarantineRow(
      sql,
      playerKey,
      gen.generation,
      anchor ? Number(anchor.progress) : null,
    );
    const out: Omit<SaveCurrentResponse, 'serverNow' | 'requestId'> = {
      empty: !anchor,
      generation: gen.generation,
      lineage,
    };
    if (pending)
      out.pendingQuarantine = {
        seq: Number(pending.seq),
        progress: Number(pending.progress),
        flags: pending.flags,
        receivedAt: pending.received_at.getTime(),
      };
    if (anchor) {
      out.snapshot = repo.toMeta(anchor);
      if (query.meta !== '1') {
        const blob = await repo.blobById(sql, Number(anchor.id));
        if (blob !== null) {
          out.blob = blob;
          out.enc = 'json';
        }
      }
    }
    return out;
  });

  route<
    undefined,
    typeof import('@foundation/contracts').SaveHistoryResponse,
    undefined,
    typeof import('@foundation/contracts').SaveHistoryQuery
  >(app, ctx, 'saves.history', async ({ exec, query }) => {
    const playerKey = exec!.playerKey!;
    const gen = await repo.activeGeneration(ctx.db.sql, playerKey);
    const generation = query.generation ?? gen?.generation ?? 0;
    const rows = await repo.history(
      ctx.db.sql,
      playerKey,
      generation,
      query.limit ?? 50,
      query.beforeSeq ?? null,
    );
    const items: SnapshotMeta[] = rows.map(repo.toMeta);
    return { generation, items } satisfies Omit<SaveHistoryResponse, 'serverNow' | 'requestId'>;
  });

  route<
    undefined,
    typeof import('@foundation/contracts').SaveBlobResponse,
    typeof import('@foundation/contracts').SeqParams
  >(app, ctx, 'saves.blob', async ({ exec, params }) => {
    const playerKey = exec!.playerKey!;
    const row = await repo.snapshotBySeq(ctx.db.sql, playerKey, Number(params.seq));
    if (!row) throw new AppError('not_found', 'no such seq');
    const blob = await repo.blobById(ctx.db.sql, Number(row.id));
    if (blob === null) throw new AppError('not_found', 'blob pruned');
    return {
      seq: Number(row.seq),
      generation: row.generation,
      enc: 'json',
      blob,
      blobSha256: row.blob_sha256,
    } satisfies Omit<SaveBlobResponse, 'serverNow' | 'requestId'>;
  });

  // retention job: prune blobs per player plan (players with recent writes), refused blobs, retention sweep
  ctx.jobs.push({
    name: 'saves.prune',
    intervalMs: 15 * 60_000,
    async run() {
      const players = await ctx.db.sql<
        { player_key: string }[]
      >`SELECT DISTINCT player_key FROM save_snapshots WHERE received_at > now() - interval '1 day'`;
      let pruned = 0;
      for (const p of players) {
        const r = await ctx.db.sql<
          { n: number }[]
        >`SELECT prune_save_blobs(${p.player_key}, ${game.retention.keepRecent}, ${game.retention.keepDailyDays}, ${game.retention.keepGenerations}) AS n`;
        pruned += r[0]?.n ?? 0;
      }
      const refused = await ctx.db.sql<
        { n: number }[]
      >`SELECT prune_refused_blobs(${game.retention.refusedBlobsPerHour}) AS n`;
      return { players: players.length, pruned, refusedPruned: refused[0]?.n ?? 0 };
    },
  });
}
