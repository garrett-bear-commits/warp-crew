import type { TSchema, Static } from '@sinclair/typebox';
import type { AdminScope, GameEnv } from '@foundation/contracts/enums';
import type { Tx } from '../db/index.ts';

export type ActorPolicy = 'player' | { admin: AdminScope } | 'ops' | 'job' | 'system';
export type CommandScope = 'player' | 'game' | 'global';
export type LockKind = 'player' | 'game' | 'none';
export type IdempotencyOwner = 'client' | 'system' | 'none';
export type Retention = '7d' | '90d' | '1y';

export type Actor =
  | { kind: 'player'; playerKey: string; registered: boolean; tokenIatMs: number }
  | { kind: 'admin'; keyId: string; scopes: readonly AdminScope[] }
  | { kind: 'ops' }
  | { kind: 'job'; name: string }
  | { kind: 'system'; name: string };

/** Server-derived execution context — a client can never supply any of these. */
export interface ExecCtx {
  gameId: string;
  env: GameEnv;
  actor: Actor;
  playerKey?: string;
  adminKeyId?: string;
  requestId: string;
  now: number;
  buildVersion?: string;
  ip?: string;
}

export interface ReplayHooks<R> {
  /** Transform a stored result on replay (e.g. saves → disposition 'duplicate'). Default: identity. */
  fromStored?: (stored: R) => R;
  /** Build a result from a tombstone outcome_ref when the full row was pruned. Default: throws. */
  fromTombstone?: (outcomeRef: string | null) => R;
}

export interface CommandDefInput<S extends TSchema, R> {
  type: string;
  /** Client input schema (payload only; commandId is transport and stripped before hashing). */
  schema: S;
  actorPolicy: ActorPolicy;
  scope: CommandScope;
  lock: LockKind;
  idempotency: { owner: IdempotencyOwner; retention: Retention };
  tx: 'required' | 'none';
  /** Rate-limit bucket key; the limiter is per player (or per admin key / ip) per bucket. */
  limit?: string;
  /** Token iat must be ≤ stepUpMaxAgeMs (value commands). */
  stepUp?: boolean;
  replay?: ReplayHooks<R>;
  /** Extract a tombstone outcome_ref from a result (kept as long as the produced fact exists). */
  outcomeRef?: (result: R) => string | null;
}

export interface CommandDef<S extends TSchema = TSchema, R = unknown> extends CommandDefInput<
  S,
  R
> {
  readonly __brand: 'CommandDef';
  readonly __payload?: Static<S>;
  readonly __result?: R;
}

export function defineCommand<S extends TSchema, R>(def: CommandDefInput<S, R>): CommandDef<S, R> {
  if (def.scope === 'player' && def.lock !== 'player') {
    throw new Error(`command ${def.type}: player-scoped commands must take the player lock`);
  }
  if (def.tx === 'none' && def.idempotency.owner !== 'none') {
    throw new Error(`command ${def.type}: idempotency requires tx: 'required'`);
  }
  if (def.idempotency.owner !== 'none' && def.tx !== 'required') {
    throw new Error(`command ${def.type}: idempotent commands run in a transaction`);
  }
  return Object.freeze({ ...def, __brand: 'CommandDef' as const }) as CommandDef<S, R>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommandDef = CommandDef<TSchema, any>;

export type PayloadOf<D> = D extends CommandDef<infer S, unknown> ? Static<S> : never;
export type ResultOf<D> = D extends CommandDef<TSchema, infer R> ? R : never;

export type CommandHandler<S extends TSchema, R> = (
  input: Static<S>,
  ctx: ExecCtx,
  tx: Tx | null,
) => Promise<R>;

export interface CommandInput<P> {
  commandId: string;
  payload: P;
}
