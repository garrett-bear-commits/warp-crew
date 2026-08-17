// Typed command bus (§4.1, ADR-004, ADR-026). Registry keyed by the definition object; handlers
// registered explicitly in the composition root; boot asserts every declared command has exactly
// one handler. Middleware onion: validate → authorize per actorPolicy → rate limit → guards →
// trace → open tx + take the declared lock → reserve the commands row → handler → finalise → commit.
import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import type { Db, Tx } from '../db/index.ts';
import { mapPgError, takeLock } from '../db/index.ts';
import { AppError } from '../errors.ts';
import type { ServerClock } from '../clock/index.ts';
import { requestHash } from './hash.ts';
import { authorizeActor } from './authorize.ts';
import type { AnyCommandDef, CommandDef, CommandHandler, CommandInput, ExecCtx } from './define.ts';
import type { RateLimiter } from '../limits/index.ts';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));

export const STEP_UP_MAX_AGE_MS = 5 * 60_000;

/** Pre-handler guard (kill switches, player_flags). Throw AppError to refuse. */
export type CommandGuard = (
  def: AnyCommandDef,
  ctx: ExecCtx,
  payload: unknown,
) => Promise<void> | void;

export interface BusDeps {
  db: Db;
  clock: ServerClock;
  limiter?: RateLimiter;
  guards?: CommandGuard[];
  log?: { warn(o: object, msg: string): void; info(o: object, msg: string): void };
  /** Called after each execution (metrics/logging). */
  onExecuted?: (e: {
    type: string;
    ok: boolean;
    replayed: boolean;
    durationMs: number;
    ctx: ExecCtx;
    errorCode?: string;
  }) => void;
}

interface CommandRow {
  id: string;
  status: 'reserved' | 'done' | 'failed';
  request_hash: string;
  result: unknown;
  type: string;
}

/** Marker thrown inside the tx to roll it back and replay a stored/tombstoned result. */
class ReplaySignal<R> {
  readonly result: R;
  constructor(result: R) {
    this.result = result;
  }
}

export class CommandBus {
  #handlers = new Map<AnyCommandDef, CommandHandler<TSchema, unknown>>();
  #deps: BusDeps;

  constructor(deps: BusDeps) {
    this.#deps = deps;
  }

