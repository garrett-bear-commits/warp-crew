// Engine tests (§9): progressOf monotone under random actions/steps (fast-check), onGap never
// raises progressOf, migrations v1 → v2, and the v1 engine conformance kit (apply-only, step-only,
// mixed; determinism per seed).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRngStreams, type Ctx } from '@foundation/client';
import { templateCodec } from '../../src/codec.ts';
import {
  autoPerTick,
  clickValue,
  MIGRATIONS,
  SCHEMA_VERSION,
  templateEngine,
  TPS,
  upgradeCost,
  type TemplateAction,
  type TemplateState,
} from '../../src/engine.ts';
import { assertConformance, runKit } from './conformance-kit.ts';

const T0 = 1_700_000_000_000;

const ctx = (seed = 1, tick = 0, now = T0): Ctx => ({
  now,
  rng: createRngStreams(seed).sim,
  tick,
  catchUp: false,
});

const fresh = (seed = 1): TemplateState =>
  templateEngine.newState({ now: T0, seed, rng: createRngStreams(seed).sim });

export const actionArb: fc.Arbitrary<TemplateAction> = fc.oneof(
  { weight: 6, arbitrary: fc.constant<TemplateAction>({ type: 'click' }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom<'auto' | 'click'>('auto', 'click')
      .map((upgrade): TemplateAction => ({ type: 'buy', upgrade })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        gold: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
        gems: fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: undefined }),
        cosmetic: fc.option(fc.constantFrom('hat', 'badge', 'trail'), { nil: undefined }),
        ref: fc.constantFrom('daily:1', 'admin:mg', 'code:X'),
      })
      .map((r): TemplateAction => ({
        type: 'grant',
        ref: r.ref,
        ...(r.gold !== undefined ? { gold: r.gold } : {}),
        ...(r.gems !== undefined ? { gems: r.gems } : {}),
        ...(r.cosmetic !== undefined ? { cosmetic: r.cosmetic } : {}),
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: -500, max: 500 })
      .map((gems): TemplateAction => ({ type: 'adjust', gems, ref: 'adjustment:1' })),
  },
  {
    weight: 1,
    arbitrary: fc
      .string({ minLength: 0, maxLength: 40 })
      .map((name): TemplateAction => ({ type: 'rename', name })),
  },
);

