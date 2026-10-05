import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  place,
  selectAnchor,
  type SaveWrite,
  type StoredHead,
} from '../../src/features/saves/placement.ts';

const NOW = 1_786_924_800_000;
const SESSION = '2f5b7f6a-3c9d-4e1f-8a2b-0c1d2e3f4a5b';
const OTHER = '9b2d5c1e-8f0a-4c7b-a1d2-3e4f5a6b7c8d';
const opts = {
  activeGeneration: 0,
  now: NOW,
  knownSchemaVersions: [1, 2],
  maxProgressPerHour: 1000,
};

const write = (o: Partial<SaveWrite> = {}): SaveWrite => ({
  generation: 0,
  progress: 100,
  clientSeq: 5,
  baseSeq: 4,
  sessionId: SESSION,
  savedAt: NOW - 1000,
  schemaVersion: 1,
  blobValid: true,
  bytes: 100,
  ...o,
});
const head = (o: Partial<StoredHead> = {}): StoredHead => ({
  seq: 4,
  progress: 50,
  sessionId: SESSION,
  savedAt: NOW - 3_600_000,
  receivedAt: NOW - 3_600_000,
  schemaVersion: 1,
  ...o,
});

describe('placement guard — named invariants', () => {
  it('INSERT-only hot path: refusals are stored with a reason and still take a seq', () => {
    const p = place(write({ progress: 10 }), head(), { seq: 9 }, opts);
    expect(p).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
      seq: 10,
    });
  });
  it('a save may only get deeper; equal depth is allowed', () => {
    expect(place(write({ progress: 50 }), head(), { seq: 4 }, opts).disposition).toBe('anchored');
    expect(place(write({ progress: 51 }), head(), { seq: 4 }, opts).disposition).toBe('anchored');
    expect(place(write({ progress: 49 }), head(), { seq: 4 }, opts)).toMatchObject({
      disposition: 'stored_refused',
      reason: 'progress_regression',
    });
  });
  it('the server assigns seq from the last ROW (refusals advance too), never from the client counter', () => {
    expect(place(write({ clientSeq: 999 }), null, { seq: 7 }, opts).seq).toBe(8);
    expect(place(write({ clientSeq: 1 }), null, null, opts).seq).toBe(1);
  });
  it('generations are the only way backwards: another generation → stale_generation refusal', () => {
    expect(place(write({ generation: 1 }), head(), null, opts)).toMatchObject({
      disposition: 'stored_refused',
      reason: 'stale_generation',
    });
    expect(
      place(write({ generation: 0 }), null, null, { ...opts, activeGeneration: 2 }),
    ).toMatchObject({ reason: 'stale_generation' });
  });
  it('malformed blob or ordinal → stored_refused malformed', () => {
    expect(place(write({ blobValid: false }), null, null, opts).reason).toBe('malformed');
    expect(place(write({ progress: -1 }), null, null, opts).reason).toBe('malformed');
    expect(place(write({ progress: 2 ** 53 }), null, null, opts).reason).toBe('malformed');
    expect(place(write({ bytes: 0 }), null, null, opts).reason).toBe('malformed');
  });
  it('flags quarantine (never the anchor): schema_unknown, schema_downgrade, progress_jump, implausible_summary', () => {
    expect(place(write({ schemaVersion: 3 }), null, null, opts)).toMatchObject({
      disposition: 'stored_quarantined',
      flags: ['schema_unknown'],
    });
    expect(
      place(write({ schemaVersion: 1 }), head({ schemaVersion: 2 }), null, opts),
    ).toMatchObject({ disposition: 'stored_quarantined', flags: ['schema_downgrade'] });
    expect(
      place(write({ progress: 50 + 1000 * 2 }), head({ receivedAt: NOW - 3_600_000 }), null, opts),
    ).toMatchObject({ disposition: 'stored_quarantined', flags: ['progress_jump'] });
    expect(
      place(write({ progress: 50 + 900 }), head({ receivedAt: NOW - 3_600_000 }), null, opts)
        .disposition,
    ).toBe('anchored');
    expect(place(write({ summaryPlausible: false }), head(), null, opts)).toMatchObject({
      disposition: 'stored_quarantined',
      flags: ['implausible_summary'],
    });
  });
  it('progress_jump uses a 1-minute floor for elapsed time so a burst right after the head is judged fairly', () => {
    // 1000/hour ⇒ 16.67 per minute floor
    expect(
      place(write({ progress: 50 + 16 }), head({ receivedAt: NOW - 1000 }), null, opts).disposition,
    ).toBe('anchored');
    expect(
      place(write({ progress: 50 + 17 }), head({ receivedAt: NOW - 1000 }), null, opts).flags,
    ).toContain('progress_jump');
  });
  it('clock_skew flags but does not quarantine', () => {
    const p = place(write({ savedAt: NOW - 3 * 86_400_000 }), head(), null, opts);
    expect(p.disposition).toBe('anchored');
    expect(p.flags).toEqual(['clock_skew']);
  });
  it('divergence (baseSeq behind head or a different session) is surfaced, never refused on its own', () => {
    const p = place(
      write({ baseSeq: 2, progress: 60 }),
      head({ seq: 4, summary: { gold: 1 } }),
      { seq: 4 },
      opts,
    );
    expect(p.disposition).toBe('anchored');
    expect(p.divergent).toEqual({
      headSeq: 4,
      headWriterAt: NOW - 3_600_000,
      headSessionId: SESSION,
      headSummary: { gold: 1 },
    });
    const q = place(
      write({ sessionId: OTHER, baseSeq: 4, progress: 60 }),
      head(),
      { seq: 4 },
      opts,
    );
    expect(q.divergent?.headSessionId).toBe(SESSION);
    const r = place(
      write({ sessionId: OTHER, baseSeq: 4, progress: 10 }),
      head(),
      { seq: 4 },
      opts,
    );
    expect(r).toMatchObject({ disposition: 'stored_refused', reason: 'progress_regression' });
    expect(r.divergent).toBeDefined();
  });
  it('a pruned tombstone can never block writes: the head is whatever anchored row still has a blob', () => {
    // no head (all blobs pruned) ⇒ any progress anchors
    expect(place(write({ progress: 1 }), null, { seq: 40 }, opts)).toMatchObject({
      disposition: 'anchored',
      seq: 41,
    });
  });
  it('quarantined + promoted counts as anchor; plain quarantined never does', () => {
    const rows = [
      { generation: 0, progress: 10, seq: 1, disposition: 'anchored' as const, hasBlob: true },
      {
        generation: 0,
        progress: 99,
        seq: 2,
        disposition: 'stored_quarantined' as const,
        hasBlob: true,
      },
      {
        generation: 0,
        progress: 50,
        seq: 3,
        disposition: 'stored_quarantined' as const,
        promoted: true,
        hasBlob: true,
      },
      { generation: 1, progress: 500, seq: 4, disposition: 'anchored' as const, hasBlob: true },
    ];
    expect(selectAnchor(rows, 0)?.seq).toBe(3);
    expect(selectAnchor(rows, 1)?.seq).toBe(4);
    expect(selectAnchor(rows, 2)).toBeNull();
  });
});

