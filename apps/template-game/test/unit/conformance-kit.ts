// Engine conformance kit, v1 scope (§9 "Engine conformance kit (step and apply-only modes, action
// fuzz, golden stream …)"): drives ANY Engine<S,A,E> through the adapter's real loop with a manual
// scheduler and a fake clock, in three modes — apply-only (turn-based), step-only (sim), mixed —
// and checks the contract: progressOf monotone under every input, onGap never raises progressOf,
// same seed + same inputs → identical state and identical journal (determinism), summary is a
// record of finite numbers, settle keeps progress. Games reuse this with their own engine + arbitrary.
import fc from 'fast-check';
import {
  createEffectRing,
  createLoop,
  createRngStreams,
  manualScheduler,
  type Effect,
  type Engine,
  type JournalInput,
} from '@foundation/client';

export interface KitOptions<S, A> {
  engine: Engine<S, A, Effect>;
  actionArb: fc.Arbitrary<A>;
  tps: number;
  /** Deep-equality projection used for determinism (default JSON). */
  fingerprint?: (s: S) => string;
  runs?: number;
}

export type KitInput<A> =
  | { kind: 'action'; action: A }
  | { kind: 'advance'; ms: number }
  | { kind: 'gap'; ms: number }
  | { kind: 'settle' };

export interface KitRun<S> {
  finalState: S;
  progressTrace: number[];
  journal: JournalInput[];
  invariantViolations: string[];
}

/** Run one input sequence through the loop deterministically. */
export function runKit<S, A>(
  engine: Engine<S, A, Effect>,
  seed: number,
  inputs: readonly KitInput<A>[],
  tps: number,
  bigGapMs = 30_000,
): KitRun<S> {
  let now = 1_700_000_000_000;
  const clock = { now: () => now, deviceNow: () => now };
  const streams = createRngStreams(seed);
  const rng = streams.sim;
  const scheduler = manualScheduler();
  const effects = createEffectRing<Effect>(64);
  const journal: JournalInput[] = [];
  const invariantViolations: string[] = [];
  const initial = engine.newState({ now, seed, rng });
  const loop = createLoop<S, A, Effect>({
    engine,
    initialState: initial,
    clock,
    rng,
    effects,
    options: { tps, scheduler, bigGapMs },
    describeAction: (a) => ({
      name: String((a as { type?: unknown } | null)?.type ?? 'action'),
    }),
    onJournal: (e) => journal.push(e),
    onInvariant: (m) => invariantViolations.push(m),
  });
  const progressTrace: number[] = [engine.progressOf(loop.state())];
  loop.start();
  scheduler.flush(); // prime
  for (const input of inputs) {
    switch (input.kind) {
      case 'action':
        loop.dispatch(input.action);
        break;
      case 'advance':
        now += input.ms;
        scheduler.flush();
        break;
      case 'gap':
        now += input.ms;
        scheduler.flush();
        break;
      case 'settle':
        loop.settle();
        break;
    }
    progressTrace.push(engine.progressOf(loop.state()));
  }
  loop.stop();
  return { finalState: loop.state(), progressTrace, journal, invariantViolations };
}

export function inputArb<A>(
  actionArb: fc.Arbitrary<A>,
  mode: 'apply-only' | 'step-only' | 'mixed',
): fc.Arbitrary<KitInput<A>[]> {
  const action = actionArb.map((a): KitInput<A> => ({ kind: 'action', action: a }));
  const advance = fc
    .integer({ min: 1, max: 4_000 })
    .map((ms): KitInput<A> => ({ kind: 'advance', ms }));
  const gap = fc
    .integer({ min: 30_001, max: 36 * 3_600_000 })
    .map((ms): KitInput<A> => ({ kind: 'gap', ms }));
  const settle = fc.constant<KitInput<A>>({ kind: 'settle' });
  const one =
    mode === 'apply-only'
      ? fc.oneof({ weight: 8, arbitrary: action }, { weight: 1, arbitrary: settle })
      : mode === 'step-only'
        ? fc.oneof(
            { weight: 6, arbitrary: advance },
            { weight: 1, arbitrary: gap },
            { weight: 1, arbitrary: settle },
          )
        : fc.oneof(
            { weight: 5, arbitrary: action },
            { weight: 4, arbitrary: advance },
            { weight: 1, arbitrary: gap },
            { weight: 1, arbitrary: settle },
          );
  return fc.array(one, { minLength: 1, maxLength: 60 });
}

const isMonotone = (xs: readonly number[]): boolean =>
  xs.every((x, i) => i === 0 || x >= xs[i - 1]!);

/** Assert the contract for one engine in one mode. Throws (via fast-check) on the first violation. */
export function assertConformance<S, A>(
  opts: KitOptions<S, A>,
  mode: 'apply-only' | 'step-only' | 'mixed',
): void {
  const fp = opts.fingerprint ?? ((s: S) => JSON.stringify(s));
  try {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        inputArb(opts.actionArb, mode),
        (seed, inputs) => {
          const a = runKit(opts.engine, seed, inputs, opts.tps);
          const b = runKit(opts.engine, seed, inputs, opts.tps);
          // progressOf monotone under every input, incl. gaps and settle
          if (!isMonotone(a.progressTrace))
            throw new Error(`progressOf not monotone: ${a.progressTrace.join(',')}`);
          // progressOf is a safe integer ≥ 0
          const p = opts.engine.progressOf(a.finalState);
          if (!Number.isSafeInteger(p) || p < 0) throw new Error(`progressOf not a safe int: ${p}`);
          // onGap never raised progressOf (the loop refuses and reports it)
          if (a.invariantViolations.length) throw new Error(a.invariantViolations.join('; '));
          // determinism: same seed + inputs → same state + same journal
          if (fp(a.finalState) !== fp(b.finalState)) throw new Error('non-deterministic state');
          if (JSON.stringify(a.journal) !== JSON.stringify(b.journal))
            throw new Error('non-deterministic journal');
          // summary: finite numbers only
          const s = opts.engine.summary?.(a.finalState);
          if (s)
            for (const [k, v] of Object.entries(s))
              if (typeof v !== 'number' || !Number.isFinite(v))
                throw new Error(`summary.${k} is not a finite number`);
          // settle keeps progress
          if (opts.engine.settle) {
            const before = opts.engine.progressOf(a.finalState);
            const settled = opts.engine.settle(a.finalState, {
              now: 1_800_000_000_000,
              rng: createRngStreams(seed).sim,
              tick: 0,
              catchUp: false,
            });
            if (opts.engine.progressOf(settled) !== before)
              throw new Error('settle changed progress');
          }
        },
      ),
      { numRuns: opts.runs ?? 60 },
    );
  } catch (e) {
    // surface the contract violation itself, not only fast-check's counterexample report
    const cause = (e as { cause?: unknown }).cause;
    const inner = cause instanceof Error ? cause.message : String(cause ?? '');
    throw new Error(
      `engine conformance failed (${mode}): ${inner}\n${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
