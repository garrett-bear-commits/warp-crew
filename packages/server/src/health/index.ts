// Health (§4.2, §8): /health liveness; /health/ready (SELECT 1, migrations at head, secrets
// present with byte length, admin keys count); /health/ops snapshot from a 15-minute rollup with
// two-tier ?assert=page|warn (503 on any page-tier issue). The API has no public ops route, so the
// in-process `ops.alert` job forwards the same issues to Sentry (createOpsAlerter).
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
  /** Floor for the overdue window: a 2 s job is not paged for missing 6 s (deploys, slow drains). */
  jobOverdueMinMs: number;
  /** Uptime before this process pages for a job (capped by the job's own window): a job with
   *  no job_runs row, or a deploy gap, does not page a replica that just booted. */
  jobNeverRunGraceMs: number;
  pendingReviewsWarn: number;
  restoreVerifyMaxAgeDays: number;
  /** Share of this instance's responses that are 401s: a few are expired tokens refreshing. */
  unauthorizedWarn: number;
  /** Share of this instance's responses that are 429s. */
  rateLimitedWarn: number;
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
  jobOverdueMinMs: 2 * 60_000,
  jobNeverRunGraceMs: 15 * 60_000,
  pendingReviewsWarn: 50,
  restoreVerifyMaxAgeDays: 10,
  unauthorizedWarn: 0.25,
  rateLimitedWarn: 0.05,
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
  // Failures that never become a command row: raw 500s, and 401s and 429s refused before one.
  const http = s.http;
  if (http && http.total >= 20) {
    const serverErrorRate = http.serverErrors / http.total;
    if (serverErrorRate >= t.errorRateWarn)
      issues.push({
        tier: serverErrorRate >= t.errorRatePage ? 'page' : 'warn',
        code: 'http_5xx_rate',
        message: 'share of API responses that are 5xx (this instance)',
        value: serverErrorRate,
        threshold: serverErrorRate >= t.errorRatePage ? t.errorRatePage : t.errorRateWarn,
      });
    const unauthorizedRate = http.unauthorized / http.total;
    if (unauthorizedRate >= t.unauthorizedWarn)
      issues.push({
        tier: 'warn',
        code: 'http_401_rate',
        message: 'share of API responses that are 401 (this instance)',
        value: unauthorizedRate,
        threshold: t.unauthorizedWarn,
      });
    const rateLimitedRate = http.rateLimited / http.total;
    if (rateLimitedRate >= t.rateLimitedWarn)
      issues.push({
        tier: 'warn',
        code: 'http_429_rate',
        message: 'share of API responses that are 429 (this instance)',
        value: rateLimitedRate,
        threshold: t.rateLimitedWarn,
      });
  }
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
  // A verified receipt without a price cannot be told paid from sandbox: it grants nothing and
  // needs a look (provider change, mapping gap).
  if (s.purchases.unclassified > 0)
    issues.push({
      tier: 'warn',
      code: 'purchases_unclassified',
      message: 'unclassified purchases in the window',
      value: s.purchases.unclassified,
      threshold: 1,
    });
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
    } catch (err) {
      db = false;
      // Why readiness failed (connection refused, timeout, schema query), not just that it did.
      ctx.log.warn({ err }, 'readiness check failed');
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
      ...(ctx.config.buildCommit ? { commit: ctx.config.buildCommit } : {}),
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
  const t = DEFAULT_OPS_THRESHOLDS;
  const jobs = ctx.jobs.map((j) => {
    const last = jobsRows.find((r) => r.name === j.name);
    const lastRunAt = last?.started_at.getTime();
    // Scheduled jobs catch up on boot, so a job with no heartbeat once this process has been up
    // for its window (at most the grace period) is stuck: crashing before its heartbeat commits,
    // or jobs disabled everywhere. A freshly booted replica does not page for a deploy gap.
    const window = Math.max(j.intervalMs * t.jobOverdueFactor, t.jobOverdueMinMs);
    const settled = now - ctx.bootedAt > Math.min(window, t.jobNeverRunGraceMs);
    const overdue = settled && (lastRunAt === undefined || now - lastRunAt > window);
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
  const li = await sql<
    { value: { at?: number } }[]
  >`SELECT value FROM ops_markers WHERE key = 'live_integrity_verified_at'`;
  const liveIntegrityVerifiedAt = li[0]?.value?.at;
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
    http: ctx.httpStats.snapshot(now),
    ...(typeof restoreVerifiedAt === 'number' ? { restoreVerifiedAt } : {}),
    ...(typeof liveIntegrityVerifiedAt === 'number' ? { liveIntegrityVerifiedAt } : {}),
  };
  const issues = assessOps(base);
  const status = issues.some((i) => i.tier === 'page') ? 'page' : issues.length ? 'warn' : 'ok';
  return { ...base, issues, status };
}

type OpsIssue = OpsSnapshotResponse['issues'][number];

/** Warn-tier codes repeat to Sentry at most this often (they are reviewed daily, not paged). */
export const OPS_WARN_REPEAT_MS = 6 * 3_600_000;

/**
 * Forward ops issues to Sentry, one message per tier and code with a stable fingerprint
 * (`ops/<tier>/<code>`) so alert rules can page on the page tier. Page-tier codes are sent on
 * every check while they last; warn-tier codes at most every OPS_WARN_REPEAT_MS. A healthy
 * snapshot sends nothing.
 */
export function createOpsAlerter(
  ctx: Pick<AppContext, 'sentry' | 'log' | 'clock'>,
  o: { warnRepeatMs?: number } = {},
): (snapshot: OpsSnapshotResponse) => { status: string; page: string[]; warn: string[] } {
  const warnRepeatMs = o.warnRepeatMs ?? OPS_WARN_REPEAT_MS;
  const lastWarn = new Map<string, number>();
  return (snapshot) => {
    const now = ctx.clock.now();
    const groups = new Map<string, { tier: OpsIssue['tier']; code: string; issues: OpsIssue[] }>();
    for (const i of snapshot.issues) {
      const key = `${i.tier}:${i.code}`;
      const g = groups.get(key) ?? { tier: i.tier, code: i.code, issues: [] };
      g.issues.push(i);
      groups.set(key, g);
    }
    const warnNow = new Set(
      [...groups.values()].filter((g) => g.tier === 'warn').map((g) => g.code),
    );
    for (const code of [...lastWarn.keys()]) if (!warnNow.has(code)) lastWarn.delete(code);
    const sent = { page: [] as string[], warn: [] as string[] };
    for (const g of groups.values()) {
      if (g.tier === 'warn') {
        const last = lastWarn.get(g.code);
        if (last !== undefined && now - last < warnRepeatMs) continue;
        lastWarn.set(g.code, now);
      } else {
        ctx.log.error({ code: g.code, issues: g.issues }, 'ops page');
      }
      ctx.sentry.captureMessage(`ops ${g.tier}: ${g.code}`, {
        level: g.tier === 'page' ? 'error' : 'warning',
        fingerprint: ['ops', g.tier, g.code],
        tags: { ops_tier: g.tier, ops_code: g.code },
        context: { issues: g.issues },
      });
      sent[g.tier].push(g.code);
    }
    return { status: snapshot.status, ...sent };
  };
}

export { AppError };
