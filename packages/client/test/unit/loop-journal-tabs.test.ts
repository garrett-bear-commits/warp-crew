import { describe, expect, it } from 'vitest';
import { FakeClock } from '@foundation/testkit';
import { LIMITS } from '@foundation/contracts/enums';
import { createEffectRing, createRngStreams, createSeededRng } from '../../src/engine/contract.ts';
import { createLoop, manualScheduler } from '../../src/engine/loop.ts';
import { createJournal } from '../../src/journal/index.ts';
import { createLeaderElection, type LocksLike } from '../../src/tabs/leader.ts';
import { adoptGeneration, createGenerationBus, type ChannelLike } from '../../src/generations.ts';
import { createRestoreGate } from '../../src/restore/gate.ts';
import { memorySpool } from '../../src/storage/spool.ts';
import { counterEngine, type CounterEffect, type CounterState } from '../helpers/fixtures.ts';
import type { CacheEnvelope } from '../../src/storage/envelope.ts';

describe('rng streams (§1 two seeded streams)', () => {
  it('is deterministic per seed, in [0,1), state restorable, sim ≠ cosmetic', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const st = a.state();
    const n1 = a.next();
    a.restore(st);
    expect(a.next()).toBe(n1);
    expect(a.int(10)).toBeLessThan(10);
    expect(a.int(0)).toBe(0);
    const s = createRngStreams(7);
    expect(s.sim.next()).not.toBe(s.cosmetic.next());
    expect(createSeededRng(0).next()).toBe(createSeededRng(0).next());
  });
});

describe('effect ring (§5.1 bounded, dropped under catch-up, ttl)', () => {
  it('bounds, drops under catch-up, expires by ttl, drains by kind', () => {
    const ring = createEffectRing<CounterEffect>(3);
    let notified = 0;
    ring.subscribe(() => notified++);
    ring.push([
      { kind: 'ding', tick: 0 },
      { kind: 'tick', tick: 0, ttlTicks: 1 },
      { kind: 'ding', tick: 1 },
      { kind: 'ding', tick: 2 },
    ]);
    expect(ring.size()).toBe(3);
    expect(ring.dropped()).toBe(1);
    ring.push([{ kind: 'ding', tick: 3 }], { catchUp: true });
    expect(ring.size()).toBe(3);
    expect(ring.dropped()).toBe(2);
    ring.expire(5);
    expect(ring.peek().some((e) => e.kind === 'tick')).toBe(false);
    expect(ring.drain(['ding']).length).toBe(2);
    expect(ring.size()).toBe(0);
    ring.push([{ kind: 'ding', tick: 9 }]);
    expect(ring.drain().length).toBe(1);
    expect(notified).toBeGreaterThan(0);
  });
});

function makeLoop(
  opts: {
    badGap?: boolean;
    stepProgress?: boolean;
    tps?: number;
    maxCatchUpTicks?: number;
    bigGapMs?: number;
  } = {},
) {
  const fake = new FakeClock(0);
  const scheduler = manualScheduler();
  const effects = createEffectRing<CounterEffect>(100);
  const invariants: string[] = [];
  const journal: string[] = [];
  const engine = counterEngine({
    ...(opts.badGap ? { badGap: true } : {}),
    ...(opts.stepProgress ? { stepProgress: true } : {}),
  });
  const loop = createLoop<
    CounterState,
    { type: 'inc'; n: number } | { type: 'noop' } | { type: 'pause'; on: boolean },
    CounterEffect
  >({
    engine,
    initialState: engine.newState({ now: 0, seed: 1, rng: createSeededRng(1) }),
    clock: { now: () => fake.now() + 1_000, deviceNow: fake.now },
    rng: createSeededRng(1),
    effects,
    options: {
      tps: opts.tps ?? 10,
      maxCatchUpTicks: opts.maxCatchUpTicks ?? 20,
      bigGapMs: opts.bigGapMs ?? 30_000,
      scheduler,
    },
    describeAction: (a) =>
      a.type === 'inc' ? { name: 'inc', args: { n: a.n } } : { name: a.type },
    onJournal: (e) => journal.push(`${e.kind}:${e.name}`),
    onInvariant: (m) => invariants.push(m),
  });
  return { fake, scheduler, effects, loop, invariants, journal, engine };
}

