// Verdict mapping (§5.2 Sync verdicts, §6 Errors, ADR-019). Pure: an HTTP outcome (status +
// SaveWriteResult | ErrorEnvelope | network error) → SyncVerdict. Refusals are 200 + reason, so
// most branches read the disposition; 4xx/5xx are transport/auth/contract/precondition only.
// Only `synced` may ever be shown as "saved to cloud". A retried commandId replays `duplicate`
// for an anchored original and the ORIGINAL disposition (reason/flags) for a refused/quarantined
// one, so a lost response never turns a refusal into "saved".
import type { ErrorEnvelope, SaveWriteResult } from '@foundation/contracts';
import type { SyncVerdict } from '@foundation/contracts/enums';

export type HttpOutcome =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network'; error: string }
  | { kind: 'no_token' }
  | { kind: 'disabled' };

export interface VerdictContext {
  /** Local generation: a server generation below it means the server is behind (restore/DR). */
  localGeneration: number;
}

export interface MappedVerdict {
  verdict: SyncVerdict;
  /** Present for 200 responses with a well-formed SaveWriteResult. */
  result?: SaveWriteResult;
  /** Present for error responses with a well-formed envelope. */
  error?: ErrorEnvelope;
  /** Server's active generation when the response carried one (stale/behind handling). */
  serverGeneration?: number;
  /** Retry hint from 429/503 details when present (ms). */
  retryAfterMs?: number;
  /** Diagnostics: why a 200 fell through to rejected_transport, or the network error text. */
  detail?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function asWriteResult(body: unknown): SaveWriteResult | null {
  if (!isObject(body)) return null;
  const d = body.disposition;
  if (d !== 'anchored' && d !== 'stored_quarantined' && d !== 'stored_refused' && d !== 'duplicate')
    return null;
  if (typeof body.seq !== 'number' || typeof body.generation !== 'number') return null;
  return body as unknown as SaveWriteResult;
}

function asErrorEnvelope(body: unknown): ErrorEnvelope | null {
  if (!isObject(body) || typeof body.error !== 'string') return null;
  return body as unknown as ErrorEnvelope;
}

function retryAfter(err: ErrorEnvelope | null): number | undefined {
  const d = err?.details;
  if (isObject(d) && typeof d.retryAfterMs === 'number') return d.retryAfterMs;
  return undefined;
}

/** stale generation: the server may be AHEAD (normal: newer generation wins) or BEHIND (alarm). */
function staleOrBehind(serverGeneration: number | undefined, ctx: VerdictContext): SyncVerdict {
  if (serverGeneration !== undefined && serverGeneration < ctx.localGeneration)
    return 'server_behind';
  return 'refused_stale_generation';
}

export function mapVerdict(outcome: HttpOutcome, ctx: VerdictContext): MappedVerdict {
  switch (outcome.kind) {
    case 'disabled':
      return { verdict: 'disabled' };
    case 'no_token':
      return { verdict: 'no_token' };
    case 'network':
      return { verdict: 'unreachable', detail: outcome.error };
    case 'response':
      break;
  }
  const { status, body } = outcome;

  if (status >= 200 && status < 300) {
    const r = asWriteResult(body);
    if (!r) return { verdict: 'rejected_transport', detail: 'malformed 2xx body' };
    const base: MappedVerdict = {
      verdict: 'rejected_transport',
      result: r,
      serverGeneration: r.generation,
    };
    const refused = (): MappedVerdict => {
      switch (r.reason) {
        case 'progress_regression':
          return { ...base, verdict: 'refused_regression' };
        case 'stale_generation':
          return { ...base, verdict: staleOrBehind(r.generation, ctx) };
        case 'malformed':
        case 'blob_too_large':
          return { ...base, verdict: 'refused_malformed' };
        default:
          return {
            ...base,
            verdict: 'rejected_transport',
            detail: 'refused without a known reason',
          };
      }
    };
    switch (r.disposition) {
      case 'anchored':
        return { ...base, verdict: r.divergent ? 'synced_divergent' : 'synced' };
      case 'stored_quarantined':
        return { ...base, verdict: 'synced_quarantined' };
      case 'duplicate':
        // A retried commandId (audit F3): the server replays `duplicate` only for an ANCHORED
        // original; a refused/quarantined original replays its ORIGINAL disposition. Tolerant path
        // for a `duplicate` that still carries a refusal reason or quarantine flags: it is the
        // original verdict, never "saved to cloud".
        if (r.reason) return refused();
        if (r.flags && r.flags.length > 0) return { ...base, verdict: 'synced_quarantined' };
        return { ...base, verdict: 'duplicate' };
      case 'stored_refused':
        return refused();
      default:
        return { ...base, verdict: 'rejected_transport', detail: 'unknown disposition' };
    }
  }

  const err = asErrorEnvelope(body);
  const withErr = (verdict: SyncVerdict, extra: Partial<MappedVerdict> = {}): MappedVerdict => ({
    verdict,
    ...(err ? { error: err } : {}),
    ...extra,
  });
  const details = isObject(err?.details) ? err!.details : null;

  if (status === 401) return withErr('unauthorized');
  if (status === 403) {
    if (details && details.erased === true) return withErr('erased');
    return withErr('rejected_transport', { detail: 'forbidden' });
  }
  if (status === 409 && err?.error === 'stale_generation') {
    const g = details && typeof details.generation === 'number' ? details.generation : undefined;
    return withErr(staleOrBehind(g, ctx), g !== undefined ? { serverGeneration: g } : {});
  }
  if (status === 426) return withErr('update_required');
  if (status === 429) {
    const ra = retryAfter(err);
    return withErr('throttled', ra !== undefined ? { retryAfterMs: ra } : {});
  }
  if (status === 503) {
    const ra = retryAfter(err);
    return withErr('rejected_transport', {
      detail: err?.error ?? 'service unavailable',
      ...(ra !== undefined ? { retryAfterMs: ra } : {}),
    });
  }
  return withErr('rejected_transport', { detail: `http ${status}` });
}

/** Verdicts after which the pending snapshot is considered delivered (its commandId is retired). */
export const ACKED_VERDICTS: ReadonlySet<SyncVerdict> = new Set<SyncVerdict>([
  'synced',
  'synced_quarantined',
  'synced_divergent',
  'duplicate',
]);

/** Verdicts that mean "retrying the same snapshot cannot help" (pending is dropped, state kept). */
export const TERMINAL_VERDICTS: ReadonlySet<SyncVerdict> = new Set<SyncVerdict>([
  'refused_regression',
  'refused_malformed',
  'refused_stale_generation',
  'erased',
]);

/** Verdicts that keep the pending snapshot for a later retry (same commandId). */
export const RETRYABLE_VERDICTS: ReadonlySet<SyncVerdict> = new Set<SyncVerdict>([
  'unauthorized',
  'throttled',
  'rejected_transport',
  'unreachable',
  'no_token',
]);

/** Verdicts that halt pushing until a human/operator acts. */
export const HALTING_VERDICTS: ReadonlySet<SyncVerdict> = new Set<SyncVerdict>([
  'server_behind',
  'update_required',
  'erased',
]);
