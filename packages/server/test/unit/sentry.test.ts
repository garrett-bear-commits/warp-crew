import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createTransport, getClient } from '@sentry/node';
import {
  initSentry,
  keepTransaction,
  monitorConfigFor,
  monitorSlug,
  redactEvent,
} from '../../src/observability/sentry.ts';
import { installProcessHandlers } from '../../src/observability/process.ts';
import { AppError } from '../../src/errors.ts';

function fakeTransport() {
  const items: Array<Record<string, unknown>> = [];
  const transport = (options: Parameters<typeof createTransport>[0]) =>
    createTransport(options, async (request) => {
      const body =
        typeof request.body === 'string'
          ? request.body
          : Buffer.from(request.body).toString('utf8');
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        try {
          items.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* header lines that are not JSON */
        }
      }
      return { statusCode: 200 };
    });
  return { items, transport };
}

describe('Sentry wiring (audit F12): optional, redacted, spans', () => {
  it('without a DSN nothing is initialised and every hook is a no-op', async () => {
    const h = initSentry({ dsn: '' });
    expect(h.enabled).toBe(false);
    let ran = false;
    const r = await h.span({ name: 'x', op: 'test' }, async (setStatus) => {
      setStatus(200);
      ran = true;
      return 42;
    });
    expect(r).toBe(42);
    expect(ran).toBe(true);
    h.captureException(new Error('ignored'));
    h.captureMessage('ignored', { level: 'error', fingerprint: ['x'] });
    h.startCheckIn({ slug: 'api-x', intervalMs: 60_000 })('ok');
    expect(await h.flush()).toBe(true);
  });
  it('redactEvent scrubs bearer tokens, key-like headers and player key path segments', () => {
    const e = redactEvent({
      message: 'GET /admin/v1/players/abc123 Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
      request: {
        headers: {
          authorization: 'Bearer zzzzzzzzzzzz',
          'x-admin-secret': 's3cret',
          'x-request-id': 'r1',
        },
      },
      extra: { purchaseSigned: 'jws', token: 't', nested: { password: 'p', ok: 'fine' } },
      breadcrumbs: [{ message: 'x-player-key: playerXYZ01' }],
    });
    expect(e.message).toBe('GET /admin/v1/players/[key] Bearer [redacted]');
    expect(e.request.headers).toEqual({
      authorization: '[redacted]',
      'x-admin-secret': '[redacted]',
      'x-request-id': 'r1',
    });
    expect(e.extra).toEqual({
      purchaseSigned: '[redacted]',
      token: '[redacted]',
      nested: { password: '[redacted]', ok: 'fine' },
    });
    expect(e.breadcrumbs[0]!.message).toBe('x-player-key=[key]');
  });
  it('redactEvent removes direct and batch signed receipts from nested common event shapes', () => {
    const directSecret = 'direct-secret-jws';
    const batchSecret = 'batch-secret-jws';
    const event = redactEvent({
      request: {
        data: { purchaseSigned: directSecret, purchasesSigned: batchSecret },
      },
      extra: {
        nested: { purchaseSigned: directSecret, purchasesSigned: batchSecret },
      },
      contexts: {
        purchase: { purchaseSigned: directSecret, purchasesSigned: batchSecret },
      },
      breadcrumbs: [
        { data: { purchaseSigned: directSecret, purchasesSigned: batchSecret, safe: 'visible' } },
      ],
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(directSecret);
    expect(serialized).not.toContain(batchSecret);
    expect(serialized).toContain('visible');
    expect(serialized.match(/\[redacted\]/g)?.length).toBe(8);
  });
  it('with a DSN: init with release/environment tags, beforeSend redaction, request + command spans become transactions', async () => {
    const { items, transport } = fakeTransport();
    const h = initSentry({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      release: '1.2.3+abc',
      gameId: 'template',
      env: 'lab',
      tracesSampleRate: 1,
      transport,
    });
    expect(h.enabled).toBe(true);
    h.captureException(new Error('boom Bearer abcdefghijklmnop'), {
      requestId: 'r-1',
      authorization: 'Bearer secret',
    });
    await h.span(
      { name: 'PUT /v1/saves', op: 'http.server', attributes: { 'http.route': '/v1/saves' } },
      async (setStatus) => {
        await h.span({ name: 'command saves.write', op: 'command' }, async (s) => s(200));
        setStatus(200);
      },
    );
    await expect(
      h.span({ name: 'GET /boom', op: 'http.server' }, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow(/handler failed/);
    expect(await h.flush(5000)).toBe(true);
    const events = items.filter((i) => typeof i.exception === 'object');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0]!;
    expect(ev.release).toBe('1.2.3+abc');
    expect(ev.environment).toBe('template-lab');
    const exception = ev.exception as { values: Array<{ value: string }> };
    expect(exception.values[0]!.value).toBe('boom Bearer [redacted]');
    const ctx = (ev.contexts as Record<string, unknown>).foundation as Record<string, unknown>;
    expect(ctx).toEqual({ requestId: 'r-1', authorization: '[redacted]' });
    const txs = items.filter((i) => i.type === 'transaction') as Array<{
      transaction: string;
      spans?: Array<{ description?: string; op?: string }>;
      contexts?: { trace?: { status?: string } };
    }>;
    const names = txs.map((t) => t.transaction);
    expect(names).toContain('PUT /v1/saves');
    expect(names).toContain('GET /boom');
    const put = txs.find((t) => t.transaction === 'PUT /v1/saves')!;
    expect(
      put.spans?.some((s) => s.op === 'command' && s.description === 'command saves.write'),
    ).toBe(true);
    const boom = txs.find((t) => t.transaction === 'GET /boom')!;
    expect(boom.contexts?.trace?.status).not.toBe('ok');
    await h.close(1000);
  });
  it('captures unhandled rejections as unhandled errors and sends fingerprinted messages and Crons check-ins', async () => {
    const { items, transport } = fakeTransport();
    const h = initSentry({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      release: '1.2.3',
      gameId: 'template',
      env: 'prod',
      transport,
    });
    const client = getClient()!;
    for (const name of ['OnUncaughtException', 'OnUnhandledRejection', 'LinkedErrors', 'Dedupe'])
      expect(client.getIntegrationByName(name), name).toBeDefined();
    // Call the integration's process listener directly: emitting on `process` would also reach
    // vitest's own unhandled-rejection handler and fail the run.
    for (const l of process.listeners('unhandledRejection'))
      if (l.name === 'sendUnhandledPromise')
        (l as (r: unknown, p: Promise<unknown>) => void)(
          new Error('lost promise Bearer abcdefghijklmnop'),
          Promise.resolve(),
        );
    h.captureMessage('ops page: outbox_dead_letters', {
      level: 'error',
      fingerprint: ['ops-page', 'outbox_dead_letters'],
      tags: { ops_tier: 'page' },
      context: { token: 'secret', issues: [{ message: 'GET /players/abc123' }] },
    });
    h.captureException(new Error('kaput'), { job: 'x' }, { fingerprint: ['job-failed', 'x'] });
    const done = h.startCheckIn({ slug: 'api-economy-anomaly', intervalMs: 86_400_000 });
    done('error');
    done('ok'); // closing twice is ignored
    expect(await h.flush(5000)).toBe(true);

    const exceptions = items.filter((i) => typeof i.exception === 'object') as Array<{
      exception: {
        values: Array<{ value: string; mechanism?: { type: string; handled: boolean } }>;
      };
      fingerprint?: string[];
    }>;
    const rejection = exceptions.find((e) => e.exception.values[0]!.value.startsWith('lost'))!;
    expect(rejection.exception.values[0]).toMatchObject({
      value: 'lost promise Bearer [redacted]',
      mechanism: { type: 'auto.node.onunhandledrejection', handled: false },
    });
    expect(exceptions.find((e) => e.exception.values[0]!.value === 'kaput')?.fingerprint).toEqual([
      'job-failed',
      'x',
    ]);
    const msg = items.find((i) => i.message === 'ops page: outbox_dead_letters') as {
      level: string;
      fingerprint: string[];
      tags: Record<string, string>;
      contexts: { foundation: unknown };
    };
    expect(msg).toMatchObject({
      level: 'error',
      fingerprint: ['ops-page', 'outbox_dead_letters'],
      tags: { ops_tier: 'page' },
    });
    expect(msg.contexts.foundation).toEqual({
      token: '[redacted]',
      issues: [{ message: 'GET /players/[key]' }],
    });
    const checkIns = items.filter((i) => i.monitor_slug === 'api-economy-anomaly') as Array<{
      check_in_id: string;
      status: string;
      monitor_config?: unknown;
    }>;
    expect(checkIns.map((c) => c.status)).toEqual(['in_progress', 'error']);
    expect(checkIns[0]!.check_in_id).toBe(checkIns[1]!.check_in_id);
    expect(checkIns[0]!.monitor_config).toMatchObject({
      schedule: { type: 'interval', value: 1, unit: 'day' },
      checkin_margin: 60,
      max_runtime: 60,
    });
    await h.close(1000);
  });
  it("capture context becomes searchable tags; a cause and an error's own fields go with it", async () => {
    const { items, transport } = fakeTransport();
    const h = initSentry({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      release: '1.2.3',
      gameId: 'template',
      env: 'prod',
      transport,
    });
    const pg = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    });
    h.captureException(
      new AppError(
        'retry_later',
        'database contention; retry later',
        { pgCode: '55P03' },
        undefined,
        {
          cause: pg,
        },
      ),
      {
        requestId: 'req-1',
        route: '/v1/saves',
        method: 'PUT',
        status: 503,
        code: 'retry_later',
        pgCode: '55P03',
      },
    );
    expect(await h.flush(5000)).toBe(true);
    const event = items.find(
      (i) => (i.exception as { values?: unknown[] } | undefined)?.values,
    ) as {
      tags: Record<string, string>;
      exception: { values: { value: string }[] };
      contexts: Record<string, Record<string, unknown>>;
    };
    expect(event.tags).toMatchObject({
      request_id: 'req-1',
      route: '/v1/saves',
      method: 'PUT',
      status: '503',
      code: 'retry_later',
      pg_code: '55P03',
    });
    expect(event.exception.values.map((v) => v.value)).toEqual([
      'canceling statement due to lock timeout',
      'database contention; retry later',
    ]);
    expect(event.contexts.Error).toMatchObject({
      code: 'retry_later',
      status: 503,
      details: { pgCode: '55P03' },
    });
    await h.close(2000);
  });

  it("continues the browser's trace: the request span and its events share the browser's trace id", async () => {
    const { items, transport } = fakeTransport();
    const h = initSentry({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      release: '1.2.3',
      gameId: 'template',
      env: 'prod',
      transport,
    });
    const browserTrace = '0af7651916cd43dd8448eb211c80319c';
    const trace = {
      sentryTrace: `${browserTrace}-b7ad6b7169203331`,
      baggage: `sentry-trace_id=${browserTrace},sentry-public_key=public`,
    };
    await h.span({ name: 'PUT /v1/saves', op: 'http.server', trace }, async (setStatus) => {
      setStatus(500);
    });
    h.captureException(new Error('save failed'), { requestId: 'req-2' }, { trace });
    expect(await h.flush(5000)).toBe(true);
    const traceIds = items
      .map((i) => (i.contexts as { trace?: { trace_id?: string } } | undefined)?.trace?.trace_id)
      .filter(Boolean);
    // One transaction (a 5xx is always kept) and one error, both in the browser's trace.
    expect(traceIds).toEqual([browserTrace, browserTrace]);
    await h.close(2000);
  });

  it('monitor config follows the job interval; slugs are Sentry-safe', () => {
    expect(monitorConfigFor(5 * 60_000)).toEqual({
      schedule: { type: 'interval', value: 5, unit: 'minute' },
      checkinMargin: 10,
      maxRuntime: 10,
    });
    expect(monitorConfigFor(3_600_000)).toMatchObject({
      schedule: { value: 1, unit: 'hour' },
      checkinMargin: 15,
      maxRuntime: 60,
    });
    expect(monitorConfigFor(7 * 86_400_000).schedule).toEqual({
      type: 'interval',
      value: 1,
      unit: 'week',
    });
    expect(monitorSlug('codes.lockAbusedCampaigns')).toBe('api-codes-lockabusedcampaigns');
  });
  it('sampling happens at send time: healthy transactions follow the rate, failed ones are always kept', () => {
    const ok = {
      contexts: { trace: { data: { 'http.response.status_code': 200 }, status: 'ok' } },
    };
    const err = {
      contexts: { trace: { data: { 'http.response.status_code': 503 }, status: 'ok' } },
    };
    const thrown = {
      contexts: { trace: { data: { 'foundation.error': true }, status: 'internal_error' } },
    };
    expect(keepTransaction(ok, 0, () => 0.5)).toBe(false);
    expect(keepTransaction(ok, 0.05, () => 0.01)).toBe(true);
    expect(keepTransaction(ok, 0.05, () => 0.9)).toBe(false);
    expect(keepTransaction(err, 0, () => 0.99)).toBe(true);
    expect(keepTransaction(thrown, 0, () => 0.99)).toBe(true);
  });
});

describe('process failure policy', () => {
  function harness() {
    const proc = new EventEmitter();
    const logged: Array<{ level: string; msg: string }> = [];
    const exits: number[] = [];
    let flushed = 0;
    installProcessHandlers({
      log: {
        error: (_o: unknown, msg?: string) => void logged.push({ level: 'error', msg: msg ?? '' }),
        fatal: (_o: unknown, msg?: string) => void logged.push({ level: 'fatal', msg: msg ?? '' }),
      } as never,
      flush: async () => {
        flushed++;
      },
      exit: (code) => void exits.push(code),
      proc: proc as never,
    });
    return { proc, logged, exits, flushed: () => flushed };
  }
  it('an unhandled rejection is logged and the process stays up', async () => {
    const h = harness();
    h.proc.emit('unhandledRejection', new Error('lost'), Promise.resolve());
    await new Promise((r) => setTimeout(r, 10));
    expect(h.logged).toEqual([
      { level: 'error', msg: 'unhandled promise rejection; process stays up' },
    ]);
    expect(h.exits).toEqual([]);
  });
  it('an uncaught exception is logged, flushed, then exits 1 once', async () => {
    const h = harness();
    h.proc.emit('uncaughtException', new Error('boom'), 'uncaughtException');
    h.proc.emit('uncaughtException', new Error('again'), 'uncaughtException');
    await new Promise((r) => setTimeout(r, 10));
    expect(h.logged.map((l) => l.level)).toEqual(['fatal', 'fatal']);
    expect(h.flushed()).toBe(1);
    expect(h.exits).toEqual([1]);
  });
});
