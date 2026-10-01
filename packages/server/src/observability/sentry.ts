// Sentry (server) — §8, ADR-011, audit F12. Optional: without SENTRY_DSN nothing is initialised and
// every hook is a no-op. With a DSN: SDK init, release tagging (BUILD_VERSION), environment
// `<gameId>-<env>`, request + command spans (sampled; 5xx always), uncaught exceptions and
// unhandled rejections (process behaviour: observability/process.ts), fingerprinted messages for
// background failures and ops pages, Crons check-ins for scheduled jobs, and beforeSend redaction
// through the same scrub rules as pino (logging.ts). The DSN itself is an external gate; the wiring
// is exercised in tests through an injected transport.
import * as Sentry from '@sentry/node';
import { scrubText } from '../logging.ts';

export interface SentryOptions {
  dsn: string;
  release: string;
  gameId: string;
  env: string;
  /** Sample rate for non-error transactions (default 0.05; 5xx / thrown are always kept). */
  tracesSampleRate?: number;
  /** Injected randomness for the sampler (tests). */
  random?: () => number;
  /** Injected transport (tests). */
  transport?: Parameters<typeof Sentry.init>[0] extends infer O
    ? O extends { transport?: infer T }
      ? T
      : never
    : never;
}

/** A caller's trace (the browser's `sentry-trace` and `baggage` headers): the request's span and
 *  any event about it continue that trace, so Sentry links the browser's error to the API's. */
export interface TraceHeaders {
  sentryTrace?: string | undefined;
  baggage?: string | undefined;
}

export interface SpanInfo {
  name: string;
  op: string;
  attributes?: Record<string, string | number | boolean>;
  trace?: TraceHeaders;
}

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info';

export interface CaptureOptions {
  level?: SentryLevel;
  /** Stable grouping: one Sentry issue per fingerprint, so alert rules can key on it. */
  fingerprint?: string[];
  tags?: Record<string, string>;
  trace?: TraceHeaders;
}

/** A Sentry Crons monitor for a scheduled job (one per job and environment). */
export interface MonitorSpec {
  slug: string;
  intervalMs: number;
}

export interface SentryHandle {
  readonly enabled: boolean;
  /** Run fn inside a span (request or command). Status is set from the outcome/status code. */
  span<T>(info: SpanInfo, fn: (setStatus: (statusCode: number) => void) => Promise<T>): Promise<T>;
  captureException(
    error: unknown,
    context?: Record<string, unknown>,
    options?: CaptureOptions,
  ): void;
  /** A message event (background failures, ops pages). Context is redacted like every event. */
  captureMessage(
    message: string,
    options?: CaptureOptions & { context?: Record<string, unknown> },
  ): void;
  /** Open a Crons check-in for one run; call the result with the outcome to close it. */
  startCheckIn(monitor: MonitorSpec): (status: 'ok' | 'error') => void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

const MINUTE = 60_000;

/**
 * Crons config from a job's interval: the schedule is the interval itself; the margin covers the
 * runner's due-check tick (≤ 5 min late) plus a deploy gap; maxRuntime bounds a stuck run.
 */
export function monitorConfigFor(intervalMs: number): MonitorConfig {
  const units = [
    ['week', 7 * 24 * 60 * MINUTE],
    ['day', 24 * 60 * MINUTE],
    ['hour', 60 * MINUTE],
  ] as const;
  const unit = units.find(([, ms]) => intervalMs % ms === 0);
  const schedule: MonitorConfig['schedule'] = unit
    ? { type: 'interval', value: intervalMs / unit[1], unit: unit[0] }
    : { type: 'interval', value: Math.max(1, Math.ceil(intervalMs / MINUTE)), unit: 'minute' };
  const minutes = intervalMs / MINUTE;
  return {
    schedule,
    checkinMargin: Math.min(60, Math.max(10, Math.ceil(minutes / 4))),
    maxRuntime: Math.min(60, Math.max(10, Math.ceil(minutes))),
  };
}

/** Sentry monitor slugs are lowercase [a-z0-9_-]. */
export function monitorSlug(jobName: string): string {
  return `api-${jobName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`.slice(0, 50);
}

const REDACT_KEYS =
  /^(authorization|cookie|x-admin-secret|x-ops-secret|token|purchases?signed|secret|password)$/i;

/** Redact key-like values and bearer tokens anywhere in an event (headers, extra, breadcrumbs, messages). */
export function redactEvent<T>(event: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, key?: string, depth = 0): unknown => {
    if (typeof v === 'string') return key && REDACT_KEYS.test(key) ? '[redacted]' : scrubText(v);
    if (depth > 24) return '[depth]';
    if (Array.isArray(v)) {
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
      return v.map((x) => walk(x, undefined, depth + 1));
    }
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
      if (v instanceof Date) return v;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>))
        out[k] = REDACT_KEYS.test(k) ? '[redacted]' : walk(val, k, depth + 1);
      return out;
    }
    return v;
  };
  return walk(event) as T;
}

/** Send-time sampling: failed transactions (5xx / thrown) are always kept; healthy ones follow the rate. */
export function keepTransaction(
  event: { contexts?: { trace?: { data?: Record<string, unknown>; status?: string } } },
  rate: number,
  random: () => number,
): boolean {
  const data = event.contexts?.trace?.data ?? {};
  const status = data['http.response.status_code'];
  const failed =
    (typeof status === 'number' && status >= 500) ||
    data['foundation.error'] === true ||
    event.contexts?.trace?.status === 'internal_error';
  return failed || random() < rate;
}

