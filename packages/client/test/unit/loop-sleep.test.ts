import { describe, expect, it } from 'vitest';
import { FakeClock } from '@foundation/testkit';
import { createEffectRing, createSeededRng } from '../../src/engine/contract.ts';
import {
  browserScheduler,
  createLoop,
  manualScheduler,
  type FrameScheduler,
} from '../../src/engine/loop.ts';
import {
  counterEngine,
  type CounterAction,
  type CounterEffect,
  type CounterState,
} from '../helpers/fixtures.ts';

const VSYNC = 16;

/**
 * A page on a 16 ms vsync, driven by a FakeClock: timers fire at their due time, rAF on the first
 * vsync after the request, and a hidden page runs timers but no frames.
 */
function fakeBrowser(clock: FakeClock) {
  type Task = { at: number; kind: 'timers' | 'frames'; fn: () => void };
  const tasks = new Map<number, Task>();
  const ran = { timers: 0, frames: 0 };
  let nextId = 1;
  let hidden = false;
  const add = (task: Task): number => {
    tasks.set(nextId, task);
    return nextId++;
  };
  const g = {
    setTimeout: (fn: () => void, ms: number) => add({ at: clock.now() + ms, kind: 'timers', fn }),
    clearTimeout: (id: number) => void tasks.delete(id),
    requestAnimationFrame: (fn: () => void) =>
      add({ at: (Math.floor(clock.now() / VSYNC) + 1) * VSYNC, kind: 'frames', fn }),
    cancelAnimationFrame: (id: number) => void tasks.delete(id),
  };
  return {
    g: g as unknown as typeof globalThis,
    ran,
    tasks: () => [...tasks.values()].map((t) => `${t.kind}@${t.at}`),
    setHidden(on: boolean) {
      hidden = on;
    },
    /** Run every due task in time order, moving the clock with them, then settle at `t`. */
    runUntil(t: number) {
      for (;;) {
        let next: [number, Task] | undefined;
        for (const entry of tasks) {
          const task = entry[1];
          if (task.at > t || (hidden && task.kind === 'frames')) continue;
          if (!next || task.at < next[1].at) next = entry;
        }
        if (!next) break;
        tasks.delete(next[0]);
        clock.set(Math.max(clock.now(), next[1].at));
        ran[next[1].kind]++;
        next[1].fn();
      }
      clock.set(t);
    },
  };
}

function browserLoop(scheduler: (g: typeof globalThis) => FrameScheduler) {
  const clock = new FakeClock(0);
  const browser = fakeBrowser(clock);
  const engine = counterEngine();
  const loop = createLoop<CounterState, CounterAction, CounterEffect>({
    engine,
    initialState: engine.newState({ now: 0, seed: 1, rng: createSeededRng(1) }),
    clock: { now: clock.now, deviceNow: clock.now },
    rng: createSeededRng(1),
    effects: createEffectRing<CounterEffect>(100),
    options: { tps: 5, scheduler: scheduler(browser.g) },
  });
  const log: string[] = [];
  loop.subscribe((p) => log.push(`${clock.now()} rev${p.rev} ticks${p.state.ticks}`));
  return { browser, loop, log };
}

function manualLoop() {
  const fake = new FakeClock(0);
  const scheduler = manualScheduler();
  const engine = counterEngine();
  const loop = createLoop<CounterState, CounterAction, CounterEffect>({
    engine,
    initialState: engine.newState({ now: 0, seed: 1, rng: createSeededRng(1) }),
    clock: { now: fake.now, deviceNow: fake.now },
    rng: createSeededRng(1),
    effects: createEffectRing<CounterEffect>(100),
    options: { tps: 10, maxCatchUpTicks: 20, bigGapMs: 30_000, scheduler },
  });
  return { fake, scheduler, loop };
}

