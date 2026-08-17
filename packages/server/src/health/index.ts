// Health (§4.2, §8): /health liveness; /health/ready (SELECT 1, migrations at head, secrets
// present with byte length, admin keys count); /health/ops snapshot from a 15-minute rollup with
// two-tier ?assert=page|warn (503 on any page-tier issue).
import type { FastifyInstance } from 'fastify';
import { CONTRACT_VERSION } from '@foundation/contracts/enums';
import type { OpsSnapshotResponse, ReadyResponse } from '@foundation/contracts';
import { OpsQuery } from '@foundation/contracts';
import { checkSchema } from '../db/migrate.ts';
import type { AppContext } from './../http/context.ts';
import { authenticateOps } from '../auth/index.ts';
import { AppError } from '../errors.ts';

export interface OpsThresholds {
  p95PageMs: number;
  p95WarnMs: number;
  errorRatePage: number;
  errorRateWarn: number;
  outboxLagPageSec: number;
  outboxLagWarnSec: number;
  deadLettersPage: number;
  jobOverdueFactor: number;
  pendingReviewsWarn: number;
  restoreVerifyMaxAgeDays: number;
}

export const DEFAULT_OPS_THRESHOLDS: OpsThresholds = {
  p95PageMs: 1500,
  p95WarnMs: 300,
  errorRatePage: 0.2,
  errorRateWarn: 0.05,
  outboxLagPageSec: 600,
  outboxLagWarnSec: 60,
  deadLettersPage: 1,
  jobOverdueFactor: 3,
  pendingReviewsWarn: 50,
  restoreVerifyMaxAgeDays: 10,
};

/** Pure: derive issues from a snapshot (tested without a database). */
export function assessOps(
  s: Omit<OpsSnapshotResponse, 'issues' | 'status'>,
  t: OpsThresholds = DEFAULT_OPS_THRESHOLDS,
): OpsSnapshotResponse['issues'] {
  const issues: OpsSnapshotResponse['issues'] = [];
  const total = s.commands.total;
  const errRate = total > 0 ? s.commands.errors / total : 0;
  if (total >= 20 && errRate >= t.errorRatePage)
    issues.push({
      tier: 'page',
      code: 'command_error_rate',
      message: 'command error rate',
      value: errRate,
      threshold: t.errorRatePage,
    });
  else if (total >= 20 && errRate >= t.errorRateWarn)
    issues.push({
      tier: 'warn',
      code: 'command_error_rate',
      message: 'command error rate',
      value: errRate,
      threshold: t.errorRateWarn,
    });
  if (total >= 20 && s.commands.p95Ms >= t.p95PageMs)
    issues.push({
      tier: 'page',
      code: 'command_p95',
      message: 'command p95 latency',
      value: s.commands.p95Ms,
      threshold: t.p95PageMs,
    });
  else if (total >= 20 && s.commands.p95Ms >= t.p95WarnMs)
    issues.push({
      tier: 'warn',
      code: 'command_p95',
      message: 'command p95 latency',
      value: s.commands.p95Ms,
      threshold: t.p95WarnMs,
    });
  if (s.outbox.deadLetters >= t.deadLettersPage)
    issues.push({
      tier: 'page',
      code: 'outbox_dead_letters',
      message: 'outbox dead letters awaiting replay',
      value: s.outbox.deadLetters,
      threshold: t.deadLettersPage,
    });
  if (s.outbox.lagSeconds >= t.outboxLagPageSec)
    issues.push({
      tier: 'page',
      code: 'outbox_lag',
      message: 'outbox lag',
      value: s.outbox.lagSeconds,
      threshold: t.outboxLagPageSec,
    });
  else if (s.outbox.lagSeconds >= t.outboxLagWarnSec)
    issues.push({
      tier: 'warn',
      code: 'outbox_lag',
      message: 'outbox lag',
      value: s.outbox.lagSeconds,
      threshold: t.outboxLagWarnSec,
    });
  for (const j of s.jobs) {
    if (j.overdue)
      issues.push({ tier: 'page', code: 'job_overdue', message: `job ${j.name} overdue` });
    else if (j.lastOk === false)
      issues.push({ tier: 'warn', code: 'job_failed', message: `job ${j.name} last run failed` });
  }
  if (s.saves.pendingReviews >= t.pendingReviewsWarn)
    issues.push({
      tier: 'warn',
      code: 'pending_reviews',
      message: 'quarantined saves awaiting review',
      value: s.saves.pendingReviews,
      threshold: t.pendingReviewsWarn,
    });
  if (
    s.restoreVerifiedAt !== undefined &&
    s.serverNow - s.restoreVerifiedAt > t.restoreVerifyMaxAgeDays * 86_400_000
  )
    issues.push({
      tier: 'warn',
      code: 'restore_verify_stale',
      message: 'restore verification is stale',
    });
  return issues;
}

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/health', async () => ({
    status: 'ok' as const,
    serverNow: ctx.clock.now(),
    contractVersion: CONTRACT_VERSION,
  }));

  app.get('/health/ready', async (_req, reply) => {
    let db = false;
    let migrationsAtHead = false;
    let schemaHead: string | undefined;
    try {
      await ctx.db.sql`SELECT 1`;
      db = true;
      const st = await checkSchema(ctx.db.sql);
      migrationsAtHead = st.ok;
      schemaHead = st.head ?? undefined;
    } catch {
      db = false;
    }
    const secretByteLengths =
      ctx.config.identityProvider === 'jest'
        ? ctx.config.jestSecrets.map((s) => Buffer.from(s, 'base64').length)
        : [];
    const secretsPresent =
      ctx.config.identityProvider === 'mock'
        ? true
        : secretByteLengths.length > 0 && secretByteLengths.every((n) => n >= 16);
    const body: ReadyResponse = {
      status:
        db && migrationsAtHead && secretsPresent && ctx.config.adminKeys.length > 0
          ? 'ready'
          : 'not_ready',
      serverNow: ctx.clock.now(),
      contractVersion: CONTRACT_VERSION,
      checks: {
        db,
        migrationsAtHead,
        ...(schemaHead ? { schemaHead } : {}),
        secretsPresent,
        secretByteLengths,
        adminKeyCount: ctx.config.adminKeys.length,
      },
      gameId: ctx.config.gameId,
      env: ctx.config.env,
      buildVersion: ctx.config.buildVersion,
    };
    return reply.status(body.status === 'ready' ? 200 : 503).send(body);
  });

  app.get('/health/ops', { schema: { querystring: OpsQuery } }, async (req, reply) => {
    authenticateOps(ctx.config.opsSecret, { get: (n) => req.headers[n] as string | undefined });
    const snapshot = await opsSnapshot(ctx);
    const q = req.query as { assert?: string };
    if (q.assert) {
      const tier = q.assert === 'warn' ? 'warn' : 'page';
      const bad = snapshot.issues.some(
        (i) => i.tier === 'page' || (tier === 'warn' && i.tier === 'warn'),
      );
      if (bad) return reply.status(503).send(snapshot);
    }
    return snapshot;
  });
}

