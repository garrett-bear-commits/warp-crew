// Jobs (§4.2): setInterval().unref() under a per-job advisory lock, heartbeats in job_runs.
// A run never rejects into a timer: failures of the job and of the runner itself (lock, heartbeat
// insert/update) are logged and reported to Sentry. Monitored jobs check in to Sentry Crons.
//
// Jobs of a minute or slower are scheduled from job_runs, not from process uptime: the API
// redeploys several times a day and a 24 h setInterval never fires. On boot and every
// DUE_CHECK_MS each one runs when its last successful start is older than its interval (or
// missing). The due check reads job_runs under the job's advisory lock, so replicas never
// double-run it, and at most `maxConcurrent` of them run at once (each holds two connections).
import type { Db } from '../db/index.ts';
import type { ServerClock } from '../clock/index.ts';
import { monitorSlug, type SentryHandle } from '../observability/sentry.ts';

export interface JobDef {
  name: string;
  intervalMs: number;
  /** Run at every boot, due or not (scheduled jobs otherwise catch up on boot only when due). */
  runOnStart?: boolean;
  /** Sentry Crons monitor (missed/failed runs alert). Default: jobs every hour or slower. */
  monitor?: boolean;
  run(): Promise<unknown>;
}

export interface JobRunResult {
  ran: boolean;
  ok: boolean;
  /** Why it did not run: another replica holds the lock, or a scheduled job is not due. */
  skipped?: 'locked' | 'not_due';
  error?: string;
  detail?: unknown;
}

export interface JobRunner {
  start(): void;
  stop(): void;
  /** Run one job now (tests / CLI). Returns ran: false if the lock was held elsewhere. */
  runNow(name: string): Promise<JobRunResult>;
  /** Run one job only if it is due — what the timers do for scheduled jobs. */
  runDue(name: string): Promise<JobRunResult>;
  names(): string[];
}

export interface JobRunnerOptions {
  log?: { info(o: object, m: string): void; error(o: object, m: string): void };
  sentry?: Pick<SentryHandle, 'captureException' | 'startCheckIn'>;
  /** Scheduled jobs running at once in this process (default 2). */
  maxConcurrent?: number;
  /** Due-check period for scheduled jobs (default DUE_CHECK_MS). */
  dueCheckMs?: number;
}

const MONITOR_MIN_INTERVAL_MS = 60 * 60_000;
/** Jobs at least this slow are scheduled from job_runs; faster ones run on every tick. */
export const SCHEDULED_MIN_INTERVAL_MS = 60_000;
export const DUE_CHECK_MS = 5 * 60_000;
/** After a failed run, a scheduled job retries after min(interval, this). */
export const RETRY_AFTER_MS = 15 * 60_000;

export const isScheduled = (job: JobDef): boolean => job.intervalMs >= SCHEDULED_MIN_INTERVAL_MS;

/**
 * Pure: a scheduled job is due when its last successful start is at least one interval old (or
 * missing), and its last attempt is past the retry delay. A small tolerance keeps a job whose
 * check tick equals its interval from slipping a whole tick on timer jitter.
 */
export function jobDue(
  job: Pick<JobDef, 'intervalMs'>,
  now: number,
  last: { okAt?: number | undefined; attemptAt?: number | undefined },
): boolean {
  const tolerance = Math.min(60_000, job.intervalMs / 10);
  const okDue = last.okAt === undefined || now - last.okAt >= job.intervalMs - tolerance;
  const retryAfter = Math.min(job.intervalMs, RETRY_AFTER_MS) - tolerance;
  const attemptDue = last.attemptAt === undefined || now - last.attemptAt >= retryAfter;
  return okDue && attemptDue;
}

