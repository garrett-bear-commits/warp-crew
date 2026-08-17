// Jobs (§4.2): setInterval().unref() under a per-job advisory lock, heartbeats in job_runs.
import type { Db } from '../db/index.ts';
import type { ServerClock } from '../clock/index.ts';

export interface JobDef {
  name: string;
  intervalMs: number;
  /** Run at boot as well as on the interval. */
  runOnStart?: boolean;
  run(): Promise<unknown>;
}

export interface JobRunner {
  start(): void;
  stop(): void;
  /** Run one job now (tests / CLI). Returns false if the lock was held elsewhere. */
  runNow(name: string): Promise<{ ran: boolean; ok: boolean; error?: string; detail?: unknown }>;
  names(): string[];
}

export function createJobRunner(
  db: Db,
  clock: ServerClock,
  jobs: JobDef[],
  log?: { info(o: object, m: string): void; error(o: object, m: string): void },
): JobRunner {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();

  async function runOne(
    job: JobDef,
  ): Promise<{ ran: boolean; ok: boolean; error?: string; detail?: unknown }> {
    if (running.has(job.name)) return { ran: false, ok: true };
    running.add(job.name);
    const startedAt = new Date(clock.now());
    const t0 = process.hrtime.bigint();
    try {
      // per-job advisory lock held for the duration of a dedicated transaction
      return await db.tx(async (tx) => {
        const got = await tx<
          { ok: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(3, hashtext(${job.name})) AS ok`;
        if (!got[0]?.ok) return { ran: false, ok: true };
        const ins = await tx<
          { id: number }[]
        >`INSERT INTO job_runs (name, started_at) VALUES (${job.name}, ${startedAt}) RETURNING id`;
        const id = ins[0]!.id;
        try {
          const detail = await job.run();
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          await tx`UPDATE job_runs SET finished_at = ${new Date(clock.now())}, ok = true, duration_ms = ${ms}, detail = ${tx.json((detail ?? null) as never)} WHERE id = ${id}`;
          return { ran: true, ok: true, detail };
        } catch (e) {
          const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
          const err = e instanceof Error ? e.message : String(e);
          await tx`UPDATE job_runs SET finished_at = ${new Date(clock.now())}, ok = false, duration_ms = ${ms}, error = ${err} WHERE id = ${id}`;
          log?.error({ job: job.name, err }, 'job failed');
          return { ran: true, ok: false, error: err };
        }
      });
    } finally {
      running.delete(job.name);
    }
  }

  return {
    start() {
      for (const job of jobs) {
        if (job.runOnStart) void runOne(job);
        const t = setInterval(() => void runOne(job), job.intervalMs);
        t.unref();
        timers.push(t);
      }
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
    async runNow(name) {
      const job = jobs.find((j) => j.name === name);
      if (!job) throw new Error(`unknown job ${name}`);
      return runOne(job);
    },
    names: () => jobs.map((j) => j.name),
  };
}
