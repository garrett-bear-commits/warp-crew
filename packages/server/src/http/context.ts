import type {
  IdentityVerifier,
  PaymentsVerifier,
  SubscriptionsVerifier,
} from '@foundation/jest-verify';
import type { Logger } from 'pino';
import type { ServerConfig } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { CommandBus, CommandGuard } from '../cqrs/bus.ts';
import type { SentryHandle } from '../observability/sentry.ts';
import type { HttpStats } from '../observability/httpStats.ts';
import type { QueryBus } from '../cqrs/query.ts';
import type { Outbox } from '../outbox/index.ts';
import type { ServerClock } from '../clock/index.ts';
import type { RateLimiter } from '../limits/index.ts';
import type { GameConfig, GamePolicy } from '../game/config.ts';
import type { JobDef } from '../jobs/index.ts';
import type { AnyCommandDef, ExecCtx } from '../cqrs/define.ts';
import type { QueryDef } from '../cqrs/query.ts';
import type { CfAccessVerifier } from '../auth/cf-access.ts';

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
  /** Signed subscription lists (same provider and secrets as payments, ADR-035). */
  subscriptions: SubscriptionsVerifier;
  /** Cloudflare Access token check for admin routes (config.cfAccess); null: none. */
  cfAccess: CfAccessVerifier | null;
  log: Logger;
  /** This instance's response outcomes over the ops window (health/index.ts opsSnapshot). */
  httpStats: HttpStats;
  /** Features push jobs here; the composition root starts them. */
  jobs: JobDef[];
  /** Server clock when this process composed the app: the grace period for jobs never run. */
  bootedAt: number;
  /** Features push declared commands/queries here; boot asserts completeness. */
  declaredCommands: AnyCommandDef[];
  declaredQueries: QueryDef<unknown, unknown>[];
  /** Live-ops settings cache (min build, maintenance, kill switches) refreshed by the liveops feature. */
  liveops: LiveopsCache;
  /** Sentry handle (no-op without SENTRY_DSN). */
  sentry: SentryHandle;
  /** Guards installed on the bus by features (kill switches, player flags). */
  busGuards: CommandGuard[];
  /** Set by the identity feature: touch the players projection (throttled). */
  onPlayerSeen?: (exec: ExecCtx) => Promise<void>;
}

export interface LiveopsCache {
  minBuildVersion(): string;
  maintenance(): boolean;
  killSwitch(target: 'sku' | 'command', id: string): boolean;
  /** server_behind recovery via lineage.reattach is operator-enabled (§5.2). */
  reattachEnabled(): boolean;
  refresh(): Promise<void>;
}