  register<S extends TSchema, R>(def: CommandDef<S, R>, handler: CommandHandler<S, R>): void {
    if (this.#handlers.has(def as AnyCommandDef))
      throw new Error(`command ${def.type} registered twice`);
    for (const d of this.#handlers.keys())
      if (d.type === def.type) throw new Error(`command type ${def.type} declared twice`);
    this.#handlers.set(
      def as AnyCommandDef,
      handler as unknown as CommandHandler<TSchema, unknown>,
    );
  }

  /** Boot assertion: every declared command has exactly one handler. */
  assertComplete(declared: readonly AnyCommandDef[]): void {
    const missing = declared.filter((d) => !this.#handlers.has(d)).map((d) => d.type);
    if (missing.length) throw new Error(`commands without handlers: ${missing.join(', ')}`);
  }

  has(def: AnyCommandDef): boolean {
    return this.#handlers.has(def);
  }

  registeredTypes(): string[] {
    return [...this.#handlers.keys()].map((d) => d.type);
  }

  async execute<S extends TSchema, R>(
    def: CommandDef<S, R>,
    input: CommandInput<Static<S>>,
    ctx: ExecCtx,
  ): Promise<R> {
    const started = process.hrtime.bigint();
    const handler = this.#handlers.get(def as AnyCommandDef) as CommandHandler<S, R> | undefined;
    if (!handler) throw new Error(`no handler for command ${def.type}`);
    let replayed = false;
    let ok = false;
    let errorCode: string | undefined;
    try {
      // 1. validate
      if (!Value.Check(def.schema, input.payload)) {
        const errs = [...Value.Errors(def.schema, input.payload)]
          .slice(0, 5)
          .map((e) => ({ path: e.path, message: e.message }));
        throw new AppError('validation_failed', `invalid payload for ${def.type}`, errs);
      }
      if (def.idempotency.owner !== 'none' && !UUID_RE.test(input.commandId)) {
        throw new AppError('validation_failed', 'commandId must be a UUID');
      }
      // 2. authorize
      authorizeActor(def.actorPolicy, ctx.actor);
      if (def.scope === 'player' && !ctx.playerKey)
        throw new AppError('unauthorized', 'player-scoped command without a player');
      if (
        def.stepUp &&
        ctx.actor.kind === 'player' &&
        ctx.now - ctx.actor.tokenIatMs > STEP_UP_MAX_AGE_MS
      ) {
        throw new AppError('unauthorized', 'step-up required: token too old for a value command', {
          stepUp: true,
        });
      }
      // 3. rate limit
      if (def.limit && this.#deps.limiter) {
        const who = ctx.playerKey ?? ctx.adminKeyId ?? ctx.ip ?? 'anon';
        const verdict = await this.#deps.limiter.hit(`${def.limit}:${who}`, def.limit);
        if (!verdict.allowed)
          throw new AppError('rate_limited', 'rate limited', {
            retryAfterMs: verdict.retryAfterMs,
          });
      }
      // 4. guards (kill switches, player flags)
      for (const g of this.#deps.guards ?? []) await g(def as AnyCommandDef, ctx, input.payload);

      // 5. execute
      const scopeKey = def.scope === 'player' ? ctx.playerKey! : 'game';
      const hash = requestHash(def.type, input.payload);
      let result: R;
      if (def.tx === 'none') {
        result = await handler(input.payload, ctx, null);
      } else {
        try {
          result = await this.#deps.db.tx(async (tx) => {
            await takeLock(
              tx,
              def.lock === 'player'
                ? { kind: 'player', key: scopeKey }
                : def.lock === 'game'
                  ? { kind: 'game' }
                  : { kind: 'none' },
            );
            let rowId: string | null = null;
            if (def.idempotency.owner !== 'none') {
              const found = await this.#reserve(
                tx,
                def as AnyCommandDef,
                scopeKey,
                input.commandId,
                hash,
                ctx,
              );
              if (found.kind === 'replay') throw new ReplaySignal(found.result);
              rowId = found.id;
            }
            const r = await handler(input.payload, ctx, tx);
            if (rowId) {
              const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
              await tx`UPDATE commands SET status = 'done', result = ${tx.json(r as never)}, duration_ms = ${ms}, trace_id = ${ctx.requestId} WHERE id = ${rowId}`;
            }
            if (ctx.actor.kind === 'admin')
              await this.#audit(tx, def as AnyCommandDef, input, ctx, 'ok');
            return r;
          });
        } catch (e) {
          if (e instanceof ReplaySignal) {
            replayed = true;
            result = e.result as R;
          } else {
            const mapped = mapPgError(e);
            if (mapped instanceof AppError && def.idempotency.owner !== 'none')
              await this.#recordFailure(
                def as AnyCommandDef,
                scopeKey,
                input.commandId,
                hash,
                ctx,
                mapped,
              );
            throw mapped;
          }
        }
      }
      ok = true;
      return result;
    } catch (e) {
      errorCode = e instanceof AppError ? e.code : 'internal';
      throw e;
    } finally {
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      this.#deps.onExecuted?.({
        type: def.type,
        ok,
        replayed,
        durationMs,
        ctx,
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }

  async #reserve(
    tx: Tx,
    def: AnyCommandDef,
    scopeKey: string,
    commandId: string,
    hash: string,
    ctx: ExecCtx,
  ): Promise<{ kind: 'reserved'; id: string } | { kind: 'replay'; result: unknown }> {
    // Tombstone first: the full row may have been pruned while the produced fact still exists.
    const tomb = await tx<
      { request_hash: string; outcome_ref: string | null; type: string }[]
    >`SELECT request_hash, outcome_ref, type FROM command_tombstones WHERE scope_key = ${scopeKey} AND command_id = ${commandId}`;
    if (tomb[0]) {
      if (tomb[0].request_hash !== hash || tomb[0].type !== def.type)
        throw new AppError(
          'idempotency_mismatch',
          'commandId reused with a different command or payload',
        );
      const hook = def.replay?.fromTombstone;
      if (!hook)
        throw new AppError(
          'bad_request',
          'commandId already used; the original result has expired',
          { commandId },
        );
      return { kind: 'replay', result: hook(tomb[0].outcome_ref) };
    }
    const actor = actorLabel(ctx);
    // Reservation. A concurrent duplicate waits on the unique index until we commit/rollback
    // (bounded by lock_timeout). A previously failed row is re-reserved so the retry re-executes.
    const ins = await tx<{ id: string }[]>`
      INSERT INTO commands (scope_key, command_id, type, actor, request_hash, status, retention, trace_id)
      VALUES (${scopeKey}, ${commandId}, ${def.type}, ${actor}, ${hash}, 'reserved', ${def.idempotency.retention}, ${ctx.requestId})
      ON CONFLICT (scope_key, command_id) DO UPDATE SET status = 'reserved', trace_id = EXCLUDED.trace_id
        WHERE commands.status = 'failed' AND commands.request_hash = EXCLUDED.request_hash
      RETURNING id`;
    if (ins[0]) return { kind: 'reserved', id: ins[0].id };
    const rows = await tx<
      CommandRow[]
    >`SELECT id, status, request_hash, result, type FROM commands WHERE scope_key = ${scopeKey} AND command_id = ${commandId}`;
    const row = rows[0];
    if (!row) throw new AppError('retry_later', 'idempotency row vanished during reservation');
    if (row.request_hash !== hash || row.type !== def.type)
      throw new AppError(
        'idempotency_mismatch',
        'commandId reused with a different command or payload',
        { commandId },
      );
    if (row.status === 'done') {
      const stored = row.result;
      const hook = def.replay?.fromStored;
      return { kind: 'replay', result: hook ? hook(stored) : stored };
    }
    // 'reserved' cannot be observed after the unique-index wait (reservation and finalisation share
    // one transaction); if it is, the writer is still running past lock_timeout — tell the client to retry.
    throw new AppError('retry_later', 'command in flight');
  }