describe('loop (§5.1, ADR-017)', () => {
  it('fixed tps accumulator: 1 s at 10 tps → 10 ticks; publishes {state, rev}', () => {
    const { fake, scheduler, loop } = makeLoop();
    const pubs: number[] = [];
    loop.subscribe((p) => pubs.push(p.rev));
    loop.start();
    scheduler.flush(); // priming frame
    fake.advance(1000);
    scheduler.flush();
    expect(loop.state().ticks).toBe(10);
    expect(loop.tick()).toBe(10);
    expect(pubs.length).toBe(1);
    fake.advance(50);
    scheduler.flush();
    expect(loop.state().ticks).toBe(10);
    fake.advance(50);
    scheduler.flush();
    expect(loop.state().ticks).toBe(11);
    loop.stop();
    expect(loop.running()).toBe(false);
  });
  it('catch-up cap: a 10 s stall replays at most maxCatchUpTicks and drops the rest; catch-up effects are dropped', () => {
    const { fake, scheduler, loop, effects } = makeLoop({ maxCatchUpTicks: 20 });
    loop.start();
    scheduler.flush();
    fake.advance(10_000);
    scheduler.flush();
    expect(loop.state().ticks).toBe(20);
    expect(loop.stats().catchUpFrames).toBe(1);
    expect(loop.stats().droppedTicks).toBe(80);
    expect(effects.peek().some((e) => e.kind === 'tick')).toBe(false);
    expect(effects.dropped()).toBeGreaterThan(0);
  });
  it('big gap → onGap hand-off exactly once; ticks are NOT replayed; journal records gap', () => {
    const { fake, scheduler, loop, journal } = makeLoop({ bigGapMs: 30_000 });
    loop.start();
    scheduler.flush();
    fake.advance(3_600_000);
    scheduler.flush();
    expect(loop.state().ticks).toBe(0);
    expect(loop.state().note).toBe('gap:3600');
    expect(loop.stats().gaps).toBe(1);
    expect(journal).toContain('gap:gap');
  });
  it('onGap MUST NOT raise progressOf: a violating engine is refused and reported; progress unchanged', () => {
    const { fake, scheduler, loop, invariants } = makeLoop({ badGap: true });
    loop.dispatch({ type: 'inc', n: 5 });
    expect(loop.state().progress).toBe(5);
    loop.start();
    scheduler.flush();
    fake.advance(60_000);
    scheduler.flush();
    expect(loop.state().progress).toBe(5);
    expect(invariants.length).toBe(1);
    expect(invariants[0]).toMatch(/onGap raised progressOf/);
  });
  it('isPaused is re-checked every tick: paused ticks are consumed without stepping', () => {
    const { fake, scheduler, loop } = makeLoop();
    loop.dispatch({ type: 'pause', on: true });
    loop.start();
    scheduler.flush();
    fake.advance(1000);
    scheduler.flush();
    expect(loop.state().ticks).toBe(0);
    loop.dispatch({ type: 'pause', on: false });
    fake.advance(500);
    scheduler.flush();
    expect(loop.state().ticks).toBe(5);
  });
  it('dispatch applies immediately, journals action name+args, publishes, pushes effects', () => {
    const { loop, journal, effects } = makeLoop();
    let rev = 0;
    loop.subscribe((p) => (rev = p.rev));
    loop.dispatch({ type: 'inc', n: 3 });
    expect(loop.state().count).toBe(3);
    expect(rev).toBe(1);
    expect(journal).toEqual(['action:inc']);
    expect(effects.peek()[0]?.kind).toBe('ding');
  });
  it('replaceState resets the accumulator and publishes; settle journals', () => {
    const { loop, journal } = makeLoop();
    loop.replaceState({ count: 9, ticks: 9, progress: 9 });
    expect(loop.state().count).toBe(9);
    loop.settle();
    expect(journal).toContain('settle:settle');
  });
});