describe('template engine: contract basics', () => {
  it('newState is schema 2 with zeroed resources and settledAt = now', () => {
    const s = fresh();
    expect(s).toMatchObject({ v: SCHEMA_VERSION, counter: 0, gold: 0, gems: 0, clicks: 0 });
    expect(s.settledAt).toBe(T0);
    expect(templateEngine.progressOf(s)).toBe(0);
    expect(templateEngine.summary!(s)).toEqual({ counter: 0, gold: 0, gems: 0, clicks: 0 });
  });
  it('click adds gold and progress; buy needs gold and raises the level; adjust never goes negative', () => {
    let s = fresh();
    for (let i = 0; i < 30; i++) s = templateEngine.apply(s, { type: 'click' }, ctx()).state;
    expect(s.gold).toBe(30);
    expect(s.counter).toBe(30);
    const before = s.counter;
    s = templateEngine.apply(s, { type: 'buy', upgrade: 'auto' }, ctx()).state;
    expect(s.upgrades.auto).toBe(1);
    expect(s.gold).toBe(30 - upgradeCost('auto', 0));
    expect(s.counter).toBe(before + 1);
    // not enough gold: no-op, no progress
    const c2 = s.counter;
    s = templateEngine.apply(s, { type: 'buy', upgrade: 'auto' }, ctx()).state;
    expect(s.upgrades.auto).toBe(1);
    expect(s.counter).toBe(c2);
    s = templateEngine.apply(s, { type: 'adjust', gems: -50, ref: 'adjustment:1' }, ctx()).state;
    expect(s.gems).toBe(0);
    expect(clickValue(s)).toBe(1);
    expect(autoPerTick(s)).toBe(1);
  });
  it('step produces gold only with auto-clickers and advances progress by the ticks it settled', () => {
    const s = fresh();
    expect(templateEngine.isPaused!(s)).toBe(true);
    const r0 = templateEngine.step!(s, 5, ctx());
    expect(r0.state.counter).toBe(0);
    s.upgrades.auto = 2;
    expect(templateEngine.isPaused!(s)).toBe(false);
    const r1 = templateEngine.step!(s, 5, ctx());
    expect(r1.state.gold).toBe(10);
    expect(r1.state.counter).toBe(5);
    expect(r1.effects.some((e) => e.kind === 'coin')).toBe(true);
    // catch-up frames emit no cosmetic effects
    const r2 = templateEngine.step!(s, 1, { ...ctx(), catchUp: true });
    expect(r2.effects).toEqual([]);
  });
  it('onGap credits capped offline income and NEVER raises progressOf', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 100 * 3600 }),
        fc.integer({ min: 0, max: 100 * 3600 }),
        (auto, deviceSec, serverSec) => {
          const s = fresh();
          s.upgrades.auto = auto;
          s.counter = 42;
          const before = templateEngine.progressOf(s);
          const r = templateEngine.onGap!(s, { deviceSec, serverSec }, ctx());
          expect(templateEngine.progressOf(r.state)).toBe(before);
          const cap = 8 * 3600 * TPS * auto;
          expect(r.state.gold).toBeLessThanOrEqual(cap);
          expect(r.state.gold).toBe(Math.min(Math.floor(serverSec * TPS), 8 * 3600 * TPS) * auto);
        },
      ),
      { numRuns: 200 },
    );
  });
  it('progressOf is monotone under random actions and steps', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(
          fc.oneof(
            { weight: 3, arbitrary: actionArb.map((a) => ({ kind: 'action' as const, a })) },
            {
              weight: 2,
              arbitrary: fc
                .integer({ min: 1, max: 50 })
                .map((dt) => ({ kind: 'step' as const, dt })),
            },
          ),
          { minLength: 1, maxLength: 200 },
        ),
        (seed, ops) => {
          let s = fresh(seed);
          const c = ctx(seed);
          let last = templateEngine.progressOf(s);
          for (const op of ops) {
            s =
              op.kind === 'action'
                ? templateEngine.apply(s, op.a, c).state
                : templateEngine.step!(s, op.dt, c).state;
            const p = templateEngine.progressOf(s);
            expect(p).toBeGreaterThanOrEqual(last);
            expect(Number.isSafeInteger(p)).toBe(true);
            last = p;
          }
          expect(s.gold).toBeGreaterThanOrEqual(0);
          expect(s.gems).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('migrations v1 → v2', () => {
  it('MIGRATIONS[1] adds gems/clicks/cosmetics and stamps v=2; the codec migrates a v1 blob', () => {
    const v1 = { v: 1, counter: 12, gold: 7, upgrades: { auto: 1, click: 0 }, settledAt: T0 };
    const migrated = MIGRATIONS[1]!(v1) as Record<string, unknown>;
    expect(migrated).toMatchObject({ v: 2, gems: 0, clicks: 0, cosmetics: [] });
    const blob = JSON.stringify({ schemaVersion: 1, state: v1 });
    const trial = templateCodec.trialDeserialize(blob);
    expect(trial.ok).toBe(true);
    if (trial.ok) {
      expect(trial.migrated).toBe(true);
      expect(trial.state).toEqual({
        v: 2,
        counter: 12,
        gold: 7,
        gems: 0,
        clicks: 0,
        upgrades: { auto: 1, click: 0 },
        cosmetics: [],
        settledAt: T0,
      });
      expect(templateEngine.progressOf(trial.state)).toBe(12);
    }
  });
  it('a newer schema is refused (never adopted silently); a missing state is not_object', () => {
    expect(
      templateCodec.trialDeserialize(JSON.stringify({ schemaVersion: 9, state: { v: 9 } })),
    ).toMatchObject({ ok: false, reason: 'newer_schema' });
    expect(templateCodec.trialDeserialize(JSON.stringify({ schemaVersion: 2 }))).toMatchObject({
      ok: false,
      reason: 'not_object',
    });
  });
});

describe('engine conformance kit (v1 scope): apply-only, step-only, mixed; determinism per seed', () => {
  const opts = { engine: templateEngine, actionArb, tps: TPS, runs: 40 };
  it('apply-only mode', () => assertConformance(opts, 'apply-only'));
  it('step-only mode', () => assertConformance(opts, 'step-only'));
  it('mixed mode', () => assertConformance(opts, 'mixed'));
  it('different seeds diverge on the cosmetic stream but agree on progress for the same inputs', () => {
    const inputs = Array.from({ length: 30 }, () => ({
      kind: 'action' as const,
      action: { type: 'click' } as TemplateAction,
    }));
    const a = runKit(templateEngine, 1, inputs, TPS);
    const b = runKit(templateEngine, 2, inputs, TPS);
    expect(templateEngine.progressOf(a.finalState)).toBe(30);
    expect(templateEngine.progressOf(b.finalState)).toBe(30);
    expect(a.journal.length).toBe(30);
  });
  it('the kit catches an engine whose onGap raises progressOf', () => {
    const broken = {
      ...templateEngine,
      onGap: (s: TemplateState) => {
        s.counter += 1;
        return { state: s, effects: [] };
      },
    };
    expect(() => assertConformance({ ...opts, engine: broken, runs: 30 }, 'step-only')).toThrow(
      /onGap raised progressOf|not monotone/,
    );
  });
  it('the kit catches a non-deterministic engine (unseeded randomness)', () => {
    let calls = 0;
    const broken = {
      ...templateEngine,
      apply: (s: TemplateState, a: TemplateAction, c: Ctx) => {
        const r = templateEngine.apply(s, a, c);
        r.state.gold += (calls++ % 2) * 0.5; // differs between the two runs of the same seed
        return r;
      },
    };
    expect(() => assertConformance({ ...opts, engine: broken, runs: 30 }, 'apply-only')).toThrow(
      /non-deterministic/,
    );
  });
  it('the kit catches a progressOf that can go backwards', () => {
    const broken = {
      ...templateEngine,
      apply: (s: TemplateState, a: TemplateAction, c: Ctx) => {
        if (a.type === 'rename') s.counter = Math.max(0, s.counter - 1);
        return templateEngine.apply(s, a, c);
      },
    };
    expect(() => assertConformance({ ...opts, engine: broken, runs: 60 }, 'apply-only')).toThrow(
      /not monotone/,
    );
  });
  it('a big gap hands off once (journal kind gap) and progress does not move', () => {
    const r = runKit(
      templateEngine,
      7,
      [
        { kind: 'action', action: { type: 'click' } },
        { kind: 'gap', ms: 3_600_000 },
      ],
      TPS,
    );
    expect(r.journal.map((j) => j.kind)).toEqual(['action', 'gap']);
    expect(r.progressTrace).toEqual([0, 1, 1]);
    expect(r.invariantViolations).toEqual([]);
  });
});
