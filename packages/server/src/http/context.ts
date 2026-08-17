import type { IdentityVerifier, PaymentsVerifier } from '@foundation/jest-verify';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { CommandBus } from '../cqrs/bus.ts';
import type { QueryBus } from '../cqrs/query.ts';
import type { Outbox } from '../outbox/index.ts';
import type { ServerClock } from '../clock/index.ts';
import type { RateLimiter } from '../limits/index.ts';
import type { GameConfig, GamePolicy } from '../game/config.ts';
import type { JobDef } from '../jobs/index.ts';
import type { AnyCommandDef, ExecCtx } from '../cqrs/define.ts';
import type { QueryDef } from '../cqrs/query.ts';

/** Everything a feature's register(app, ctx) receives. Built once in the composition root. */
export interface AppContext {
  config: ServerConfig;
  game: GameConfig;
  policy: GamePolicy;
  db: Db;
  bus: CommandBus;
  queries: QueryBus;
  outbox: Outbox;
  clock: ServerClock;
  limiter: RateLimiter;
  identity: IdentityVerifier;
  payments: PaymentsVerifier;
  log: Logger;
  /** Features push jobs here; the composition root starts them. */
  jobs: JobDef[];
  /** Features push declared commands/queries here; boot asserts completeness. */
  declaredCommands: AnyCommandDef[];
  declaredQueries: QueryDef<unknown, unknown>[];
  /** Live-ops settings cache (min build, maintenance, kill switches) refreshed by the liveops feature. */
  liveops: LiveopsCache;
  /** Set by the identity feature: touch the players projection (throttled). */
  onPlayerSeen?: (exec: ExecCtx) => Promise<void>;
}

export interface LiveopsCache {
  minBuildVersion(): string;
  maintenance(): boolean;
  killSwitch(target: 'sku' | 'command', id: string): boolean;
  refresh(): Promise<void>;
}