describe('placement guard — properties', () => {
  const arbWrite = fc.record({
    generation: fc.integer({ min: 0, max: 3 }),
    progress: fc.oneof(fc.integer({ min: 0, max: 10_000 }), fc.constant(-1), fc.constant(2 ** 53)),
    clientSeq: fc.nat(1000),
    baseSeq: fc.nat(1000),
    sessionId: fc.constantFrom(SESSION, OTHER),
    savedAt: fc.integer({ min: NOW - 5 * 86_400_000, max: NOW + 5 * 86_400_000 }),
    schemaVersion: fc.integer({ min: 0, max: 4 }),
    blobValid: fc.boolean(),
    bytes: fc.integer({ min: 0, max: 1000 }),
    summaryPlausible: fc.option(fc.boolean(), { nil: undefined }),
  });
  const arbHead = fc.option(
    fc.record({
      seq: fc.integer({ min: 1, max: 1000 }),
      progress: fc.integer({ min: 0, max: 10_000 }),
      sessionId: fc.constantFrom(SESSION, OTHER),
      savedAt: fc.integer({ min: NOW - 86_400_000, max: NOW }),
      receivedAt: fc.integer({ min: NOW - 86_400_000, max: NOW }),
      schemaVersion: fc.integer({ min: 1, max: 3 }),
    }),
    { nil: null },
  );
  const arbLast = fc.option(fc.record({ seq: fc.integer({ min: 0, max: 5000 }) }), { nil: null });
  const arbOpts = fc.record({
    activeGeneration: fc.integer({ min: 0, max: 3 }),
    now: fc.constant(NOW),
    knownSchemaVersions: fc.constant([1, 2, 3]),
    maxProgressPerHour: fc.integer({ min: 0, max: 5000 }),
  });

  it('always stores: disposition is anchored | stored_quarantined | stored_refused and seq = last+1', () => {
    fc.assert(
      fc.property(arbWrite, arbHead, arbLast, arbOpts, (w, h, l, o) => {
        const p = place(w as never, h, l, o);
        expect(['anchored', 'stored_quarantined', 'stored_refused']).toContain(p.disposition);
        expect(p.seq).toBe((l?.seq ?? 0) + 1);
        if (p.disposition === 'stored_refused') expect(p.reason).toBeDefined();
        else expect(p.reason).toBeUndefined();
      }),
      { numRuns: 2000 },
    );
  });

  it('monotone anchor: an anchored write is never shallower than the head (deepest-wins is preserved)', () => {
    fc.assert(
      fc.property(arbWrite, arbHead, arbLast, arbOpts, (w, h, l, o) => {
        const p = place(w as never, h, l, o);
        if (p.disposition === 'anchored' && h)
          expect(w.progress).toBeGreaterThanOrEqual(h.progress);
        if (p.disposition === 'anchored') expect(w.generation).toBe(o.activeGeneration);
      }),
      { numRuns: 2000 },
    );
  });

  it('quarantine implies a quarantining flag; anchored never carries one', () => {
    const Q = ['schema_unknown', 'schema_downgrade', 'progress_jump', 'implausible_summary'];
    fc.assert(
      fc.property(arbWrite, arbHead, arbLast, arbOpts, (w, h, l, o) => {
        const p = place(w as never, h, l, o);
        if (p.disposition === 'stored_quarantined')
          expect(p.flags.some((f) => Q.includes(f))).toBe(true);
        if (p.disposition === 'anchored') expect(p.flags.some((f) => Q.includes(f))).toBe(false);
      }),
      { numRuns: 2000 },
    );
  });

  it('is deterministic (pure)', () => {
    fc.assert(
      fc.property(arbWrite, arbHead, arbLast, arbOpts, (w, h, l, o) => {
        expect(place(w as never, h, l, o)).toEqual(place(w as never, h, l, o));
      }),
      { numRuns: 500 },
    );
  });
});
