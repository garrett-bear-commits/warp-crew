import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/server.ts';
import {
  createLogShipper,
  logShipperFromConfig,
  POSTHOG_LOGS_URL,
} from '../../src/observability/logship.ts';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: {
    resourceLogs: Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
      scopeLogs: Array<{
        logRecords: Array<{
          severityText: string;
          severityNumber: number;
          timeUnixNano: string;
          body: { stringValue: string };
          attributes: Array<{ key: string; value: Record<string, unknown> }>;
        }>;
      }>;
    }>;
  };
}

/** A fake OTLP collector: records requests; `hold` keeps responses pending until released. */
function collector(o: { status?: number; reject?: boolean } = {}) {
  const sent: Sent[] = [];
  let held: Array<() => void> | null = null;
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    if (held) await new Promise<void>((resolve) => held!.push(resolve));
    if (o.reject) throw new TypeError('fetch failed');
    return new Response(null, { status: o.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return {
    sent,
    fetch,
    hold: () => void (held = []),
    release: () => {
      const h = held ?? [];
      held = null;
      for (const r of h) r();
    },
    records: () => sent.flatMap((s) => s.body.resourceLogs[0]!.scopeLogs[0]!.logRecords),
  };
}

const attrs = (list: Array<{ key: string; value: Record<string, unknown> }>) =>
  Object.fromEntries(list.map((a) => [a.key, Object.values(a.value)[0]]));

const resource = {
  service: 'api',
  gameId: 'template',
  env: 'prod',
  version: '1.2.3',
  commit: 'abc123',
};

describe('PostHog log shipping (OTLP/HTTP JSON)', () => {
  it('ships redacted, IP-free records with resource attributes while stdout keeps every line', async () => {
    const c = collector();
    const shipper = createLogShipper({
      url: POSTHOG_LOGS_URL,
      token: 'phc_test',
      resource,
      fetch: c.fetch,
    });
    const stdout: string[] = [];
    const log = createLogger('info', {
      ship: shipper,
      stdout: { write: (l) => void stdout.push(l) },
    });
    log.info(
      {
        requestId: 'req-1',
        playerKey: 'player-1',
        ip: '203.0.113.7',
        authorization: 'Bearer abcdefghijklmnop',
        token: 'raw-token',
        req: { remoteAddress: '198.51.100.2', url: '/v1/saves' },
        note: 'retry from 198.51.100.9 at 11:15:40 via ::ffff:10.0.0.1',
      },
      'saved',
    );
    log.error({ err: new Error('boom Bearer abcdefghijklmnop') }, 'failed');
    log.debug('below the level');
    await shipper.flush();

    expect(stdout).toHaveLength(2);
    expect(c.sent).toHaveLength(1);
    const [req] = c.sent;
    expect(req!.url).toBe('https://us.i.posthog.com/i/v1/logs');
    expect(req!.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer phc_test',
    });
    expect(attrs(req!.body.resourceLogs[0]!.resource.attributes)).toMatchObject({
      'service.name': 'api',
      'service.namespace': 'template',
      'service.version': '1.2.3',
      'deployment.environment.name': 'prod',
      'vcs.ref.head.revision': 'abc123',
    });
    const [info, error] = c.records();
    expect(info).toMatchObject({
      severityText: 'INFO',
      severityNumber: 9,
      body: { stringValue: 'saved' },
    });
    expect(info!.timeUnixNano).toMatch(/^\d{19}$/);
    const a = attrs(info!.attributes);
    expect(a).toMatchObject({
      requestId: 'req-1',
      playerKey: 'player-1',
      authorization: '[redacted]',
      token: '[redacted]',
      'req.url': '/v1/saves',
      note: 'retry from [ip] at 11:15:40 via [ip]:[ip]',
    });
    expect(Object.keys(a)).not.toContain('ip');
    expect(Object.keys(a)).not.toContain('req.remoteAddress');
    expect(JSON.stringify(c.sent)).not.toMatch(
      /203\.0\.113|198\.51\.100|raw-token|abcdefghijklmnop/,
    );
    expect(error).toMatchObject({ severityText: 'ERROR', body: { stringValue: 'failed' } });
    expect(attrs(error!.attributes)).toMatchObject({
      'exception.type': 'Error',
      'exception.message': 'boom Bearer [redacted]',
    });
    expect(attrs(error!.attributes)['exception.stacktrace']).toMatch(/logship\.test\.ts/);
  });

  it('a full buffer drops records without blocking, then reports how many were dropped', async () => {
    const c = collector();
    c.hold();
    const shipper = createLogShipper({
      url: POSTHOG_LOGS_URL,
      token: 't',
      resource,
      fetch: c.fetch,
      maxBuffer: 5,
      batchSize: 2,
    });
    const line = (i: number) => JSON.stringify({ level: 30, time: 1, msg: `m${i}` });
    // batchSize reached: one request goes out and hangs; the rest buffer until the cap
    for (let i = 0; i < 12; i++) shipper.write(line(i));
    shipper.write('not json');
    expect(c.sent).toHaveLength(1);
    expect(shipper.stats()).toMatchObject({ buffered: 5, dropped: 6 });
    c.release();
    await shipper.flush();
    const msgs = c.records().map((r) => r.body.stringValue);
    expect(msgs).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'log shipping dropped 6 records',
      'm4',
      'm5',
      'm6',
    ]);
    expect(shipper.stats()).toMatchObject({ buffered: 0, sent: 8, dropped: 6, failed: 0 });
  });

  it('a failing collector never throws; records queued behind a failure are tried on the next flush', async () => {
    const notes: unknown[] = [];
    const down = collector({ status: 503 });
    const shipper = createLogShipper({
      url: POSTHOG_LOGS_URL,
      token: 't',
      resource,
      fetch: down.fetch,
      batchSize: 1,
      onError: (n) => void notes.push(n),
    });
    shipper.write(JSON.stringify({ level: 50, time: 1, msg: 'a' }));
    shipper.write(JSON.stringify({ level: 50, time: 1, msg: 'b' }));
    // 'a' fails while 'b' waits; the next flush tries 'b' (and drops it as failed too)
    await shipper.flush();
    expect(notes).toEqual([
      { status: 503, records: 1 },
      { status: 503, records: 1 },
    ]);
    expect(shipper.stats()).toMatchObject({ buffered: 0, failed: 2, sent: 0 });

    const offline = collector({ reject: true });
    const s2 = createLogShipper({
      url: POSTHOG_LOGS_URL,
      token: 't',
      resource,
      fetch: offline.fetch,
      onError: () => undefined,
    });
    s2.write(JSON.stringify({ level: 30, time: 1, msg: 'x' }));
    await expect(s2.flush()).resolves.toBeUndefined();
    expect(s2.stats()).toMatchObject({ failed: 1 });
    await s2.close(100);
  });

  it('close flushes what is buffered and ignores later writes (SIGTERM path)', async () => {
    const c = collector();
    const shipper = createLogShipper({
      url: POSTHOG_LOGS_URL,
      token: 't',
      resource,
      fetch: c.fetch,
    });
    shipper.write(JSON.stringify({ level: 30, time: 1, msg: 'shutting down' }));
    await shipper.close(1000);
    shipper.write(JSON.stringify({ level: 30, time: 1, msg: 'after close' }));
    await shipper.flush();
    expect(c.records().map((r) => r.body.stringValue)).toEqual(['shutting down']);
  });

  it('is off without a token and defaults to the PostHog US endpoint', () => {
    const base = {
      posthogLogsUrl: '',
      gameId: 'template',
      env: 'lab',
      buildVersion: '0.22.0',
      buildCommit: '',
    };
    expect(logShipperFromConfig({ ...base, posthogLogsToken: '' })).toBeNull();
    const s = logShipperFromConfig({ ...base, posthogLogsToken: 'phc_x' });
    expect(s).not.toBeNull();
    void s!.close(10);
  });
});
