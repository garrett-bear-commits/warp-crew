import type { FastifyRequest } from 'fastify';
import type { TraceHeaders } from '../observability/sentry.ts';

/** The caller's Sentry trace headers (the browser sends them on every API call), so the request's
 *  span and every event about it join the browser's trace. */
export function traceHeadersOf(req: FastifyRequest): TraceHeaders {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  return { sentryTrace: first(req.headers['sentry-trace']), baggage: first(req.headers.baggage) };
}
