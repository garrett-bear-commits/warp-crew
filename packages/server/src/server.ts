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
import { createDb, type Db } from './db/index.ts';
import { checkSchema } from './db/migrate.ts';
import { CommandBus } from './cqrs/bus.ts';
import { QueryBus } from './cqrs/query.ts';
import { Outbox } from './outbox/index.ts';
import { systemClock, type ServerClock } from './clock/index.ts';
import { createMemoryLimiter, createPgLimiter } from './limits/index.ts';
import { createJobRunner, type JobDef, type JobRunner } from './jobs/index.ts';
import type { AppContext } from './http/context.ts';
import { buildFastify } from './http/app.ts';
import { registerIdentity } from './features/identity/server.ts';
import { registerSaves } from './features/saves/server.ts';
import { registerLineage } from './features/lineage/server.ts';
import { registerPurchases } from './features/purchases/server.ts';
import { registerGrants } from './features/grants/server.ts';
import { registerAchievements } from './features/achievements/server.ts';
import { registerLeaderboards } from './features/leaderboards/server.ts';
import { registerInbox } from './features/inbox/server.ts';
import { registerLiveops, createLiveopsCache } from './features/liveops/server.ts';
import { registerTelemetry } from './features/telemetry/server.ts';
import { registerJournal } from './features/journal/server.ts';
import { registerAdmin } from './features/admin/server.ts';
import { registerQa } from './features/qa/server.ts';
import { redactionPaths } from './logging.ts';

export interface CreateServerOptions {
  config: ServerConfig;
  game: GameConfig;
  policy: GamePolicy;
  clock?: ServerClock;
  log?: Logger;
  db?: Db;
  /** Skip the boot schema check (tests that migrate themselves still keep it on by default). */
  skipSchemaCheck?: boolean;
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

export function createLogger(level = 'info'): Logger {
  return pino({ level, redact: { paths: redactionPaths(), censor: '[redacted]' } });
}

export async function createServer(o: CreateServerOptions): Promise<Server> {
  const log = o.log ?? createLogger(o.config.logLevel);
  const clock = o.clock ?? systemClock;
  const db =
    o.db ??
    createDb(o.config.databaseUrl, {
      max: o.config.pgPool,
      ssl: o.config.pgSsl === 'off' ? false : o.config.pgSsl === 'verify' ? 'require' : 'prefer',
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
  const limiter =
    o.config.rateLimitStore === 'pg' ? createPgLimiter(db.sql, clock) : createMemoryLimiter(clock);
  const outbox = new Outbox(db, clock, {}, log);
  const jobs: JobDef[] = [];
  const busGuards: AppContext['busGuards'] = [];
  const bus = new CommandBus({
    db,
    clock,
    limiter,
    guards: busGuards,
    log,
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
    log,
    jobs,
    declaredCommands: [],
    declaredQueries: [],
    liveops,
    busGuards,
  };

  const app = buildFastify(ctx);
  // Explicit registration order: identity first (guards), then domain features.
  registerIdentity(app, ctx);
  registerSaves(app, ctx);
  registerLineage(app, ctx);
  if (o.game.features.purchases) registerPurchases(app, ctx);
  if (o.game.features.grants) registerGrants(app, ctx);
  if (o.game.features.achievements) registerAchievements(app, ctx);
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
    async run() {
      // nightly z-score over declared summary scalars: flag players whose latest anchored summary is > 4σ from the population mean
      const stats = await db.sql<{ key: string; mean: number; stddev: number; n: number }[]>`
        WITH latest AS (
          SELECT DISTINCT ON (player_key) player_key, summary FROM save_snapshots WHERE disposition = 'anchored' AND summary IS NOT NULL ORDER BY player_key, seq DESC)
        SELECT k.key, avg((l.summary->>k.key)::numeric)::float AS mean, coalesce(stddev_pop((l.summary->>k.key)::numeric), 0)::float AS stddev, count(*)::int AS n
        FROM latest l, LATERAL jsonb_object_keys(l.summary) k(key) WHERE jsonb_typeof(l.summary->k.key) = 'number' GROUP BY k.key`;
      let flagged = 0;
      for (const s of stats) {
        if (s.n < 20 || s.stddev === 0) continue;
        const outliers = await db.sql<{ player_key: string; v: number }[]>`
          SELECT DISTINCT ON (player_key) player_key, (summary->>${s.key})::float AS v FROM save_snapshots WHERE disposition = 'anchored' AND summary ? ${s.key} ORDER BY player_key, seq DESC`;
        for (const p of outliers) {
          if (Math.abs((p.v - s.mean) / s.stddev) > 4) {
            await db.sql`INSERT INTO integrity_events (player_key, kind, at, detail, message) VALUES (${p.player_key}, 'progress_jump_client', ${new Date(clock.now())}, ${db.sql.json({ key: s.key, value: p.v, mean: s.mean, stddev: s.stddev })}, 'economy anomaly (z > 4)')`;
            flagged++;
          }
        }
      }
      return { keys: stats.length, flagged };
    },
  });
  jobs.push({
    name: 'restore.verify',
    intervalMs: 7 * 24 * 3_600_000,
    async run() {
      // Weekly restore verification: prove the newest anchored blob for a sample of players decodes and matches its sha (a real PITR drill is a runbook step; this marks restore_verified_at).
      const rows = await db.sql<
        { id: string; blob_sha256: string }[]
      >`SELECT s.id, s.blob_sha256 FROM save_snapshots s JOIN save_blobs b ON b.save_id = s.id WHERE s.disposition = 'anchored' ORDER BY s.received_at DESC LIMIT 50`;
      const { sha256Hex } = await import('./db/canonical.ts');
      let ok = 0;
      for (const r of rows) {
        const b = await db.sql<
          { blob: Buffer }[]
        >`SELECT blob FROM save_blobs WHERE save_id = ${r.id}`;
        if (b[0] && sha256Hex(b[0].blob.toString('utf8')) === r.blob_sha256) ok++;
      }
      const verified = ok === rows.length;
      if (verified)
        await db.sql`INSERT INTO ops_markers (key, value) VALUES ('restore_verified_at', ${db.sql.json({ at: clock.now(), sampled: rows.length })}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return { sampled: rows.length, ok, verified };
    },
  });
  const runner = createJobRunner(db, clock, jobs, log);

  let started = false;
  const boot = async () => {
    if (!o.skipSchemaCheck) {
      const st = await checkSchema(db.sql);
      if (!st.ok)
        throw new Error(
          `schema check failed: pending=[${st.pending.join(',')}] mismatched=[${st.mismatched.join(',')}] head=${st.head} expected=${st.expectedHead} — run migrate --up`,
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
      await app.listen({ port: o.config.port, host: o.config.host });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : o.config.port;
      log.info(
        { port, gameId: o.config.gameId, env: o.config.env, build: o.config.buildVersion },
        'listening',
      );
      return { port };
    },
    async stop() {
      runner.stop();
      await app.close();
      if (!o.db) await db.end();
    },
  };
}
