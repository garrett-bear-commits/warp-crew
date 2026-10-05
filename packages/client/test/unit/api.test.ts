import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/api.ts';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('client API credential step-up', () => {
  it('refreshes once and retries the same mutation body when the server requests step-up', async () => {
    let token = 'old-token';
    const bodies: string[] = [];
    const authHeaders: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      bodies.push(String(init?.body));
      authHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
      return authHeaders.length === 1
        ? response(401, {
            error: 'unauthorized',
            correlationId: 'first',
            details: { stepUp: true },
          })
        : response(200, { ok: true });
    });
    const refreshAuth = vi.fn(async () => {
      token = 'fresh-token';
      return true;
    });
    const body = { commandId: '018f4a2e-4b1c-7a2d-9c3e-1f2a3b4c5d6e', value: 7 };
    const api = createApi({
      baseUrl: 'https://game.example',
      fetch,
      auth: () => ({ playerKey: 'p1', token }),
      refreshAuth,
      requestId: () => 'request-1',
    });

    await expect(api.call('POST', '/v1/value', body)).resolves.toMatchObject({
      ok: true,
      status: 200,
    });
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authHeaders).toEqual(['Bearer old-token', 'Bearer fresh-token']);
    expect(bodies).toEqual([JSON.stringify(body), JSON.stringify(body)]);
  });

  it('does not refresh for an ordinary 401, unauthenticated call, or auth override', async () => {
    const refreshAuth = vi.fn(async () => true);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response(401, { error: 'unauthorized', correlationId: 'no-step-up' }),
    );
    const api = createApi({
      baseUrl: 'https://game.example',
      fetch,
      auth: () => ({ playerKey: 'p1', token: 'token' }),
      refreshAuth,
    });

    await api.call('GET', '/v1/me');
    await api.call('GET', '/v1/public', undefined, { auth: false });
    await api.call(
      'POST',
      '/v1/switch',
      { commandId: 'c' },
      {
        authOverride: { playerKey: 'old', token: 'old-token' },
      },
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('returns the original step-up response when refresh fails and never loops', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response(401, {
        error: 'unauthorized',
        correlationId: 'stale',
        details: { stepUp: true },
      }),
    );
    const api = createApi({
      baseUrl: 'https://game.example',
      fetch,
      auth: () => ({ playerKey: 'p1', token: 'old' }),
      refreshAuth: async () => false,
    });

    await expect(api.call('POST', '/v1/value', { commandId: 'c' })).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('client API correlation', () => {
  it('sends trace headers with every call and keeps the request id of a failed one', async () => {
    const sent: Headers[] = [];
    let fail: 'http' | 'network' = 'http';
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      sent.push(new Headers(init?.headers));
      if (fail === 'network') throw new TypeError('Load failed');
      return response(503, { error: 'retry_later', correlationId: 'req-a' });
    });
    let next = 0;
    const api = createApi({
      baseUrl: 'https://game.example',
      fetch,
      requestId: () => `req-${'ab'[next++]}`,
      traceHeaders: () => ({
        'sentry-trace': 'trace-1-span-1',
        baggage: 'sentry-trace_id=trace-1',
      }),
    });

    await expect(api.call('GET', '/v1/saves/current')).resolves.toMatchObject({
      ok: false,
      status: 503,
      requestId: 'req-a',
    });
    fail = 'network';
    // No envelope came back, but the id it sent still finds the request in the API's logs.
    await expect(api.call('GET', '/v1/saves/current')).resolves.toMatchObject({
      ok: false,
      status: 0,
      networkError: 'Load failed',
      requestId: 'req-b',
    });
    expect(
      sent.map((h) => [h.get('x-request-id'), h.get('sentry-trace'), h.get('baggage')]),
    ).toEqual([
      ['req-a', 'trace-1-span-1', 'sentry-trace_id=trace-1'],
      ['req-b', 'trace-1-span-1', 'sentry-trace_id=trace-1'],
    ]);
  });
});