describe('journal (§5.2, ADR-020)', () => {
  it('records inputs; args only for allow-listed names and keys; free text is never kept', () => {
    const j = createJournal({ mode: 'on', argsAllowlist: { inc: ['n'], toggle: true } });
    j.record({ tick: 1, now: 10, kind: 'action', name: 'inc', args: { n: 2, secret: 'x' } });
    j.record({
      tick: 2,
      now: 11,
      kind: 'action',
      name: 'toggle',
      args: { on: true, note: 'a'.repeat(200) },
    });
    j.record({ tick: 3, now: 12, kind: 'action', name: 'chat', args: { text: 'free text' } });
    j.record({ tick: 4, now: 13, kind: 'settle', name: 'settle', args: { x: 1 } });
    const e = j.entries();
    expect(e[0]?.args).toEqual({ n: 2 });
    expect(e[1]?.args).toEqual({ on: true, note: 'a'.repeat(64) });
    expect(e[2]?.args).toBeUndefined();
    expect(e[3]?.args).toBeUndefined();
  });
  it('ring is bounded in bytes (32 KiB) and evicts the oldest', () => {
    const j = createJournal({ mode: 'on', argsAllowlist: { a: true } });
    for (let i = 0; i < 5000; i++)
      j.record({ tick: i, now: i, kind: 'action', name: 'a', args: { s: 'x'.repeat(40) } });
    expect(j.bytes()).toBeLessThanOrEqual(LIMITS.journalRingBytes);
    expect(j.entries().length).toBeLessThan(5000);
    expect(j.entries()[0]!.tick).toBeGreaterThan(0);
    const b = j.breadcrumbs();
    expect(b.length).toBe(20);
    expect(b[19]).toEqual({ name: 'a', tick: 4999 });
  });
  it('mode off records nothing; errors_only ships only after markError; on ships always; ≤ 16 KiB per call', () => {
    const off = createJournal({ mode: 'off' });
    off.record({ tick: 0, now: 0, kind: 'action', name: 'a' });
    expect(off.entries().length).toBe(0);
    expect(off.shouldShip()).toBe(false);

    const eo = createJournal({ mode: 'errors_only' });
    eo.record({ tick: 0, now: 0, kind: 'action', name: 'a' });
    expect(eo.shouldShip()).toBe(false);
    eo.markError();
    expect(eo.shouldShip()).toBe(true);
    const batch = eo.takeForShip();
    expect(batch?.entries.length).toBe(1);
    expect(batch?.fromSeq).toBe(0);
    batch!.ack();
    expect(eo.shouldShip()).toBe(false);

    const on = createJournal({ mode: 'on', argsAllowlist: { a: true } });
    for (let i = 0; i < 2000; i++)
      on.record({ tick: i, now: i, kind: 'action', name: 'a', args: { s: 'y'.repeat(30) } });
    const b1 = on.takeForShip()!;
    expect(JSON.stringify(b1.entries).length).toBeLessThanOrEqual(LIMITS.journalMaxBytesPerCall);
    const body = on.shipBody(b1, 'cmd', 3, '1.0');
    expect(body).toMatchObject({
      commandId: 'cmd',
      generation: 3,
      fromSeq: b1.fromSeq,
      buildVersion: '1.0',
    });
    b1.ack();
    const b2 = on.takeForShip()!;
    expect(b2.fromSeq).toBe(b1.fromSeq + b1.entries.length);
  });
  it('persists and reloads through a spool', async () => {
    const spool = memorySpool();
    const j = createJournal({ mode: 'errors_only', spool, spoolKey: 'k' });
    j.record({ tick: 1, now: 1, kind: 'action', name: 'a' });
    j.markError();
    await j.persist();
    const j2 = createJournal({ mode: 'errors_only' });
    j2.bindSpool(spool, 'k');
    await j2.load();
    expect(j2.entries().length).toBe(1);
    expect(j2.shouldShip()).toBe(true);
    j2.clear();
    expect(j2.entries().length).toBe(0);
  });
});

/** In-memory Web Locks: one holder per name, ifAvailable + steal supported. */
function fakeLocks(): LocksLike & { holders(): number } {
  const held = new Map<string, { release: () => void; reject: (e: Error) => void }>();
  return {
    holders: () => held.size,
    request(name, options, cb) {
      const cur = held.get(name);
      if (cur && !options.steal) {
        if (options.ifAvailable) return Promise.resolve(cb(null));
        return new Promise(() => {}); // would queue; tests never wait on it
      }
      if (cur && options.steal) {
        held.delete(name);
        cur.reject(new Error('AbortError'));
      }
      return new Promise((resolve, reject) => {
        held.set(name, {
          release: () => {
            held.delete(name);
          },
          reject,
        });
        Promise.resolve(cb({ name }))
          .then((v) => {
            held.delete(name);
            resolve(v);
          })
          .catch(reject);
      });
    },
  };
}

