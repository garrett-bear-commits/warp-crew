// Sentry (server) — §8, ADR-011, audit F12. Optional: without SENTRY_DSN nothing is initialised and
// every hook is a no-op. With a DSN: SDK init, release tagging (BUILD_VERSION), environment
// `<gameId>-<env>`, request + command spans (sampled; 5xx always), and beforeSend redaction through
// the same scrub rules as pino (logging.ts). The DSN itself is an external gate; the wiring is
// exercised in tests through an injected transport.
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

export interface SpanInfo {
  name: string;
  op: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface SentryHandle {
  readonly enabled: boolean;
  /** Run fn inside a span (request or command). Status is set from the outcome/status code. */
  span<T>(info: SpanInfo, fn: (setStatus: (statusCode: number) => void) => Promise<T>): Promise<T>;
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}

const REDACT_KEYS =
  /^(authorization|cookie|x-admin-secret|x-ops-secret|token|purchasesigned|secret|password)$/i;

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
  flush: async () => true,
  close: async () => true,
};

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
    defaultIntegrations: false,
    integrations: [],
    ...(opts.transport ? { transport: opts.transport } : {}),
  });
  Sentry.setTag('game', opts.gameId);
  Sentry.setTag('release', opts.release);
  return {
    enabled: true,
    async span(info, fn) {
      return Sentry.startSpan(
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
      );
    },
    captureException(error, context) {
      Sentry.withScope((scope) => {
        if (context) scope.setContext('foundation', redactEvent(context));
        Sentry.captureException(error);
      });
    },
    flush: (t) => Sentry.flush(t ?? 2000),
    close: (t) => Sentry.close(t ?? 2000),
  };
}

export { Sentry };