export function isMonitored(job: JobDef): boolean {
  return job.monitor ?? job.intervalMs >= MONITOR_MIN_INTERVAL_MS;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createJobRunner(
  db: Db,
  clock: ServerClock,
  jobs: JobDef[],
  opts: JobRunnerOptions = {},
): JobRunner {
  const { log, sentry } = opts;
  const maxConcurrent = opts.maxConcurrent ?? 2;
  const dueCheckMs = opts.dueCheckMs ?? DUE_CHECK_MS;
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();
  // FIFO slots for scheduled jobs: a release hands its slot straight to the next waiter
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async () => {
    if (active < maxConcurrent) active++;
    else await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };

  async function runOne(job: JobDef, mode: 'force' | 'due'): Promise<JobRunResult> {
    if (running.has(job.name)) return { ran: false, ok: true };
    running.add(job.name);
    const slot = isScheduled(job);
    if (slot) await acquire();
    let closeCheckIn: ((status: 'ok' | 'error') => void) | undefined;
    try {
      // per-job advisory lock held for the duration of a dedicated transaction
      const result = await db.tx(async (tx): Promise<JobRunResult> => {
        const got = await tx<
          { ok: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(3, hashtext(${job.name})) AS ok`;
        if (!got[0]?.ok) return { ran: false, ok: true, skipped: 'locked' };
        if (mode === 'due') {
          // under the lock: a replica that just finished this job has committed its heartbeat
          const last = await tx<{ ok_at: Date | null; attempt_at: Date | null }[]>`
            SELECT max(started_at) FILTER (WHERE ok) AS ok_at, max(started_at) AS attempt_at
            FROM job_runs WHERE name = ${job.name}`;
          const due = jobDue(job, clock.now(), {
            okAt: last[0]?.ok_at?.getTime(),
            attemptAt: last[0]?.attempt_at?.getTime(),
          });
          if (!due) return { ran: false, ok: true, skipped: 'not_due' };
        }
        const startedAt = new Date(clock.now());
        const t0 = process.hrtime.bigint();
        const ins = await tx<
          { id: number }[]
        >`INSERT INTO job_runs (name, started_at) VALUES (${job.name}, ${startedAt}) RETURNING id`;
        const id = ins[0]!.id;
        if (sentry && isMonitored(job))
          closeCheckIn = sentry.startCheckIn({
            slug: monitorSlug(job.name),
            intervalMs: job.intervalMs,
          });
        try {
          const detail = await job.run();
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          await tx`UPDATE job_runs SET finished_at = ${new Date(clock.now())}, ok = true, duration_ms = ${ms}, detail = ${tx.json((detail ?? null) as never)} WHERE id = ${id}`;
          return { ran: true, ok: true, detail };
        } catch (e) {
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          const err = message(e);
          await tx`UPDATE job_runs SET finished_at = ${new Date(clock.now())}, ok = false, duration_ms = ${ms}, error = ${err} WHERE id = ${id}`;
          log?.error({ job: job.name, err }, 'job failed');
          sentry?.captureException(
            e,
            { job: job.name, durationMs: ms },
            { fingerprint: ['job-failed', job.name], tags: { job: job.name } },
          );
          return { ran: true, ok: false, error: err };
        }
      });
      // check in once the heartbeat is committed
      closeCheckIn?.(result.ok ? 'ok' : 'error');
      return result;
    } catch (e) {
      // The runner itself failed (lock query, heartbeat insert/update, commit): a database blip.
      // The heartbeat rolled back with the transaction; report and let the next tick retry.
      const err = message(e);
      log?.error({ job: job.name, err }, 'job runner failed');
      sentry?.captureException(
        e,
        { job: job.name },
        { fingerprint: ['job-runner', job.name], tags: { job: job.name } },
      );
      closeCheckIn?.('error');
      return { ran: false, ok: false, error: err };
    } finally {
      if (slot) release();
      running.delete(job.name);
    }
  }

  const find = (name: string) => {
    const job = jobs.find((j) => j.name === name);
    if (!job) throw new Error(`unknown job ${name}`);
    return job;
  };

  return {
    start() {
      for (const job of jobs) {
        const every = (fn: () => void, ms: number) => {
          const t = setInterval(fn, ms);
          t.unref();
          timers.push(t);
        };
        if (isScheduled(job)) {
          // boot catch-up, then a due check every few minutes
          void runOne(job, job.runOnStart ? 'force' : 'due');
          every(() => void runOne(job, 'due'), Math.min(job.intervalMs, dueCheckMs));
        } else {
          if (job.runOnStart) void runOne(job, 'force');
          every(() => void runOne(job, 'force'), job.intervalMs);
        }
      }
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
    runNow: async (name) => runOne(find(name), 'force'),
    runDue: async (name) => runOne(find(name), 'due'),
    names: () => jobs.map((j) => j.name),
  };
}
