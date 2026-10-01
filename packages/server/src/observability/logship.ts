// API log shipping to PostHog Logs over OTLP/HTTP JSON. Off
// unless POSTHOG_LOGS_TOKEN is set; stdout logging is unchanged either way.
//
// The shipper is a pino destination: each JSON line is redacted (pino's redaction paths already
// ran; redactEvent adds the Sentry scrub of key-like fields, bearer tokens and player-key path
// segments), stripped of IP addresses, turned into an OTLP log record and buffered. A timer sends
// batches, one request at a time. The buffer is bounded: on overflow records are dropped and a
// "dropped N" record says so in the next batch. A failed or slow export never throws, never blocks
// a request and never logs through pino (no loops); it notes the failure on stderr, rate-limited.
import { hostname } from 'node:os';
import { redactEvent } from './sentry.ts';
import { systemClock, type ServerClock } from '../clock/index.ts';

export const POSTHOG_LOGS_URL = 'https://us.i.posthog.com/i/v1/logs';

export interface LogShipperOptions {
  url: string;
  /** PostHog project token (phc_…), sent as a Bearer token. Never logged. */
  token: string;
  resource: {
    service: string;
    gameId: string;
    env: string;
    version: string;
    commit?: string;
  };
  fetch?: typeof fetch;
  clock?: ServerClock;
  /** Records held while waiting to send (default 5000); beyond it new records are dropped. */
  maxBuffer?: number;
  /** Records per request (default 500). */
  batchSize?: number;
  flushIntervalMs?: number;
  /** Per-request timeout (default 10 s). */
  timeoutMs?: number;
  /** Failure notes (default: one JSON line on stderr at most once a minute). */
  onError?: (note: { status?: number; error?: string; records: number }) => void;
}

export interface LogShipper {
  /** pino destination: one serialized log line per call. Never throws. */
  write(line: string): void;
  /** Send everything buffered now (one request in flight at a time). */
  flush(): Promise<void>;
  /** Stop the timer and flush what is buffered, bounded by timeoutMs. */
  close(timeoutMs?: number): Promise<void>;
  stats(): { buffered: number; sent: number; dropped: number; failed: number };
}

type AnyValue =
  { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };
interface KeyValue {
  key: string;
  value: AnyValue;
}
interface LogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: KeyValue[];
}

const SEVERITY: Record<number, [number, string]> = {
  10: [1, 'TRACE'],
  20: [5, 'DEBUG'],
  30: [9, 'INFO'],
  40: [13, 'WARN'],
  50: [17, 'ERROR'],
  60: [21, 'FATAL'],
};

/** Never exported: client addresses (and the request/socket fields that carry them). */
const IP_KEYS =
  /^(ip|ips|clientip|remoteaddress|remoteport|x-forwarded-for|x-real-ip|cf-connecting-ip|forwarded)$/i;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// full 8-group form, or a compressed form with `::` (a clock time like 11:15:40 is neither)
