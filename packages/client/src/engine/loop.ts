// loop.ts (§5.1, ADR-017): rAF-style accumulator with a fixed tick rate, a catch-up cap, a
// big-gap hand-off to engine.onGap (which MUST NOT raise progressOf — the loop refuses such a
// result and reports it), isPaused re-checked every tick, and {state, rev} publication.
// The scheduler is injectable so tests drive frames by hand; the loop never reads Date.now.
import type { Ctx, Effect, EffectRing, Engine, Rng } from './contract.ts';
import type { JournalEntryKind } from '@foundation/contracts/enums';

/** Frame scheduler: rAF in browsers, setInterval in workers, manual in tests. */
export interface FrameScheduler {
  request(cb: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface LoopOptions {
  /** Ticks per second (idle 2–10, TD 20–30). */
  tps: number;
  /** Max ticks replayed in one frame before dropping the remainder (default 5 s worth). */
  maxCatchUpTicks?: number;
  /** Elapsed ms above which the frame is a gap hand-off instead of a catch-up (default 30 s). */
  bigGapMs?: number;
  scheduler?: FrameScheduler;
}

export interface LoopClock {
  /** Server-anchored now (drives Ctx.now and the server gap). */
  now(): number;
  /** Device wall clock (drives the device gap only). */
  deviceNow(): number;
}

export interface JournalInput {
  tick: number;
  now: number;
  kind: JournalEntryKind;
  name: string;
  args?: Record<string, number | boolean | string> | undefined;
}

export interface LoopDeps<S, A, E extends Effect> {
  engine: Engine<S, A, E>;
  initialState: S;
  clock: LoopClock;
  rng: Rng;
  effects: EffectRing<E>;
  options: LoopOptions;
  /** Name/args extractor for the journal (args only for bounded schemas — see journal/index.ts). */
  describeAction?: (action: A) => {
    name: string;
    args?: Record<string, number | boolean | string>;
  };
  onJournal?: (entry: JournalInput) => void;
  /** Contract violations (onGap raised progressOf). Reported, never thrown mid-frame. */
  onInvariant?: (message: string) => void;
}

export interface Published<S> {
  state: S;
  rev: number;
}

export interface Loop<S, A> {
  start(): void;
  stop(): void;
  running(): boolean;
  /** Run exactly one frame now (tests / manual schedulers). */
  frame(): void;
  dispatch(action: A): void;
  /** Apply engine.settle (wall-clock hand-offs) and publish; used before autosave/push. */
  settle(): S;
  state(): S;
  rev(): number;
  tick(): number;
  /** Replace the state (adopt remote, restore, generation change). Resets the accumulator. */
  replaceState(state: S): void;
  subscribe(cb: (p: Published<S>) => void): () => void;
  /** Diagnostics: frames that hit the catch-up cap and gap hand-offs performed. */
  stats(): { catchUpFrames: number; gaps: number; droppedTicks: number };
}

/** rAF-backed scheduler for browsers; falls back to setTimeout(16) when rAF is absent. */
export function browserScheduler(g: typeof globalThis = globalThis): FrameScheduler {
  const raf = (g as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  const caf = (g as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame;
  if (typeof raf === 'function' && typeof caf === 'function') {
    return { request: (cb) => raf.call(g, cb), cancel: (h) => caf.call(g, h as number) };
  }
  return {
    request: (cb) => g.setTimeout(cb, 16),
    cancel: (h) => g.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

/** Manual scheduler for tests: `flush()` runs the pending frame callback once. */
export function manualScheduler(): FrameScheduler & { flush(): boolean; pending(): boolean } {
  let cb: (() => void) | null = null;
  return {
    request(fn) {
      cb = fn;
      return 1;
    },
    cancel() {
      cb = null;
    },
    flush() {
      const fn = cb;
      cb = null;
      if (!fn) return false;
      fn();
      return true;
    },
    pending: () => cb !== null,
  };
}

export function createLoop<S, A, E extends Effect>(deps: LoopDeps<S, A, E>): Loop<S, A> {
  const { engine, clock, rng, effects, options } = deps;
  const tickMs = 1000 / options.tps;
  const maxCatchUp = options.maxCatchUpTicks ?? Math.max(1, Math.round(options.tps * 5));
  const bigGapMs = options.bigGapMs ?? 30_000;
  const scheduler = options.scheduler ?? browserScheduler();

  let state = deps.initialState;
  let rev = 0;
  let tick = 0;
  let acc = 0;
  let lastNow = 0;
  let lastDevice = 0;
  let primed = false;
  let handle: unknown = null;
  let isRunning = false;
  const subs = new Set<(p: Published<S>) => void>();
  const stats = { catchUpFrames: 0, gaps: 0, droppedTicks: 0 };

  const publish = (): void => {
    rev++;
    const p = { state, rev };
    for (const s of subs) s(p);
  };
  const ctx = (catchUp: boolean): Ctx => ({ now: lastNow, rng, tick, catchUp });

  const runFrame = (): void => {
    const now = clock.now();
    const dev = clock.deviceNow();
    if (!primed) {
      primed = true;
      lastNow = now;
      lastDevice = dev;
      return;
    }
    const elapsed = now - lastNow;
    const devElapsed = dev - lastDevice;
    lastNow = now;
    lastDevice = dev;
    if (elapsed <= 0) return;

    if (elapsed > bigGapMs) {
      // Big gap: hand off to the engine ONCE; never replay ticks; never advance progressOf.
      acc = 0;
      stats.gaps++;
      if (engine.onGap) {
        const before = engine.progressOf(state);
        const gap = { deviceSec: devElapsed / 1000, serverSec: elapsed / 1000 };
        const r = engine.onGap(state, gap, ctx(false));
        if (engine.progressOf(r.state) > before) {
          deps.onInvariant?.('engine.onGap raised progressOf; result refused (§1 engine purity)');
        } else {
          state = r.state;
          effects.push(r.effects);
        }
        deps.onJournal?.({
          tick,
          now: lastNow,
          kind: 'gap',
          name: 'gap',
          args: { deviceSec: Math.round(gap.deviceSec), serverSec: Math.round(gap.serverSec) },
        });
        publish();
      }
      return;
    }

    if (!engine.step) return;
    acc += elapsed;
    let ticks = Math.floor(acc / tickMs);
    if (ticks <= 0) return;
    let catchUp = false;
    if (ticks > maxCatchUp) {
      catchUp = true;
      stats.catchUpFrames++;
      stats.droppedTicks += ticks - maxCatchUp;
      ticks = maxCatchUp;
      acc = 0;
    } else {
      acc -= ticks * tickMs;
    }
    let stepped = false;
    for (let i = 0; i < ticks; i++) {
      // isPaused is re-checked every tick: a paused sim consumes wall time but never steps.
      if (engine.isPaused?.(state)) continue;
      const r = engine.step(state, 1, ctx(catchUp));
      state = r.state;
      tick++;
      effects.push(r.effects, { catchUp });
      stepped = true;
    }
    effects.expire(tick);
    if (stepped) publish();
  };

  const schedule = (): void => {
    handle = scheduler.request(() => {
      handle = null;
      if (!isRunning) return;
      runFrame();
      if (isRunning) schedule();
    });
  };

  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      primed = false;
      schedule();
    },
    stop() {
      isRunning = false;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    },
    running: () => isRunning,
    frame: runFrame,
    dispatch(action) {
      const now = clock.now();
      if (!primed) {
        primed = true;
        lastNow = now;
        lastDevice = clock.deviceNow();
      }
      lastNow = now;
      const r = engine.apply(state, action, ctx(false));
      state = r.state;
      effects.push(r.effects);
      const d = deps.describeAction?.(action);
      if (d) {
        const entry: JournalInput = { tick, now, kind: 'action', name: d.name };
        if (d.args) entry.args = d.args;
        deps.onJournal?.(entry);
      }
      publish();
    },
    settle() {
      if (engine.settle) {
        const now = clock.now();
        lastNow = primed ? lastNow : now;
        state = engine.settle(state, { now, rng, tick, catchUp: false });
        deps.onJournal?.({ tick, now, kind: 'settle', name: 'settle' });
        publish();
      }
      return state;
    },
    state: () => state,
    rev: () => rev,
    tick: () => tick,
    replaceState(s) {
      state = s;
      acc = 0;
      primed = false;
      publish();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    stats: () => ({ ...stats }),
  };
}