  async #recordFailure(
    def: AnyCommandDef,
    scopeKey: string,
    commandId: string,
    hash: string,
    ctx: ExecCtx,
    err: AppError,
  ): Promise<void> {
    // Best-effort ops truth for refused/failed commands (the reservation rolled back with the tx).
    // Never for retry_later (transient) — the client will retry the same commandId.
    if (err.code === 'retry_later') return;
    try {
      await this.#deps.db.sql`
        INSERT INTO commands (scope_key, command_id, type, actor, request_hash, status, error_code, retention, trace_id)
        VALUES (${scopeKey}, ${commandId}, ${def.type}, ${actorLabel(ctx)}, ${hash}, 'failed', ${err.code}, ${def.idempotency.retention}, ${ctx.requestId})
        ON CONFLICT (scope_key, command_id) DO NOTHING`;
    } catch (e) {
      this.#deps.log?.warn({ err: String(e) }, 'failed to record command failure');
    }
  }

  async #audit(
    tx: Tx,
    def: AnyCommandDef,
    input: CommandInput<unknown>,
    ctx: ExecCtx,
    outcome: string,
  ): Promise<void> {
    if (ctx.actor.kind !== 'admin') return;
    const p = (input.payload ?? {}) as Record<string, unknown>;
    const target =
      typeof p.playerKey === 'string'
        ? p.playerKey
        : typeof p.key === 'string'
          ? p.key
          : typeof p.id === 'string'
            ? p.id
            : typeof p.kind === 'string'
              ? p.kind
              : null;
    const reason = typeof p.reason === 'string' ? p.reason : null;
    const scope = typeof def.actorPolicy === 'object' ? def.actorPolicy.admin : 'read';
    await tx`INSERT INTO admin_actions (admin_key_id, scope, command_type, command_id, target, reason, outcome, request_id)
      VALUES (${ctx.actor.keyId}, ${scope}, ${def.type}, ${input.commandId}, ${target}, ${reason}, ${outcome}, ${ctx.requestId})
      ON CONFLICT (command_id, command_type) DO NOTHING`;
  }
}

export function actorLabel(ctx: ExecCtx): string {
  const a = ctx.actor;
  switch (a.kind) {
    case 'player':
      return 'player';
    case 'admin':
      return `admin:${a.keyId}`;
    case 'ops':
      return 'ops';
    case 'job':
      return `job:${a.name}`;
    case 'system':
      return `system:${a.name}`;
  }
}
