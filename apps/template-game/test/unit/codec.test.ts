// Save corpus + codec fuzz (§9 "Save corpus: each release contributes ≥ 5 sanitised saves; CI
// loads all through HEAD, round-trips, asserts progressOf monotone; codec fuzz").
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseState, templateCodec } from '../../src/codec.ts';
import { SCHEMA_VERSION, templateEngine, type TemplateState } from '../../src/engine.ts';

interface CorpusEntry {
  name: string;
  note: string;
  schemaVersion: number;
  blob: string;
  expectedProgress: number;
}

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus');
const corpus: CorpusEntry[] = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(corpusDir, f), 'utf8')) as CorpusEntry);

describe('save corpus through HEAD', () => {
  it('has at least 5 sanitised samples covering every schema version the server knows', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(5);
    const versions = new Set(corpus.map((c) => c.schemaVersion));
    expect(versions.has(1)).toBe(true);
    expect(versions.has(SCHEMA_VERSION)).toBe(true);
    for (const c of corpus) expect(c.blob).not.toMatch(/playerName":"(?!Clicky)/); // sanitised
  });
  it.each(corpus.map((c) => [c.name, c] as const))(
    '%s: decodes, progressOf matches, round-trips stably',
    (_name, c) => {
      const t = templateCodec.trialDeserialize(c.blob);
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      expect(t.migrated).toBe(c.schemaVersion !== SCHEMA_VERSION);
      expect(t.state.v).toBe(SCHEMA_VERSION);
      expect(templateEngine.progressOf(t.state)).toBe(c.expectedProgress);
      // round trip: encode → decode → encode is a fixed point at HEAD
      const once = templateCodec.encode(t.state);
      const again = templateCodec.decode(once);
      expect(again).toEqual(t.state);
      expect(templateCodec.encode(again)).toBe(once);
      expect(JSON.parse(once)).toMatchObject({ schemaVersion: SCHEMA_VERSION });
      // the engine keeps working on a corpus state
      const next = templateEngine.apply(
        again,
        { type: 'click' },
        {
          now: 1_800_000_000_000,
          rng: { next: () => 0.5, int: () => 0, state: () => 0, restore: () => {} },
          tick: 0,
          catchUp: false,
        },
      ).state;
      expect(templateEngine.progressOf(next)).toBe(c.expectedProgress + 1);
    },
  );
  it('progressOf is monotone across the corpus in file order (a release only ever deepens)', () => {
    const ps = corpus.map((c) => {
      const t = templateCodec.trialDeserialize(c.blob);
      return t.ok ? templateEngine.progressOf(t.state) : -1;
    });
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]!);
  });
});

const stateArb: fc.Arbitrary<TemplateState> = fc
  .record({
    counter: fc.integer({ min: 0, max: 2 ** 40 }),
    gold: fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
    gems: fc.integer({ min: 0, max: 1e6 }),
    clicks: fc.integer({ min: 0, max: 2 ** 40 }),
    auto: fc.integer({ min: 0, max: 100 }),
    click: fc.integer({ min: 0, max: 100 }),
    cosmetics: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 6 }),
    settledAt: fc.integer({ min: 0, max: 2 ** 45 }),
    playerName: fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
  })
  .map((r) => {
    const s: TemplateState = {
      v: SCHEMA_VERSION,
      counter: r.counter,
      gold: r.gold,
      gems: r.gems,
      clicks: r.clicks,
      upgrades: { auto: r.auto, click: r.click },
      cosmetics: r.cosmetics,
      settledAt: r.settledAt,
    };
    if (r.playerName !== undefined) s.playerName = r.playerName;
    return s;
  });

describe('codec fuzz', () => {
  it('encode → decode is the identity for every well-formed state', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const back = templateCodec.decode(templateCodec.encode(s));
        expect(back).toEqual(s);
        expect(templateEngine.progressOf(back)).toBe(s.counter);
      }),
      { numRuns: 300 },
    );
  });
  it('trialDeserialize never throws on arbitrary strings and never accepts garbage', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const t = templateCodec.trialDeserialize(raw);
        if (t.ok) {
          expect(Number.isSafeInteger(t.state.counter)).toBe(true);
          expect(t.state.counter).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const t = templateCodec.trialDeserialize(JSON.stringify(v));
        if (t.ok) {
          expect(t.state.v).toBe(SCHEMA_VERSION);
          expect(templateEngine.progressOf(t.state)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });
  it('normaliseState refuses non-objects and negative/missing counter or gold', () => {
    for (const bad of [
      null,
      1,
      'x',
      [],
      {},
      { counter: -1, gold: 0 },
      { counter: 1 },
      { counter: 1, gold: -2 },
      { counter: Infinity, gold: 0 },
    ])
      expect(() => normaliseState(bad)).toThrow();
    const s = normaliseState({
      counter: 3.7,
      gold: 2,
      upgrades: { auto: 'x' },
      cosmetics: [1, 'a'],
    });
    expect(s).toEqual({
      v: SCHEMA_VERSION,
      counter: 3,
      gold: 2,
      gems: 0,
      clicks: 0,
      upgrades: { auto: 0, click: 0 },
      cosmetics: ['a'],
      settledAt: 0,
    });
  });
});
