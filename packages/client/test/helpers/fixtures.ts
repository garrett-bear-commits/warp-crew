// Shared test fixtures: a tiny counter engine + codec, deterministic timers driven by FakeClock,
// and a client Clock bound to that FakeClock (no wall clock anywhere in the tests).
import { FakeClock } from '@foundation/testkit';
import { createClock, type Clock } from '../../src/clock/index.ts';
import type { Ctx, Effect, Engine } from '../../src/engine/contract.ts';
import { defineSave, type SaveCodec } from '../../src/storage/codec.ts';
import type { Timers } from '../../src/ids.ts';

export interface CounterState {
  count: number;
  ticks: number;
  progress: number;
  note?: string;
}
export type CounterAction =
  { type: 'inc'; n: number } | { type: 'noop' } | { type: 'pause'; on: boolean };
export type CounterEffect = Effect & { kind: 'ding' | 'tick' };

export function counterEngine(
  opts: { badGap?: boolean; stepProgress?: boolean } = {},
): Engine<CounterState, CounterAction, CounterEffect> {
  return {
    newState: () => ({ count: 0, ticks: 0, progress: 0 }),
    apply(state, action, ctx: Ctx) {
      if (action.type === 'inc') {
        return {
          state: { ...state, count: state.count + action.n, progress: state.progress + action.n },
          effects: [{ kind: 'ding', tick: ctx.tick, ttlTicks: 5, payload: action.n }],
        };
      }
      if (action.type === 'pause')
        return {
          state: { ...state, note: action.on ? 'paused' : undefined } as CounterState,
          effects: [],
        };
      return { state, effects: [] };
    },
    step(state, dt, ctx) {
      const next: CounterState = { ...state, ticks: state.ticks + dt };
      if (opts.stepProgress) next.progress += dt;
      return { state: next, effects: [{ kind: 'tick', tick: ctx.tick, ttlTicks: 2 }] };
    },
    isPaused: (s) => s.note === 'paused',
    onGap(state, gap) {
      const next: CounterState = { ...state, note: `gap:${Math.round(gap.serverSec)}` };
      if (opts.badGap) next.progress += 100;
      return { state: next, effects: [] };
    },
    settle: (s) => s,
    progressOf: (s) => s.progress,
    summary: (s) => ({ count: s.count }),
  };
}

export const counterCodec: SaveCodec<CounterState> = defineSave<CounterState>({
  schemaVersion: 2,
  migrations: {
    // v1 stored `total` instead of `count`
    1: (old) => {
      const o = old as { total?: number; ticks?: number; progress?: number };
      return { count: o.total ?? 0, ticks: o.ticks ?? 0, progress: o.progress ?? 0 };
    },
  },
  validate: (s) => typeof s.count === 'number' && typeof s.progress === 'number',
});

/** Deterministic timers: callbacks fire when `advance()` moves the FakeClock past their due time. */
export interface FakeTimers extends Timers {
  advance(ms: number): Promise<void>;
  /** Let promise chains settle without moving time. */
  flush(): Promise<void>;
  pending(): number;
}

export async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

export function createFakeTimers(clock: FakeClock): FakeTimers {
  let nextId = 1;
  const queue = new Map<number, { at: number; cb: () => void }>();
  return {
    set(cb, ms) {
      const id = nextId++;
      queue.set(id, { at: clock.now() + Math.max(0, ms), cb });
      return id;
    },
    clear(h) {
      queue.delete(h as number);
    },
    async advance(ms) {
      await flushMicrotasks();
      const target = clock.now() + ms;
      for (;;) {
        let nextDue: { id: number; at: number; cb: () => void } | null = null;
        for (const [id, t] of queue)
          if (t.at <= target && (!nextDue || t.at < nextDue.at)) nextDue = { id, ...t };
        if (!nextDue) break;
        queue.delete(nextDue.id);
        if (clock.now() < nextDue.at) clock.set(nextDue.at);
        nextDue.cb();
        await flushMicrotasks();
      }
      if (clock.now() < target) clock.set(target);
      await flushMicrotasks();
    },
    flush: () => flushMicrotasks(),
    pending: () => queue.size,
  };
}

/** A client Clock whose device + monotonic sources are the FakeClock. */
export function boundClock(fake: FakeClock): Clock {
  return createClock({ deviceNow: fake.now, monotonic: fake.now });
}

export { FakeClock };
