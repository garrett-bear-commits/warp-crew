import { describe, expect, it } from 'vitest';
import { createTransport } from '@sentry/node';
import { initSentry, keepTransaction, redactEvent } from '../../src/observability/sentry.ts';

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
