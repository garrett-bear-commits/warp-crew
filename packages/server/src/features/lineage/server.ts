// lineage feature (§4.3, ADR-006): generations (restart / admin_restore / player_restore / reattach /
// erased), CAS by expectedGeneration, business key restartId, entitlement only for kind='restart'.
import type { FastifyInstance } from 'fastify';
import {
  LineageRestartBody,
  LineageRestoreToSeqBody,
  LineageReattachBody,
  AdminRestoreBody,
  AdminEraseBody,
  QaImportBody,
  type GenerationReceipt,
  type AdminEraseResult,
  type QaImportResult as QaImportResultT,
} from '@foundation/contracts';
import { defineCommand, type ExecCtx } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import type { Tx } from '../../db/index.ts';
import * as repo from '../../db/snapshots.ts';
import { decodeBlob } from '../../codec/blob.ts';
import { actorLabel } from '../../cqrs/bus.ts';
import { sha256Hex } from '../../db/canonical.ts';
import { entitlementFor } from '../../game/facts.ts';

type Receipt = Omit<GenerationReceipt, 'serverNow' | 'requestId'>;
type EraseResult = Omit<AdminEraseResult, 'serverNow' | 'requestId'>;
type ImportResult = Omit<QaImportResultT, 'serverNow' | 'requestId'>;

const dup = { fromStored: (r: Receipt) => ({ ...r, duplicate: true }) };
const tomb = { fromTombstone: (ref: string | null) => JSON.parse(ref ?? '{}') as Receipt };

export const LineageRestart = defineCommand<typeof LineageRestartBody, Receipt>({
  type: 'lineage.restart',
  schema: LineageRestartBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'lineage',
  stepUp: true,
  replay: { ...dup, ...tomb },
  outcomeRef: (r) => JSON.stringify({ ...r, duplicate: true }),
});
export const LineageRestoreToSeq = defineCommand<typeof LineageRestoreToSeqBody, Receipt>({
  type: 'lineage.restoreToSeq',
  schema: LineageRestoreToSeqBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'lineage',
  stepUp: true,
  replay: { ...dup, ...tomb },
  outcomeRef: (r) => JSON.stringify({ ...r, duplicate: true }),
});
export const LineageReattach = defineCommand<typeof LineageReattachBody, Receipt>({
  type: 'lineage.reattach',
  schema: LineageReattachBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  limit: 'lineage',
  stepUp: true,
  replay: { ...dup, ...tomb },
  outcomeRef: (r) => JSON.stringify({ ...r, duplicate: true }),
});
export const AdminRestore = defineCommand<typeof AdminRestoreBody, Receipt>({
  type: 'lineage.adminRestore',
  schema: AdminRestoreBody,
  actorPolicy: { admin: 'restore' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: dup,
});
export const AdminErase = defineCommand<typeof AdminEraseBody, EraseResult>({
  type: 'lineage.erase',
  schema: AdminEraseBody,
  actorPolicy: { admin: 'erase' },
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '1y' },
  tx: 'required',
  limit: 'admin',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});
export const QaImport = defineCommand<typeof QaImportBody, ImportResult>({
  type: 'lineage.qaImport',
  schema: QaImportBody,
  actorPolicy: 'ops',
  scope: 'game',
  lock: 'none',
  idempotency: { owner: 'client', retention: '90d' },
  tx: 'required',
  replay: { fromStored: (r) => ({ ...r, duplicate: true }) },
});