describe('loop sleeps between ticks', () => {
  it('hints the ms left until the next tick after every frame', () => {
    const { fake, scheduler, loop } = manualLoop();
    loop.start();
    expect(scheduler.lastDelay()).toBe(0); // unprimed: the next frame primes
    scheduler.flush();
    expect(scheduler.lastDelay()).toBe(100);
    fake.advance(130);
    scheduler.flush();
    expect(loop.tick()).toBe(1);
    expect(scheduler.lastDelay()).toBe(70);
    fake.advance(20);
    scheduler.flush();
    expect(loop.tick()).toBe(1);
    expect(scheduler.lastDelay()).toBe(50);
    fake.advance(50);
    scheduler.flush();
    expect(loop.tick()).toBe(2);
    expect(scheduler.lastDelay()).toBe(100);

    // A paused sim still consumes wall time, so it wakes at the same cadence.
    loop.dispatch({ type: 'pause', on: true });
    fake.advance(140);
    scheduler.flush();
    expect(loop.state().ticks).toBe(2);
    expect(scheduler.lastDelay()).toBe(60);

    // A capped catch-up or a gap hand-off leaves nothing banked: a full tick until the next one.
    loop.dispatch({ type: 'pause', on: false });
    fake.advance(10_000);
    scheduler.flush();
    expect(loop.stats().catchUpFrames).toBe(1);
    expect(scheduler.lastDelay()).toBe(100);
    fake.advance(60_000);
    scheduler.flush();
    expect(loop.stats().gaps).toBe(1);
    expect(scheduler.lastDelay()).toBe(100);
  });

  it('an action between frames does not push the awaited tick back', () => {
    const { fake, scheduler, loop } = manualLoop();
    loop.start();
    scheduler.flush();
    fake.advance(60);
    loop.dispatch({ type: 'inc', n: 1 });
    fake.advance(40);
    scheduler.flush();
    expect(loop.tick()).toBe(1);
    expect(scheduler.lastDelay()).toBe(100);
  });

  it('ticks and publishes on the same frames as waking every vsync', () => {
    const everyFrame = browserLoop((g) => {
      const s = browserScheduler(g);
      return { request: (cb) => s.request(cb), cancel: (h) => s.cancel(h) };
    });
    const sleeping = browserLoop(browserScheduler);
    for (const { browser, loop } of [everyFrame, sleeping]) {
      loop.start();
      // Inputs land on vsyncs where only the every-frame loop wakes.
      browser.runUntil(1104);
      loop.dispatch({ type: 'pause', on: true });
      browser.runUntil(1504);
      loop.dispatch({ type: 'pause', on: false });
      browser.runUntil(2000);
      loop.dispatch({ type: 'inc', n: 2 });
      browser.runUntil(2432);
      loop.replaceState({ count: 0, ticks: 0, progress: 0 });
      browser.runUntil(3200);
    }
    // Primed on the 16 ms frame, each tick lands on the first vsync at or after it is due; the
    // replaced state primes on the next vsync (2448) and ticks one tick later.
    expect(everyFrame.log.slice(0, 2)).toEqual(['224 rev1 ticks1', '416 rev2 ticks2']);
    expect(everyFrame.log).toContain('2656 rev15 ticks1');
    expect(sleeping.log).toEqual(everyFrame.log);
    expect(everyFrame.browser.ran.frames).toBe(200);
    expect(sleeping.browser.ran.frames).toBeLessThan(200 / 4);
  });

  it('a hidden page still runs no frame; the frame on return hands the gap off once', () => {
    const { browser, loop, log } = browserLoop(browserScheduler);
    loop.start();
    browser.runUntil(1000);
    const ticks = loop.tick();
    browser.setHidden(true);
    browser.runUntil(61_000);
    expect(loop.tick()).toBe(ticks);
    expect(browser.tasks()).toEqual([expect.stringMatching(/^frames@/)]);
    const published = log.length;
    browser.setHidden(false);
    browser.runUntil(61_016);
    expect(loop.stats().gaps).toBe(1);
    expect(loop.tick()).toBe(ticks);
    expect(log.length).toBe(published + 1);
  });
});

describe('browserScheduler', () => {
  function fakeGlobal(withFrames = true) {
    const calls: string[] = [];
    const timers = new Map<number, () => void>();
    const frames = new Map<number, () => void>();
    let nextId = 1;
    const g: Record<string, unknown> = {
      setTimeout(fn: () => void, ms: number) {
        calls.push(`setTimeout ${ms}`);
        timers.set(nextId, fn);
        return nextId++;
      },
      clearTimeout(id: number) {
        calls.push(`clearTimeout ${id}`);
        timers.delete(id);
      },
    };
    if (withFrames) {
      g.requestAnimationFrame = (fn: () => void) => {
        calls.push('requestAnimationFrame');
        frames.set(nextId, fn);
        return nextId++;
      };
      g.cancelAnimationFrame = (id: number) => {
        calls.push(`cancelAnimationFrame ${id}`);
        frames.delete(id);
      };
    }
    const fire = (queue: Map<number, () => void>) => {
      const all = [...queue.values()];
      queue.clear();
      for (const fn of all) fn();
    };
    return {
      g: g as unknown as typeof globalThis,
      calls,
      fireTimers: () => fire(timers),
      fireFrames: () => fire(frames),
    };
  }

  it('sleeps on a timer one frame short of a long delay, then waits for a frame', () => {
    const { g, calls, fireTimers, fireFrames } = fakeGlobal();
    let ran = 0;
    browserScheduler(g).request(() => ran++, 200);
    expect(calls).toEqual(['setTimeout 184']);
    fireTimers();
    expect(calls).toEqual(['setTimeout 184', 'requestAnimationFrame']);
    expect(ran).toBe(0);
    fireFrames();
    expect(ran).toBe(1);
  });

  it('takes the next frame directly for a short or absent delay', () => {
    const { g, calls, fireFrames } = fakeGlobal();
    let ran = 0;
    const s = browserScheduler(g);
    s.request(() => ran++, 12);
    s.request(() => ran++);
    expect(calls).toEqual(['requestAnimationFrame', 'requestAnimationFrame']);
    fireFrames();
    expect(ran).toBe(2);
  });

  it('cancel stops whichever stage is pending', () => {
    const { g, calls, fireTimers, fireFrames } = fakeGlobal();
    let ran = 0;
    const s = browserScheduler(g);
    const sleeping = s.request(() => ran++, 200);
    s.cancel(sleeping);
    fireTimers();
    expect(calls).toEqual(['setTimeout 184', 'clearTimeout 1']);

    const waking = s.request(() => ran++, 200);
    fireTimers();
    s.cancel(waking);
    fireFrames();
    expect(calls.slice(2)).toEqual([
      'setTimeout 184',
      'requestAnimationFrame',
      'cancelAnimationFrame 3',
    ]);
    expect(ran).toBe(0);
  });

  it('without rAF, waits on a timer for the delay, never under 16 ms', () => {
    const { g, calls, fireTimers } = fakeGlobal(false);
    let ran = 0;
    const s = browserScheduler(g);
    s.request(() => ran++, 200);
    s.request(() => ran++, 5);
    s.request(() => ran++);
    expect(calls).toEqual(['setTimeout 200', 'setTimeout 16', 'setTimeout 16']);
    fireTimers();
    expect(ran).toBe(3);
  });
});
