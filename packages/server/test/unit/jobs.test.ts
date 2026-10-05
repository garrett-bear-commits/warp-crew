import { describe, expect, it } from 'vitest';
import { createJobRunner, jobDue, type JobDef } from '../../src/jobs/index.ts';
import { fixedClock } from '../../src/clock/index.ts';
import type { Db } from '../../src/db/index.ts';

// A fake transaction: answers the lock query, and fails the statement whose text matches `failOn`.
function fakeDb(o: { txRejects?: Error; failOn?: RegExp }): Db {
  const tx = Object.assign(
    async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (o.failOn?.test(text)) throw new Error(`connection terminated during ${o.failOn.source}`);
      if (text.includes('pg_try_advisory_xact_lock')) return [{ ok: true }];
      if (text.includes('INSERT INTO job_runs')) return [{ id: 1 }];
      return [];
    },
    { json: (v: unknown) => v },
  );
  return {
    tx: async (fn: (t: typeof tx) => Promise<unknown>) => {
      if (o.txRejects) throw o.txRejects;
      return fn(tx);
    },
  } as unknown as Db;
}

function recorder() {
  const errors: Array<{ o: object; m: string }> = [];
  const captured: Array<{ error: unknown; fingerprint?: string[] }> = [];
  const checkIns: Array<{ slug: string; status?: string }> = [];
  return {
    errors,
    captured,
    checkIns,
    opts: {
      log: { info: () => undefined, error: (o: object, m: string) => void errors.push({ o, m }) },
      sentry: {
        captureException: (error: unknown, _c?: unknown, opt?: { fingerprint?: string[] }) =>
          void captured.push({
            error,
            ...(opt?.fingerprint ? { fingerprint: opt.fingerprint } : {}),
          }),
        startCheckIn: (m: { slug: string }) => {
          const entry: { slug: string; status?: string } = { slug: m.slug };
          checkIns.push(entry);
          return (status: 'ok' | 'error') => void (entry.status = status);
        },
      },
    },
  };
}

const job = (over: Partial<JobDef> = {}): JobDef => ({
  name: 'nightly',
  intervalMs: 5,
  runOnStart: true,
  run: async () => ({ done: true }),
  ...over,
});

describe('job runner crash safety', () => {
  it('a database failure on the boot run and on timer ticks is logged and reported, never an unhandled rejection', async () => {
    const r = recorder();
    const runner = createJobRunner(
      fakeDb({ txRejects: new Error('ECONNRESET') }),
      fixedClock(0),
      [job()],
      r.opts,
    );
    runner.start();
    await new Promise((res) => setTimeout(res, 40));
    runner.stop();
    // boot run + several interval ticks, each caught (vitest fails the run on an unhandled rejection)
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.errors[0]).toEqual({
      o: { job: 'nightly', err: 'ECONNRESET' },
      m: 'job runner failed',
    });
    expect(r.captured[0]!.fingerprint).toEqual(['job-runner', 'nightly']);
    expect(await runner.runNow('nightly')).toEqual({ ran: false, ok: false, error: 'ECONNRESET' });
  });

  it('a failed heartbeat insert is caught like a failed transaction', async () => {
    const r = recorder();
    const runner = createJobRunner(
      fakeDb({ failOn: /INSERT INTO job_runs/ }),
      fixedClock(0),
      [job()],
      r.opts,
    );
    const res = await runner.runNow('nightly');
    expect(res).toMatchObject({ ran: false, ok: false });
    expect(res.error).toMatch(/connection terminated/);
    expect(r.captured.map((c) => c.fingerprint)).toEqual([['job-runner', 'nightly']]);
  });

  it('a job failure is recorded, reported under the job fingerprint and checks in as error', async () => {
    const r = recorder();
    const runner = createJobRunner(
      fakeDb({}),
      fixedClock(0),
      [
        job({
          monitor: true,
          run: async () => {
            throw new Error('kaput');
          },
        }),
      ],
      r.opts,
    );
    expect(await runner.runNow('nightly')).toEqual({ ran: true, ok: false, error: 'kaput' });
    expect(r.captured.map((c) => c.fingerprint)).toEqual([['job-failed', 'nightly']]);
    expect(r.checkIns).toEqual([{ slug: 'api-nightly', status: 'error' }]);
  });

  it('a heartbeat update that fails after the job ran closes the check-in as error', async () => {
    const r = recorder();
    const runner = createJobRunner(
      fakeDb({ failOn: /UPDATE job_runs/ }),
      fixedClock(0),
      [job({ monitor: true })],
      r.opts,
    );
    expect(await runner.runNow('nightly')).toMatchObject({ ran: false, ok: false });
    expect(r.checkIns).toEqual([{ slug: 'api-nightly', status: 'error' }]);
  });

  it('only monitored jobs check in; a successful run checks in ok', async () => {
    const r = recorder();
    const runner = createJobRunner(
      fakeDb({}),
      fixedClock(0),
      [job({ name: 'fast', intervalMs: 2000 }), job({ name: 'daily', intervalMs: 86_400_000 })],
      r.opts,
    );
    await runner.runNow('fast');
    await runner.runNow('daily');
    expect(r.checkIns).toEqual([{ slug: 'api-daily', status: 'ok' }]);
  });
});

describe('scheduled jobs', () => {
  const H = 3_600_000;
  it('are due when the last success is an interval old or missing, and retry failures after a delay', () => {
    const daily = { intervalMs: 24 * H };
    const now = 100 * H;
    expect(jobDue(daily, now, {})).toBe(true);
    expect(jobDue(daily, now, { okAt: now - 23 * H, attemptAt: now - 23 * H })).toBe(false);
    expect(jobDue(daily, now, { okAt: now - 25 * H, attemptAt: now - 25 * H })).toBe(true);
    // never succeeded / last success stale, but the last attempt just failed: wait 15 min
    expect(jobDue(daily, now, { attemptAt: now - 5 * 60_000 })).toBe(false);
    expect(jobDue(daily, now, { okAt: now - 30 * H, attemptAt: now - 16 * 60_000 })).toBe(true);
    // a 5-minute job whose tick lands a little early still runs every tick
    const fiveMin = { intervalMs: 5 * 60_000 };
    expect(
      jobDue(fiveMin, now, { okAt: now - 4.75 * 60_000, attemptAt: now - 4.75 * 60_000 }),
    ).toBe(true);
    expect(jobDue(fiveMin, now, { okAt: now - 60_000, attemptAt: now - 60_000 })).toBe(false);
  });

  it('run at most maxConcurrent at once; fast jobs are not limited', async () => {
    let active = 0;
    let peak = 0;
    const slow = (name: string, intervalMs = 3_600_000): JobDef => ({
      name,
      intervalMs,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((res) => setTimeout(res, 20));
        active--;
      },
    });
    const runner = createJobRunner(
      fakeDb({}),
      fixedClock(0),
      [slow('a'), slow('b'), slow('c'), slow('d')],
      { maxConcurrent: 2 },
    );
    const results = await Promise.all(['a', 'b', 'c', 'd'].map((n) => runner.runDue(n)));
    expect(results.every((r) => r.ran && r.ok)).toBe(true);
    expect(peak).toBe(2);
  });
});
