import { describe, expect, it } from 'vitest';
import type { SaveWriteResult } from '@foundation/contracts';
import { SYNC_VERDICTS } from '@foundation/contracts/enums';
import {
  ACKED_VERDICTS,
  HALTING_VERDICTS,
  mapVerdict,
  RETRYABLE_VERDICTS,
  TERMINAL_VERDICTS,
} from '../../src/sync/verdicts.ts';

const ok = (over: Partial<SaveWriteResult>): SaveWriteResult => ({
  disposition: 'anchored',
  seq: 5,
  currentProgress: 10,
  generation: 1,
  blobSha256: 'a'.repeat(64),
  requestId: 'r',
  serverNow: 1,
  ...over,
});
const ctx = { localGeneration: 1 };
const res = (status: number, body: unknown) => mapVerdict({ kind: 'response', status, body }, ctx);

describe('mapVerdict (§5.2) — every branch', () => {
  it('200 anchored → synced', () => expect(res(200, ok({})).verdict).toBe('synced'));
  it('200 anchored + divergent → synced_divergent', () =>
    expect(res(200, ok({ divergent: { headSeq: 4, headWriterAt: 0 } })).verdict).toBe(
      'synced_divergent',
    ));
  it('200 stored_quarantined → synced_quarantined (never "saved to cloud")', () =>
    expect(
      res(200, ok({ disposition: 'stored_quarantined', flags: ['schema_unknown'] })).verdict,
    ).toBe('synced_quarantined'));
  it('200 duplicate → duplicate', () =>
    expect(res(200, ok({ disposition: 'duplicate' })).verdict).toBe('duplicate'));
  it('200 stored_refused progress_regression → refused_regression', () =>
    expect(
      res(200, ok({ disposition: 'stored_refused', reason: 'progress_regression' })).verdict,
    ).toBe('refused_regression'));
  it('200 stored_refused stale_generation with server generation ahead → refused_stale_generation', () => {
    const m = res(
      200,
      ok({ disposition: 'stored_refused', reason: 'stale_generation', generation: 2 }),
    );
    expect(m.verdict).toBe('refused_stale_generation');
    expect(m.serverGeneration).toBe(2);
  });
  it('200 stored_refused stale_generation with server generation BEHIND local → server_behind', () =>
    expect(
      res(200, ok({ disposition: 'stored_refused', reason: 'stale_generation', generation: 0 }))
        .verdict,
    ).toBe('server_behind'));
  it('200 stored_refused malformed → refused_malformed', () =>
    expect(res(200, ok({ disposition: 'stored_refused', reason: 'malformed' })).verdict).toBe(
      'refused_malformed',
    ));
  it('200 stored_refused blob_too_large → refused_malformed', () =>
    expect(res(200, ok({ disposition: 'stored_refused', reason: 'blob_too_large' })).verdict).toBe(
      'refused_malformed',
    ));
  it('200 stored_refused without a known reason → rejected_transport', () =>
    expect(res(200, ok({ disposition: 'stored_refused' })).verdict).toBe('rejected_transport'));
  it('200 with a malformed body → rejected_transport', () => {
    expect(res(200, null).verdict).toBe('rejected_transport');
    expect(res(200, { disposition: 'weird', seq: 1, generation: 1 }).verdict).toBe(
      'rejected_transport',
    );
    expect(res(200, { disposition: 'anchored' }).verdict).toBe('rejected_transport');
  });
  it('401 → unauthorized', () =>
    expect(res(401, { error: 'unauthorized', correlationId: 'c' }).verdict).toBe('unauthorized'));
  it('403 details.erased → erased', () =>
    expect(
      res(403, { error: 'forbidden', correlationId: 'c', details: { erased: true } }).verdict,
    ).toBe('erased'));
  it('403 without erased → rejected_transport', () =>
    expect(res(403, { error: 'forbidden', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    ));
  it('409 stale_generation ahead → refused_stale_generation with serverGeneration', () => {
    const m = res(409, {
      error: 'stale_generation',
      correlationId: 'c',
      details: { generation: 3 },
    });
    expect(m.verdict).toBe('refused_stale_generation');
    expect(m.serverGeneration).toBe(3);
  });
  it('409 stale_generation behind → server_behind', () =>
    expect(
      res(409, { error: 'stale_generation', correlationId: 'c', details: { generation: 0 } })
        .verdict,
    ).toBe('server_behind'));
  it('409 stale_generation without details → refused_stale_generation', () =>
    expect(res(409, { error: 'stale_generation', correlationId: 'c' }).verdict).toBe(
      'refused_stale_generation',
    ));
  it('409 other (review_final) → rejected_transport', () =>
    expect(res(409, { error: 'review_final', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    ));
  it('426 → update_required', () =>
    expect(res(426, { error: 'build_too_old', correlationId: 'c' }).verdict).toBe(
      'update_required',
    ));
  it('429 → throttled with retryAfterMs', () => {
    const m = res(429, {
      error: 'rate_limited',
      correlationId: 'c',
      details: { retryAfterMs: 1234 },
    });
    expect(m.verdict).toBe('throttled');
    expect(m.retryAfterMs).toBe(1234);
  });
  it('503 retry_later / not_configured → rejected_transport (+ retryAfterMs)', () => {
    const a = res(503, {
      error: 'retry_later',
      correlationId: 'c',
      details: { retryAfterMs: 500 },
    });
    expect(a.verdict).toBe('rejected_transport');
    expect(a.retryAfterMs).toBe(500);
    expect(res(503, { error: 'not_configured', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    );
  });
  it('other 4xx/5xx → rejected_transport', () => {
    expect(res(400, { error: 'bad_request', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    );
    expect(res(413, { error: 'payload_too_large', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    );
    expect(res(422, { error: 'idempotency_mismatch', correlationId: 'c' }).verdict).toBe(
      'rejected_transport',
    );
    expect(res(500, { error: 'internal', correlationId: 'c' }).verdict).toBe('rejected_transport');
    expect(res(502, null).verdict).toBe('rejected_transport');
  });
  it('network error → unreachable', () =>
    expect(mapVerdict({ kind: 'network', error: 'offline' }, ctx).verdict).toBe('unreachable'));
  it('no token → no_token', () =>
    expect(mapVerdict({ kind: 'no_token' }, ctx).verdict).toBe('no_token'));
  it('sync disabled → disabled', () =>
    expect(mapVerdict({ kind: 'disabled' }, ctx).verdict).toBe('disabled'));

  it('every verdict in the contract enum is produced by some branch and classified exactly once', () => {
    const produced = new Set([
      res(200, ok({})).verdict,
      res(200, ok({ divergent: { headSeq: 1, headWriterAt: 0 } })).verdict,
      res(200, ok({ disposition: 'stored_quarantined' })).verdict,
      res(200, ok({ disposition: 'duplicate' })).verdict,
      res(200, ok({ disposition: 'stored_refused', reason: 'progress_regression' })).verdict,
      res(200, ok({ disposition: 'stored_refused', reason: 'stale_generation', generation: 2 }))
        .verdict,
      res(200, ok({ disposition: 'stored_refused', reason: 'stale_generation', generation: 0 }))
        .verdict,
      res(200, ok({ disposition: 'stored_refused', reason: 'malformed' })).verdict,
      res(401, {}).verdict,
      res(426, {}).verdict,
      res(429, {}).verdict,
      res(500, {}).verdict,
      res(403, { error: 'forbidden', correlationId: 'c', details: { erased: true } }).verdict,
      mapVerdict({ kind: 'network', error: 'x' }, ctx).verdict,
      mapVerdict({ kind: 'no_token' }, ctx).verdict,
      mapVerdict({ kind: 'disabled' }, ctx).verdict,
    ]);
    for (const v of SYNC_VERDICTS) expect(produced.has(v), v).toBe(true);
    for (const v of SYNC_VERDICTS) {
      const n = [ACKED_VERDICTS, TERMINAL_VERDICTS, RETRYABLE_VERDICTS].filter((s) =>
        s.has(v),
      ).length;
      // halting verdicts (server_behind/update_required) and disabled are outside the three retry classes
      expect(n <= 1, v).toBe(true);
    }
    expect(HALTING_VERDICTS.has('server_behind')).toBe(true);
  });
});
