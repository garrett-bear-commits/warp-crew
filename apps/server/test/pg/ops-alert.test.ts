import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, type Harness } from './harness.ts';
import { recordingSentry } from './sentry-recorder.ts';

const sentry = recordingSentry();
let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'ops-alert', sentry });
});
afterAll(async () => {
  await h?.close();
});

const opsMessages = () => sentry.events.filter((e) => e.message.startsWith('ops '));

describe('ops.alert: page-tier issues reach Sentry from inside the API', () => {
  it('a healthy snapshot sends nothing', async () => {
    const run = await h.server.jobs.runNow('ops.alert');
    expect(run).toMatchObject({
      ran: true,
      ok: true,
      detail: { status: 'ok', page: [], warn: [] },
    });
    expect(opsMessages()).toEqual([]);
  });

  it('a dead letter pages under a stable fingerprint on every check until replayed', async () => {
    const [row] = await h.root<{ id: string }[]>`
      INSERT INTO outbox (kind, payload) VALUES ('test.dead', '{}'::jsonb) RETURNING id`;
    await h.root`INSERT INTO outbox_dead_letters (outbox_id, consumer, attempts, last_error)
      VALUES (${row!.id}, 'test.consumer', 8, 'down')`;
    await h.server.jobs.runNow('ops.alert');
    await h.server.jobs.runNow('ops.alert');
    const pages = opsMessages().filter((e) => e.message === 'ops page: outbox_dead_letters');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      level: 'error',
      fingerprint: ['ops', 'page', 'outbox_dead_letters'],
      context: { issues: [{ tier: 'page', code: 'outbox_dead_letters', value: 1 }] },
    });
    await h.root`UPDATE outbox_dead_letters SET replayed_at = now(), replayed_by = 'test'`;
    sentry.events.length = 0;
    const quiet = await h.server.jobs.runNow('ops.alert');
    expect(quiet.detail).toMatchObject({ page: [] });
    expect(opsMessages()).toEqual([]);
  });

  it('a replica that just booted does not page for a deploy gap, then does once settled', async () => {
    const gap = new Date(h.clock.now() - 10 * 60_000);
    await h.root`INSERT INTO job_runs (name, started_at, finished_at, ok)
      VALUES ('outbox.drain', ${gap}, ${gap}, true)`;
    const drain = async () =>
      (await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() }))
        .json()
        .jobs.find((j: { name: string }) => j.name === 'outbox.drain');
    expect(await drain()).toMatchObject({ overdue: false });
    h.clock.advance(3 * 60_000);
    expect(await drain()).toMatchObject({ overdue: true });
  });

  it('jobs with no heartbeat page once the process has been up past the grace period', async () => {
    const before = await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() });
    const never = (body: { jobs: Array<{ name: string; overdue: boolean }> }) =>
      body.jobs.find((j) => j.name === 'economy.anomaly')!;
    expect(never(before.json())).toMatchObject({ overdue: false });
    h.clock.advance(16 * 60_000);
    const ops = await h.inject({ method: 'GET', url: '/health/ops', headers: h.opsHeaders() });
    const overdue = ops
      .json()
      .jobs.filter((j: { overdue: boolean }) => j.overdue)
      .map((j: { name: string }) => j.name);
    // jobsEnabled is false in the harness: these never ran
    expect(overdue).toContain('economy.anomaly');
    expect(overdue).toContain('outbox.drain');
    await h.server.jobs.runNow('ops.alert');
    const page = opsMessages().find((e) => e.message === 'ops page: job_overdue');
    expect(page?.fingerprint).toEqual(['ops', 'page', 'job_overdue']);
    expect(JSON.stringify(page?.context)).toContain('job economy.anomaly overdue');
  });
});