export function registerLineage(app: FastifyInstance, ctx: AppContext): void {
  const { bus } = ctx;
  ctx.declaredCommands.push(
    LineageRestart,
    LineageRestoreToSeq,
    LineageReattach,
    AdminRestore,
    AdminErase,
  );
  if (ctx.config.env === 'lab') ctx.declaredCommands.push(QaImport);

  /** Seed a new generation from an existing snapshot row: copy the blob as an anchored 'restore' row. */
  async function seedFrom(
    tx: Tx,
    playerKey: string,
    seedSeq: number,
    kind: 'player_restore' | 'admin_restore',
    exec: ExecCtx,
    commandId: string,
    reason: string | null,
  ): Promise<Receipt> {
    const src = await repo.snapshotBySeq(tx, playerKey, seedSeq);
    if (!src) throw new AppError('not_found', 'no such seq');
    const blob = await repo.blobById(tx, Number(src.id));
    if (blob === null) throw new AppError('not_found', 'blob pruned; cannot restore to this point');
    const gen = await repo.openGeneration(tx, {
      playerKey,
      kind,
      seedSeq,
      reason,
      actor: actorLabel(exec),
    });
    const last = await repo.lastRow(tx, playerKey);
    const decoded = await decodeBlob('json', blob, ctx.game.blobLimits);
    if (!decoded.ok)
      throw new AppError('internal', `stored blob failed to decode: ${decoded.reason}`, {
        reason: decoded.reason,
        detail: decoded.detail,
      });
    await repo.insertSnapshot(tx, {
      playerKey,
      generation: gen.generation,
      seq: (last?.seq ?? 0) + 1,
      clientSeq: 0,
      baseSeq: 0,
      sessionId: src.session_id,
      commandId,
      progress: Number(src.progress),
      savedAt: exec.now,
      bytes: decoded.bytes,
      encBytes: decoded.bytes,
      blobSha256: decoded.sha256,
      schemaVersion: src.schema_version,
      buildVersion: src.build_version,
      source: kind === 'admin_restore' ? 'admin' : 'restore',
      disposition: 'anchored',
      rejectReason: null,
      flags: [],
      summary: src.summary,
      enc: 'json',
      reason: 'restore',
      blobJson: decoded.json,
    });
    await ctx.outbox.emit(tx, {
      kind: 'generation.opened',
      playerKey,
      payload: { generation: gen.generation, kind, seedSeq },
      commandId,
    });
    return { generation: gen.generation, kind, seedSeq, duplicate: false };
  }

  bus.register(LineageRestart, async (input, exec, tx) => {
    const playerKey = exec.playerKey!;
    const t = tx!;
    const cur = await repo.ensureLineage(t, playerKey, actorLabel(exec));
    const existing = await repo.generationByRestartId(t, playerKey, input.restartId);
    if (existing)
      return {
        generation: existing.generation,
        kind: 'restart' as const,
        entitlement: existing.entitlement,
        duplicate: true,
      };
    if (cur.generation !== input.expectedGeneration)
      throw new AppError(
        'stale_generation',
        `expected generation ${input.expectedGeneration}, active is ${cur.generation}`,
        { generation: cur.generation },
      );
    const entitlement = await entitlementFor(t, playerKey);
    const gen = await repo.openGeneration(t, {
      playerKey,
      kind: 'restart',
      restartId: input.restartId,
      entitlement,
      actor: actorLabel(exec),
    });
    await ctx.outbox.emit(t, {
      kind: 'generation.opened',
      playerKey,
      payload: { generation: gen.generation, kind: 'restart', entitlement },
      commandId: input.commandId,
    });
    return { generation: gen.generation, kind: 'restart' as const, entitlement, duplicate: false };
  });

  bus.register(LineageRestoreToSeq, async (input, exec, tx) => {
    const playerKey = exec.playerKey!;
    const cur = await repo.ensureLineage(tx!, playerKey, actorLabel(exec));
    if (cur.generation !== input.expectedGeneration)
      throw new AppError(
        'stale_generation',
        `expected generation ${input.expectedGeneration}, active is ${cur.generation}`,
        { generation: cur.generation },
      );
    return seedFrom(
      tx!,
      playerKey,
      input.seq,
      'player_restore',
      exec,
      input.commandId,
      'player restore-to-point',
    );
  });

  bus.register(LineageReattach, async (input, exec, tx) => {
    const playerKey = exec.playerKey!;
    const t = tx!;
    if (!ctx.liveops.reattachEnabled())
      throw new AppError('forbidden', 'lineage.reattach is not enabled by the operator', {
        reattach: false,
      });
    const cur = await repo.ensureLineage(t, playerKey, actorLabel(exec));
    if (cur.generation !== input.expectedServerGeneration)
      throw new AppError(
        'stale_generation',
        `expected server generation ${input.expectedServerGeneration}, active is ${cur.generation}`,
        { generation: cur.generation },
      );
    if (input.clientGeneration <= cur.generation)
      throw new AppError(
        'bad_request',
        'reattach requires a client generation ahead of the server',
      );
    const decoded = await decodeBlob(input.snapshot.enc, input.snapshot.blob, ctx.game.blobLimits);
    if (!decoded.ok)
      throw new AppError('validation_failed', `snapshot ${decoded.reason}`, {
        detail: decoded.detail,
      });
    const pol = ctx.policy.validateBlob(decoded.value);
    if (!pol.ok)
      throw new AppError(
        'validation_failed',
        `snapshot rejected by policy: ${pol.reason ?? 'invalid'}`,
      );
    // open generations up to the client's number so both sides agree afterwards
    let gen = cur;
    while (gen.generation < input.clientGeneration)
      gen = await repo.openGeneration(t, {
        playerKey,
        kind: 'reattach',
        actor: actorLabel(exec),
        reason: 'server_behind reattach',
      });
    const last = await repo.lastRow(t, playerKey);
    await repo.insertSnapshot(t, {
      playerKey,
      generation: gen.generation,
      seq: (last?.seq ?? 0) + 1,
      clientSeq: 0,
      baseSeq: 0,
      sessionId: '00000000-0000-4000-8000-000000000000',
      commandId: input.commandId,
      progress: input.snapshot.progress,
      savedAt: input.snapshot.savedAt,
      bytes: decoded.bytes,
      encBytes: Buffer.byteLength(input.snapshot.blob),
      blobSha256: decoded.sha256,
      schemaVersion: input.snapshot.schemaVersion,
      buildVersion: input.snapshot.buildVersion,
      source: 'reattach',
      disposition: 'anchored',
      rejectReason: null,
      flags: [],
      summary: pol.summary ?? null,
      enc: 'json',
      reason: 'restore',
      blobJson: decoded.json,
    });
    await ctx.outbox.emit(t, {
      kind: 'generation.opened',
      playerKey,
      payload: { generation: gen.generation, kind: 'reattach' },
      commandId: input.commandId,
    });
    return { generation: gen.generation, kind: 'reattach' as const, duplicate: false };
  });

  bus.register(AdminRestore, async (input, exec, tx) => {
    const t = tx!;
    await t`SELECT pg_advisory_xact_lock(1, hashtext(${input.playerKey}))`;
    const cur = await repo.ensureLineage(t, input.playerKey, actorLabel(exec));
    if (cur.generation !== input.expectedGeneration)
      throw new AppError(
        'stale_generation',
        `expected generation ${input.expectedGeneration}, active is ${cur.generation}`,
        { generation: cur.generation },
      );
    return seedFrom(
      t,
      input.playerKey,
      input.seq,
      'admin_restore',
      exec,
      input.commandId,
      input.reason,
    );
  });

  bus.register(AdminErase, async (input, exec, tx) => {
    const t = tx!;
    await t`SELECT pg_advisory_xact_lock(1, hashtext(${input.playerKey}))`;
    await repo.ensureLineage(t, input.playerKey, actorLabel(exec));
    const gen = await repo.openGeneration(t, {
      playerKey: input.playerKey,
      kind: 'erased',
      reason: input.reason,
      actor: actorLabel(exec),
    });
    const n = await t<{ n: number }[]>`SELECT erase_player(${input.playerKey}) AS n`;
    await t`INSERT INTO players (player_key, erased_at) VALUES (${input.playerKey}, ${new Date(exec.now)}) ON CONFLICT (player_key) DO UPDATE SET erased_at = EXCLUDED.erased_at, entry_payload = NULL`;
    await t`INSERT INTO erasures (player_key, generation, reason, actor, ticket_ref, erased_rows) VALUES (${input.playerKey}, ${gen.generation}, ${input.reason}, ${actorLabel(exec)}, ${input.ticketRef ?? null}, ${n[0]?.n ?? 0})`;
    await ctx.outbox.emit(t, {
      kind: 'player.erased',
      playerKey: input.playerKey,
      payload: { generation: gen.generation },
      commandId: input.commandId,
    });
    return { generation: gen.generation, erasedRows: n[0]?.n ?? 0, duplicate: false };
  });

  bus.register(QaImport, async (input, exec, tx) => {
    const t = tx!;
    // manifest must name THIS game and environment (wrong-target protection is operational, ADR-003)
    if (input.manifest.game !== ctx.config.gameId || input.manifest.env !== ctx.config.env) {
      throw new AppError(
        'forbidden',
        `manifest is for ${input.manifest.game}/${input.manifest.env}, this deployment is ${ctx.config.gameId}/${ctx.config.env}`,
        { manifest: input.manifest },
      );
    }
    await t`SELECT pg_advisory_xact_lock(1, hashtext(${input.playerKey}))`;
    await repo.ensureLineage(t, input.playerKey, actorLabel(exec));
    const decoded = await decodeBlob(input.snapshot.enc, input.snapshot.blob, ctx.game.blobLimits);
    if (!decoded.ok) throw new AppError('validation_failed', `snapshot ${decoded.reason}`);
    const sanitized = ctx.policy.sanitizeForQa(decoded.value);
    const json = JSON.stringify(sanitized);
    const gen = await repo.openGeneration(t, {
      playerKey: input.playerKey,
      kind: 'admin_restore',
      reason: 'qa_import',
      actor: actorLabel(exec),
    });
    const last = await repo.lastRow(t, input.playerKey);
    const seq = (last?.seq ?? 0) + 1;
    const pol = ctx.policy.validateBlob(sanitized);
    await repo.insertSnapshot(t, {
      playerKey: input.playerKey,
      generation: gen.generation,
      seq,
      clientSeq: 0,
      baseSeq: 0,
      sessionId: '00000000-0000-4000-8000-000000000000',
      commandId: input.commandId,
      progress: input.snapshot.progress,
      savedAt: exec.now,
      bytes: Buffer.byteLength(json),
      encBytes: Buffer.byteLength(json),
      blobSha256: sha256Hex(json),
      schemaVersion: input.snapshot.schemaVersion,
      buildVersion: input.snapshot.buildVersion,
      source: 'qa_import',
      disposition: 'anchored',
      rejectReason: null,
      flags: [],
      summary: pol.summary ?? null,
      enc: 'json',
      reason: 'restore',
      blobJson: json,
    });
    return { generation: gen.generation, seq, duplicate: false };
  });

  const cas =
    <B extends { commandId: string }>(
      def: typeof LineageRestart | typeof LineageRestoreToSeq | typeof LineageReattach,
    ) =>
    async ({ body, exec }: { body: B; exec: ExecCtx | null }) => {
      try {
        return await bus.execute(
          def as typeof LineageRestart,
          { commandId: body.commandId, payload: body as never },
          exec!,
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'stale_generation') throw e; // 409 via envelope
        throw e;
      }
    };
  route<typeof LineageRestartBody, typeof import('@foundation/contracts').GenerationReceipt>(
    app,
    ctx,
    'lineage.restart',
    cas(LineageRestart),
  );
  route<typeof LineageRestoreToSeqBody, typeof import('@foundation/contracts').GenerationReceipt>(
    app,
    ctx,
    'lineage.restoreToSeq',
    cas(LineageRestoreToSeq),
  );
  route<typeof LineageReattachBody, typeof import('@foundation/contracts').GenerationReceipt>(
    app,
    ctx,
    'lineage.reattach',
    cas(LineageReattach),
  );
  route<typeof AdminRestoreBody, typeof import('@foundation/contracts').GenerationReceipt>(
    app,
    ctx,
    'admin.restore',
    async ({ body, exec }) =>
      bus.execute(AdminRestore, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof AdminEraseBody, typeof import('@foundation/contracts').AdminEraseResult>(
    app,
    ctx,
    'admin.erase',
    async ({ body, exec }) =>
      bus.execute(AdminErase, { commandId: body.commandId, payload: body }, exec!),
  );
  route<typeof QaImportBody, typeof import('@foundation/contracts').QaImportResult>(
    app,
    ctx,
    'qa.import',
    async ({ body, exec }) =>
      bus.execute(QaImport, { commandId: body.commandId, payload: body }, exec!),
  );
}