const noop: SentryHandle = {
  enabled: false,
  span: (_info, fn) => fn(() => undefined),
  captureException: () => undefined,
  captureMessage: () => undefined,
  startCheckIn: () => () => undefined,
  flush: async () => true,
  close: async () => true,
};

// Sentry contexts are not searchable: these capture-context fields also become tags, so an
// issue can be filtered by route or status and a request found by its id (the client's
// `correlationId`).
const CONTEXT_TAGS: Record<string, string> = {
  requestId: 'request_id',
  route: 'route',
  method: 'method',
  status: 'status',
  code: 'code',
  command: 'command',
  buildVersion: 'build_version',
  reason: 'reason',
  pgCode: 'pg_code',
};

function applyContext(scope: Sentry.Scope, context: Record<string, unknown> | undefined): void {
  if (!context) return;
  scope.setContext('foundation', redactEvent(context));
  for (const [key, tag] of Object.entries(CONTEXT_TAGS)) {
    const value = context[key];
    if (typeof value === 'string' || typeof value === 'number')
      scope.setTag(tag, String(value).slice(0, 200));
  }
}

/** Run fn inside the caller's trace when it sent one. */
function inTrace<T>(trace: TraceHeaders | undefined, fn: () => T): T {
  if (!trace?.sentryTrace) return fn();
  return Sentry.continueTrace({ sentryTrace: trace.sentryTrace, baggage: trace.baggage }, fn);
}

function applyOptions(scope: Sentry.Scope, o: CaptureOptions | undefined): void {
  if (!o) return;
  if (o.level) scope.setLevel(o.level);
  if (o.fingerprint) scope.setFingerprint(o.fingerprint);
  if (o.tags) scope.setTags(o.tags);
}

export function initSentry(o: SentryOptions | { dsn: '' | undefined }): SentryHandle {
  if (!o.dsn) return noop;
  const opts = o as SentryOptions;
  Sentry.init({
    dsn: opts.dsn,
    release: opts.release,
    environment: `${opts.gameId}-${opts.env}`,
    // Record every span; decide at send time so 5xx / thrown transactions are ALWAYS kept and the
    // rest are sampled (a start-time sampler cannot know the outcome).
    tracesSampleRate: 1,
    beforeSend: (event) => redactEvent(event),
    beforeSendTransaction: (event) =>
      keepTransaction(event, opts.tracesSampleRate ?? 0.05, opts.random ?? Math.random)
        ? redactEvent(event)
        : null,
    sendDefaultPii: false,
    // ops/job contexts carry lists of issues; keep them readable (default depth is 3)
    normalizeDepth: 5,
    // Only the error plumbing, no auto-instrumentation (requests/commands are spanned by hand).
    // Unhandled rejections are captured without Sentry's own console logging or exit
    // (mode 'none'); observability/process.ts logs them and decides the process outcome.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration({ mode: 'none' }),
      Sentry.linkedErrorsIntegration(),
      // An error's own fields (pg `code`, `detail`, `constraint`; AppError `details`) go with it.
      Sentry.extraErrorDataIntegration({ depth: 5, captureErrorCause: true }),
      Sentry.dedupeIntegration(),
    ],
    ...(opts.transport ? { transport: opts.transport } : {}),
  });
  Sentry.setTag('game', opts.gameId);
  Sentry.setTag('release', opts.release);
  return {
    enabled: true,
    async span(info, fn) {
      return inTrace(info.trace, () =>
        Sentry.startSpan(
          { name: info.name, op: info.op, attributes: info.attributes ?? {} },
          async (span) => {
            try {
              return await fn((code) => {
                span.setAttribute('http.response.status_code', code);
                span.setStatus({ code: code >= 500 ? 2 : 1 });
                if (code >= 500) span.setAttribute('foundation.error', true);
              });
            } catch (e) {
              span.setStatus({ code: 2, message: e instanceof Error ? e.name : 'error' });
              span.setAttribute('foundation.error', true);
              throw e;
            }
          },
        ),
      );
    },
    captureException(error, context, options) {
      inTrace(options?.trace, () =>
        Sentry.withScope((scope) => {
          applyContext(scope, context);
          applyOptions(scope, options);
          Sentry.captureException(error);
        }),
      );
    },
    captureMessage(message, options) {
      inTrace(options?.trace, () =>
        Sentry.withScope((scope) => {
          applyContext(scope, options?.context);
          applyOptions(scope, options);
          Sentry.captureMessage(message);
        }),
      );
    },
    startCheckIn(monitor) {
      const t0 = performance.now();
      const checkInId = Sentry.captureCheckIn(
        { monitorSlug: monitor.slug, status: 'in_progress' },
        monitorConfigFor(monitor.intervalMs),
      );
      let closed = false;
      return (status) => {
        if (closed) return;
        closed = true;
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: monitor.slug,
          status,
          duration: (performance.now() - t0) / 1000,
        });
      };
    },
    flush: (t) => Sentry.flush(t ?? 2000),
    close: (t) => Sentry.close(t ?? 2000),
  };
}

export { Sentry };