export async function opsSnapshot(ctx: AppContext): Promise<OpsSnapshotResponse> {
  const sql = ctx.db.sql;
  const now = ctx.clock.now();
  const since = new Date(now - 15 * 60_000);
  const cmd = await sql<{ total: number; errors: number; refusals: number; p95: number | null }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'failed')::int AS errors,
           count(*) FILTER (WHERE status = 'done' AND (result->>'disposition' = 'stored_refused' OR result->>'outcome' LIKE 'rejected%'))::int AS refusals,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
    FROM commands WHERE received_at >= ${since}`;
  const byType = await sql<{ type: string; count: number; p95: number | null; errors: number }[]>`
    SELECT type, count(*)::int AS count, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, count(*) FILTER (WHERE status = 'failed')::int AS errors
    FROM commands WHERE received_at >= ${since} GROUP BY type ORDER BY count DESC LIMIT 50`;
  const ob = await ctx.outbox.stats(sql);
  const jobsRows = await sql<{ name: string; started_at: Date; ok: boolean | null }[]>`
    SELECT DISTINCT ON (name) name, started_at, ok FROM job_runs ORDER BY name, started_at DESC`;
  const jobs = ctx.jobs.map((j) => {
    const last = jobsRows.find((r) => r.name === j.name);
    const lastRunAt = last?.started_at.getTime();
    const overdue =
      lastRunAt !== undefined
        ? now - lastRunAt > j.intervalMs * DEFAULT_OPS_THRESHOLDS.jobOverdueFactor
        : false;
    return {
      name: j.name,
      ...(lastRunAt !== undefined ? { lastRunAt } : {}),
      ...(last && last.ok !== null ? { lastOk: last.ok } : {}),
      overdue,
    };
  });
  const saves = await sql<
    { anchored: number; quarantined: number; refused: number; pending: number }[]
  >`
    SELECT count(*) FILTER (WHERE disposition = 'anchored')::int AS anchored,
           count(*) FILTER (WHERE disposition = 'stored_quarantined')::int AS quarantined,
           count(*) FILTER (WHERE disposition = 'stored_refused')::int AS refused,
           (SELECT count(*)::int FROM save_snapshots q WHERE q.disposition = 'stored_quarantined' AND NOT EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = q.id)) AS pending
    FROM save_snapshots WHERE received_at >= ${since}`;
  const purchases = await sql<{ paid: number; sandbox: number; unclassified: number }[]>`
    SELECT count(*) FILTER (WHERE classification = 'paid')::int AS paid, count(*) FILTER (WHERE classification = 'sandbox')::int AS sandbox, count(*) FILTER (WHERE classification = 'unclassified')::int AS unclassified
    FROM purchase_transactions WHERE recorded_at >= ${since}`;
  const rv = await sql<
    { value: { at?: number } }[]
  >`SELECT value FROM ops_markers WHERE key = 'restore_verified_at'`;
  const restoreVerifiedAt = rv[0]?.value?.at;
  const base: Omit<OpsSnapshotResponse, 'issues' | 'status'> = {
    serverNow: now,
    windowMinutes: 15,
    commands: {
      total: cmd[0]?.total ?? 0,
      errors: cmd[0]?.errors ?? 0,
      refusals: cmd[0]?.refusals ?? 0,
      p95Ms: Number(cmd[0]?.p95 ?? 0),
      byType: byType.map((b) => ({
        type: b.type,
        count: b.count,
        p95Ms: Number(b.p95 ?? 0),
        errors: b.errors,
      })),
    },
    outbox: { pending: ob.pending, lagSeconds: ob.lagSeconds, deadLetters: ob.deadLetters },
    jobs,
    saves: {
      anchored: saves[0]?.anchored ?? 0,
      quarantined: saves[0]?.quarantined ?? 0,
      refused: saves[0]?.refused ?? 0,
      pendingReviews: saves[0]?.pending ?? 0,
    },
    purchases: {
      paid: purchases[0]?.paid ?? 0,
      sandbox: purchases[0]?.sandbox ?? 0,
      unclassified: purchases[0]?.unclassified ?? 0,
    },
    ...(typeof restoreVerifiedAt === 'number' ? { restoreVerifiedAt } : {}),
  };
  const issues = assessOps(base);
  const status = issues.some((i) => i.tier === 'page') ? 'page' : issues.length ? 'warn' : 'ok';
  return { ...base, issues, status };
}

export { AppError };