describe('leader election (§5.2 multi-tab)', () => {
  it('fallback: no Web Locks → this tab is the leader', async () => {
    const l = createLeaderElection({ name: 'x', locks: null });
    expect(l.available).toBe(false);
    expect(l.isLeader()).toBe(true);
    expect(await l.request()).toBe('leader');
  });
  it('first tab leads, second follows, "Play here" steals, first becomes follower', async () => {
    const locks = fakeLocks();
    const a = createLeaderElection({ name: 'x', locks });
    const b = createLeaderElection({ name: 'x', locks });
    const roles: string[] = [];
    a.onChange((r) => roles.push(`a:${r}`));
    b.onChange((r) => roles.push(`b:${r}`));
    expect(await a.request()).toBe('leader');
    expect(await b.request()).toBe('follower');
    expect(await b.takeover()).toBe('leader');
    await new Promise((r) => setTimeout(r, 0));
    expect(a.isLeader()).toBe(false);
    expect(b.isLeader()).toBe(true);
    expect(roles).toContain('a:follower');
    b.release();
    expect(b.isLeader()).toBe(false);
  });
});

describe('generations (§1 newer wins, §5.2 broadcast)', () => {
  it('adoptGeneration resets floor/pending/acked; refuses moving backwards', () => {
    const env: CacheEnvelope<{ n: number }> = {
      format: 1,
      gameId: 'g',
      playerId: 'p',
      schemaVersion: 1,
      generation: 2,
      state: { n: 1 },
      progress: 50,
      savedAt: 1,
      dirty: true,
      lastAckedSeq: 8,
      sessionId: 's',
      clientSeq: 9,
      ratchetFloor: { playerId: 'p', generation: 2, progress: 50 },
      lastVerdict: 'synced',
      lastSyncedAt: 1,
      pending: {
        commandId: 'c',
        encodedBlob: '{}',
        enc: 'json',
        progress: 50,
        savedAt: 1,
        reason: 'autosave',
        clientSeq: 9,
        generation: 2,
        schemaVersion: 1,
      },
      rngState: 5,
    };
    const next = adoptGeneration(env, {
      generation: 3,
      state: { n: 0 },
      progress: 0,
      seq: 12,
      savedAt: 2,
    });
    expect(next.generation).toBe(3);
    expect(next.pending).toBeUndefined();
    expect(next.rngState).toBeUndefined();
    expect(next.ratchetFloor).toEqual({ playerId: 'p', generation: 3, progress: 0 });
    expect(next.lastAckedSeq).toBe(12);
    expect(next.clientSeq).toBe(0);
    expect(next.dirty).toBe(false);
    expect(
      adoptGeneration(env, { generation: 1, state: { n: 0 }, progress: 0, seq: 0, savedAt: 0 }),
    ).toBe(env);
  });
  it('bus announces and receives over a channel; no-op when unavailable', () => {
    const peers = new Set<ChannelLike>();
    const factory = (): ChannelLike => {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage(m) {
          for (const p of peers) if (p !== ch) p.onmessage?.({ data: m });
        },
        close() {
          peers.delete(ch);
        },
      };
      peers.add(ch);
      return ch;
    };
    const a = createGenerationBus({ gameId: 'g', channel: factory });
    const b = createGenerationBus({ gameId: 'g', channel: factory });
    const got: number[] = [];
    b.onGenerationChanged((m) => got.push(m.generation));
    a.announce('p', 4, 1);
    expect(got).toEqual([4]);
    a.close();
    b.close();
    const none = createGenerationBus({ gameId: 'g', channel: null });
    expect(none.available).toBe(false);
    none.announce('p', 1, 1);
  });
});

describe('restore gate (§1 one gate)', () => {
  it('holds nest; observers see open/close once per outermost hold', async () => {
    const g = createRestoreGate();
    const seen: boolean[] = [];
    g.onChange((r) => seen.push(r));
    expect(g.isRestoring()).toBe(false);
    await g.hold(async () => {
      expect(g.isRestoring()).toBe(true);
      await g.hold(async () => expect(g.isRestoring()).toBe(true));
      expect(g.isRestoring()).toBe(true);
    });
    expect(g.isRestoring()).toBe(false);
    expect(seen).toEqual([true, false]);
    await expect(
      g.hold(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(g.isRestoring()).toBe(false);
  });
});
