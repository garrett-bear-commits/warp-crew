// Composition root helper: assemble AppContext, register features explicitly, assert completeness,
// wire jobs (§4.1 "handlers registered explicitly in the composition root; boot asserts every
// declared command has exactly one handler"). apps/server/src/main.ts calls createServer().
import pino, { type Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import {
  createJestIdentityVerifier,
  createJestPaymentsVerifier,
  createMockIdentityVerifier,
  createMockPaymentsVerifier,
} from '@foundation/jest-verify';
import type { ServerConfig } from './config.ts';
import type { GameConfig, GamePolicy } from './game/config.ts';
import { createDb, pgSslOption, type Db } from './db/index.ts';
import { checkSchema } from './db/migrate.ts';
import { CommandBus } from './cqrs/bus.ts';
import { QueryBus } from './cqrs/query.ts';
import { Outbox } from './outbox/index.ts';
import { systemClock, type ServerClock } from './clock/index.ts';
import { createMemoryLimiter, createPgLimiter } from './limits/index.ts';
import { createCfAccessVerifier } from './auth/cf-access.ts';
import { createJobRunner, type JobDef, type JobRunner } from './jobs/index.ts';
import type { AppContext } from './http/context.ts';
import { buildFastify } from './http/app.ts';
import { registerIdentity } from './features/identity/server.ts';
import { registerSaves } from './features/saves/server.ts';
import { registerLineage } from './features/lineage/server.ts';
import { registerPurchases } from './features/purchases/server.ts';
import { registerGrants } from './features/grants/server.ts';
import { registerAchievements, registerDaily } from './features/achievements/server.ts';
import { registerLeaderboards } from './features/leaderboards/server.ts';
import { registerInbox } from './features/inbox/server.ts';
import { registerLiveops, createLiveopsCache } from './features/liveops/server.ts';
import { registerTelemetry } from './features/telemetry/server.ts';
import { registerNames } from './features/names/server.ts';
import { registerJournal } from './features/journal/server.ts';
import { registerAdmin } from './features/admin/server.ts';
import { registerQa } from './features/qa/server.ts';
import { redactionPaths } from './logging.ts';
import { verifyLiveIntegrity } from './dr/index.ts';
import { initSentry, type SentryHandle } from './observability/sentry.ts';
import { createHttpStats } from './observability/httpStats.ts';
import { createOpsAlerter, opsSnapshot } from './health/index.ts';
import { runEconomyAnomaly } from './jobs/economy-anomaly.ts';

export interface CreateServerOptions {
  config: ServerConfig;
  game: GameConfig;
  policy: GamePolicy;
  clock?: ServerClock;
  log?: Logger;
  db?: Db;
  /** Skip the boot schema check (tests that migrate themselves still keep it on by default). */
  skipSchemaCheck?: boolean;
  /** Injected Sentry handle (tests); default: initSentry from config.sentryDsn (no-op without a DSN). */
  sentry?: SentryHandle;
  /** Live-ops cache refresh period (default LIVEOPS_REFRESH_MS; tests shorten it). */
  liveopsRefreshMs?: number;
  /** Reads Cloudflare Access's signing keys (config.cfAccess); default global fetch (tests fake it). */
  cfAccessFetch?: typeof fetch;
}

export interface Server {
  app: FastifyInstance;
  ctx: AppContext;
  jobs: JobRunner;
  /** Boot: schema check, liveops cache, jobs, listen. */
  start(): Promise<{ port: number }>;
  /** Ready the app without listening (tests use app.inject). */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/** Per-replica live-ops cache refresh (admin publishes refresh the handling replica at once). */
export const LIVEOPS_REFRESH_MS = 30_000;

/** Somewhere pino can write serialized lines (a log shipper, a test sink). */
export interface LogSink {
  write(line: string): void;
}

/**
 * pino JSON on stdout with the shared redaction list. With `ship` (PostHog log shipping), every
 * line also goes to the shipper; stdout output is unchanged. `stdout` replaces fd 1 (tests).
 */
export function createLogger(
  level = 'info',
  o: { ship?: LogSink | null; stdout?: LogSink } = {},
): Logger {
  const opts = { level, redact: { paths: redactionPaths(), censor: '[redacted]' } };
  if (!o.ship && !o.stdout) return pino(opts);
  const stdout = o.stdout ?? pino.destination({ dest: process.stdout.fd || 1 });
  const lvl = level as pino.Level;
  const streams: pino.StreamEntry[] = [{ level: lvl, stream: stdout }];
  if (o.ship) streams.push({ level: lvl, stream: o.ship });
  return pino(opts, pino.multistream(streams));
}

export async function createServer(o: CreateServerOptions): Promise<Server> {
  const log = o.log ?? createLogger(o.config.logLevel);
  const clock = o.clock ?? systemClock;
  const db =
    o.db ??
    createDb(o.config.databaseUrl, {
      max: o.config.pgPool,
      ssl: pgSslOption(o.config.pgSsl),
      applicationName: `foundation-${o.config.gameId}-${o.config.env}`,
    });
  const identity =
    o.config.identityProvider === 'jest'
      ? createJestIdentityVerifier({
          secretsB64: o.config.jestSecrets,
          maxTokenAgeMs: o.game.maxTokenAgeSec * 1000,
        })
      : createMockIdentityVerifier({ maxTokenAgeMs: o.game.maxTokenAgeSec * 1000 });
  const payments =
    o.config.paymentsProvider === 'jest'
      ? createJestPaymentsVerifier({ secretsB64: o.config.jestSecrets })
      : createMockPaymentsVerifier();
  const cfAccess = o.config.cfAccess
    ? createCfAccessVerifier(o.config.cfAccess, {
        ...(o.cfAccessFetch ? { fetch: o.cfAccessFetch } : {}),
        onKeysError: (err) =>
          log.warn({ err }, 'Cloudflare Access signing keys unreadable; keeping the last ones'),
      })
    : null;
  const limiter =
    o.config.rateLimitStore === 'pg' ? createPgLimiter(db.sql, clock) : createMemoryLimiter(clock);
  const sentry =
    o.sentry ??
    initSentry({
      dsn: o.config.sentryDsn,
      release: o.config.buildVersion,
      gameId: o.config.gameId,
      env: o.config.env,
    });
  const outbox = new Outbox(db, clock, {}, log, sentry);
  const jobs: JobDef[] = [];
  const busGuards: AppContext['busGuards'] = [];
  const bus = new CommandBus({
    db,
    clock,
    limiter,
    guards: busGuards,
    log,
    trace: (info, fn) => sentry.span(info, fn),
    onExecuted: (e) => {
      if (!e.ok && e.errorCode !== 'validation_failed' && e.errorCode !== 'unauthorized')
        log.warn(
          { type: e.type, code: e.errorCode, ms: e.durationMs, requestId: e.ctx.requestId },
          'command failed',
        );
    },
  });
  const queries = new QueryBus();
  const liveops = createLiveopsCache({ db, game: o.game, log });
  const ctx: AppContext = {
    config: o.config,
    game: o.game,
    policy: o.policy,
    db,
    bus,
    queries,
    outbox,
    clock,
    limiter,
    identity,
    payments,
    cfAccess,
    log,
    httpStats: createHttpStats(),
    jobs,
    bootedAt: clock.now(),
    declaredCommands: [],
    declaredQueries: [],
    liveops,
    busGuards,
    sentry,
  };

  const app = buildFastify(ctx);
  // Explicit registration order: identity first (guards), then domain features.
  registerIdentity(app, ctx);
  registerSaves(app, ctx);
  registerLineage(app, ctx);
  registerNames(app, ctx);
  if (o.game.features.purchases) registerPurchases(app, ctx);
  if (o.game.features.grants) registerGrants(app, ctx);
  if (o.game.features.achievements) registerAchievements(app, ctx);
  if (o.game.features.achievements || o.game.features.daily) registerDaily(app, ctx);
  if (o.game.features.leaderboards) registerLeaderboards(app, ctx);
  if (o.game.features.inbox) registerInbox(app, ctx);
  if (o.game.features.liveops) registerLiveops(app, ctx);
  if (o.game.features.telemetry) registerTelemetry(app, ctx);
  if (o.game.features.journal) registerJournal(app, ctx);
  registerAdmin(app, ctx);
  if (o.game.features.qa) registerQa(app, ctx);
  bus.assertComplete(ctx.declaredCommands);
  queries.assertComplete(ctx.declaredQueries);

  // core jobs
  jobs.push({ name: 'outbox.drain', intervalMs: 2000, run: () => outbox.drain() });
  jobs.push({
    name: 'retention.sweep',
    intervalMs: 60 * 60_000,
    run: async () =>
      (await db.sql<{ apply_retention: unknown }[]>`SELECT apply_retention()`)[0]?.apply_retention,
  });
  jobs.push({
    name: 'ratelimit.sweep',
    intervalMs: 10 * 60_000,
    run: async () => ({ swept: await limiter.sweep() }),
  });
  jobs.push({
    name: 'economy.anomaly',
    intervalMs: 24 * 3_600_000,
    run: () => runEconomyAnomaly(db, clock, o.policy, sentry),
  });
  jobs.push({
    name: 'live.integrity',
    intervalMs: 7 * 24 * 3_600_000,
    // Weekly self-check of the LIVE database (audit F4): re-hash the newest anchored blobs and mark
    // live_integrity_verified_at. restore_verified_at is written only by an isolated-restore
    // verification (dr/index.ts verifyIsolatedRestore → markRestoreVerified; runbook restore-drill).
    run: () => verifyLiveIntegrity(db.sql, clock.now()),
  });
  // The SLO's page tier, delivered from inside: /health/ops has no public route for an external
  // monitor. Its Crons check-in doubles as the API heartbeat (a dead runner misses it).
  const alertOps = createOpsAlerter(ctx);
  jobs.push({
    name: 'ops.alert',
    intervalMs: 5 * 60_000,
    monitor: true,
    run: async () => alertOps(await opsSnapshot(ctx)),
  });
  const runner = createJobRunner(db, clock, jobs, { log, sentry });

  // The live-ops cache is per process, so every replica refreshes its own on a plain timer (an
  // advisory-locked job would refresh only the replica that wins the lock). Not gated by
  // jobsEnabled: a replica that runs no jobs still serves min-build, maintenance and kill switches.
  let liveopsTimer: NodeJS.Timeout | undefined;
  let liveopsFailing = false;
  const refreshLiveops = async () => {
    try {
      await liveops.refresh();
      liveopsFailing = false;
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, 'liveops refresh failed');
      if (!liveopsFailing)
        sentry.captureException(e, {}, { level: 'warning', fingerprint: ['liveops-refresh'] });
      liveopsFailing = true;
    }
  };

  let started = false;
  const boot = async () => {
    if (!o.skipSchemaCheck) {
      const st = await checkSchema(db.sql);
      if (!st.ok)
        throw new Error(
          `schema check failed: state=${st.state} pending=[${st.pending.join(',')}] mismatched=[${st.mismatched.join(',')}] ahead=[${st.ahead.join(',')}] head=${st.head} expected=${st.expectedHead} — run migrate --up`,
        );
    }
    // the scariest query runs at boot (§1): the anchor query over the whole table must plan/execute
    await db.sql`SELECT count(*) FROM (SELECT DISTINCT ON (player_key) player_key FROM save_snapshots WHERE disposition = 'anchored' ORDER BY player_key, progress DESC LIMIT 1) x`;
    await liveops.refresh();
    await app.ready();
  };

  return {
    app,
    ctx,
    jobs: runner,
    async ready() {
      if (!started) {
        await boot();
        started = true;
      }
    },
    async start() {
      await boot();
      started = true;
      if (o.config.jobsEnabled) runner.start();
      liveopsTimer = setInterval(
        () => void refreshLiveops(),
        o.liveopsRefreshMs ?? LIVEOPS_REFRESH_MS,
      );
      liveopsTimer.unref();
      await app.listen({ port: o.config.port, host: o.config.host });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : o.config.port;
      log.info(
        {
          port,
          gameId: o.config.gameId,
          env: o.config.env,
          build: o.config.buildVersion,
          // Whether errors reach Sentry at all: a missing DSN is otherwise silent.
          sentry: sentry.enabled,
          // Whether admin requests need a Cloudflare Access token.
          cfAccess: cfAccess !== null,
        },
        'listening',
      );
      return { port };
    },
    async stop() {
      runner.stop();
      clearInterval(liveopsTimer);
      await app.close();
      await sentry.close(2000);
      if (!o.db) await db.end();
    },
  };
}