const IPV6 =
  /(?:\b[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|(?:\b[0-9a-f]{1,4})?(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}:)*[0-9a-f]{1,4}\b/gi;
const MAX_ATTRIBUTES = 64;
const MAX_STRING = 4096;
const MAX_DEPTH = 3;

const scrubIps = (s: string) => s.replace(IPV4, '[ip]').replace(IPV6, '[ip]');
const clip = (s: string) => (s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s);

function anyValue(v: unknown): AnyValue | undefined {
  if (typeof v === 'string') return { stringValue: clip(scrubIps(v)) };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number')
    return Number.isSafeInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (typeof v === 'bigint') return { intValue: v.toString() };
  return undefined;
}

function flatten(obj: Record<string, unknown>, out: KeyValue[], prefix = '', depth = 0): void {
  for (const [k, v] of Object.entries(obj)) {
    if (out.length >= MAX_ATTRIBUTES) return;
    if (v === null || v === undefined || IP_KEYS.test(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && !Array.isArray(v) && depth < MAX_DEPTH) {
      flatten(v as Record<string, unknown>, out, key, depth + 1);
      continue;
    }
    const value =
      typeof v === 'object' ? { stringValue: clip(scrubIps(JSON.stringify(v))) } : anyValue(v);
    if (value) out.push({ key, value });
  }
}

/** Pure: one pino log object → one OTLP log record (redacted, IP-free). */
export function toOtlpRecord(line: Record<string, unknown>, observedMs: number): LogRecord {
  const { level, time, msg, pid: _pid, hostname: _host, err, ...rest } = redactEvent(line);
  const [severityNumber, severityText] = SEVERITY[Number(level)] ?? [9, 'INFO'];
  const attributes: KeyValue[] = [];
  // pino's err serializer gives {type, message, stack}; some call sites log err as a string
  if (typeof err === 'string') attributes.push({ key: 'exception.message', value: anyValue(err)! });
  else if (err && typeof err === 'object') {
    const { type, message, stack, ...more } = err as Record<string, unknown>;
    if (typeof type === 'string')
      attributes.push({ key: 'exception.type', value: anyValue(type)! });
    if (typeof message === 'string')
      attributes.push({ key: 'exception.message', value: anyValue(message)! });
    if (typeof stack === 'string')
      attributes.push({ key: 'exception.stacktrace', value: anyValue(stack)! });
    flatten(more, attributes, 'err', 1);
  }
  flatten(rest, attributes);
  const ms = typeof time === 'number' ? time : observedMs;
  return {
    timeUnixNano: `${Math.trunc(ms)}000000`,
    observedTimeUnixNano: `${Math.trunc(observedMs)}000000`,
    severityNumber,
    severityText,
    body: { stringValue: typeof msg === 'string' ? clip(scrubIps(msg)) : '' },
    attributes,
  };
}

function resourceAttributes(r: LogShipperOptions['resource']): KeyValue[] {
  const attrs: Record<string, string | number> = {
    'service.name': r.service,
    'service.namespace': r.gameId,
    'service.version': r.version,
    'deployment.environment.name': r.env,
    'deployment.environment': r.env,
    'host.name': hostname(),
    'process.pid': process.pid,
  };
  if (r.commit) attrs['vcs.ref.head.revision'] = r.commit;
  return Object.entries(attrs).map(([key, v]) => ({ key, value: anyValue(v)! }));
}

export function createLogShipper(o: LogShipperOptions): LogShipper {
  const doFetch = o.fetch ?? fetch;
  const clock = o.clock ?? systemClock;
  const maxBuffer = o.maxBuffer ?? 5000;
  const batchSize = o.batchSize ?? 500;
  const timeoutMs = o.timeoutMs ?? 10_000;
  const resource = { attributes: resourceAttributes(o.resource) };
  let lastNote = 0;
  const onError =
    o.onError ??
    ((note) => {
      if (clock.now() - lastNote < 60_000) return;
      lastNote = clock.now();
      process.stderr.write(
        `${JSON.stringify({ level: 40, time: clock.now(), msg: 'log shipping failed', ...note })}\n`,
      );
    });
  const buffer: LogRecord[] = [];
  const totals = { sent: 0, dropped: 0, failed: 0 };
  let droppedSinceReport = 0;
  let inflight: Promise<boolean> | null = null;
  let closed = false;

  const dropped = () => {
    totals.dropped++;
    droppedSinceReport++;
  };

  /** Send one batch; false when nothing was sent (empty or failed). */
  async function sendBatch(): Promise<boolean> {
    if (buffer.length === 0 && droppedSinceReport === 0) return false;
    const batch = buffer.splice(0, batchSize);
    if (droppedSinceReport > 0) {
      const now = clock.now();
      batch.push(
        toOtlpRecord(
          { level: 40, time: now, msg: `log shipping dropped ${droppedSinceReport} records` },
          now,
        ),
      );
      droppedSinceReport = 0;
    }
    const body = JSON.stringify({
      resourceLogs: [
        { resource, scopeLogs: [{ scope: { name: '@foundation/server' }, logRecords: batch }] },
      ],
    });
    try {
      const res = await doFetch(o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.token}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        totals.failed += batch.length;
        onError({ status: res.status, records: batch.length });
        return false;
      }
      totals.sent += batch.length;
      return true;
    } catch (e) {
      totals.failed += batch.length;
      onError({ error: e instanceof Error ? e.name : 'error', records: batch.length });
      return false;
    }
  }

  /** Drain in batches until empty or a batch fails (the next tick retries what is left). */
  function drain(): Promise<boolean> {
    if (inflight) return inflight;
    inflight = (async () => {
      let progressed = false;
      while (await sendBatch()) progressed = true;
      return progressed;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const timer = setInterval(() => void drain(), o.flushIntervalMs ?? 2000);
  timer.unref();

  return {
    write(line) {
      if (closed) return;
      if (buffer.length >= maxBuffer) return dropped();
      try {
        buffer.push(toOtlpRecord(JSON.parse(line) as Record<string, unknown>, clock.now()));
      } catch {
        return dropped();
      }
      if (buffer.length >= batchSize && !inflight) void drain();
    },
    async flush() {
      if (inflight) await inflight;
      await drain();
    },
    async close(closeTimeoutMs = 2000) {
      closed = true;
      clearInterval(timer);
      const deadline = new Promise<void>((resolve) => setTimeout(resolve, closeTimeoutMs).unref());
      const finish = (async () => {
        if (inflight) await inflight;
        while (buffer.length > 0 || droppedSinceReport > 0) if (!(await drain())) break;
      })();
      await Promise.race([finish, deadline]);
    },
    stats: () => ({ buffered: buffer.length, ...totals }),
  };
}

/** The shipper the config asks for, or null (no token: staging and local stay off). */
export function logShipperFromConfig(c: {
  posthogLogsToken: string;
  posthogLogsUrl: string;
  gameId: string;
  env: string;
  buildVersion: string;
  buildCommit: string;
}): LogShipper | null {
  if (!c.posthogLogsToken) return null;
  return createLogShipper({
    url: c.posthogLogsUrl || POSTHOG_LOGS_URL,
    token: c.posthogLogsToken,
    resource: {
      service: 'api',
      gameId: c.gameId,
      env: c.env,
      version: c.buildVersion,
      ...(c.buildCommit ? { commit: c.buildCommit } : {}),
    },
  });
}
