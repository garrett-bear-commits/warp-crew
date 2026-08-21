import { describe, expect, it } from 'vitest';
import { realTimers, type Timers } from '../../src/ids.ts';
import {
  TAB_LEASE_PROBE_MS,
  TAB_LEASE_TIE_MS,
  createMemoryTabBus,
  createTabLease,
} from '../../src/tabs/lease.ts';

function fakeTime() {
  let now = 0;
  const pending: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const timers: Timers = {
    set(cb, ms) {
      const t = { at: now + ms, fn: cb, cancelled: false };
      pending.push(t);
      return t;
    },
    clear(handle) {
      const t = handle as { cancelled: boolean };
      t.cancelled = true;
    },
  };
  const flushDue = (): void => {
    for (;;) {
      const due = pending.filter((t) => !t.cancelled && t.at <= now);
      if (due.length === 0) return;
      for (const t of due) t.cancelled = true;
      for (const t of due) t.fn();
    }
  };
  const nextAt = (): number | null => {
    const times = pending.filter((t) => !t.cancelled && t.at > now).map((t) => t.at);
    return times.length ? Math.min(...times) : null;
  };
  return {
    now: () => now,
    timers,
    async advance(ms: number) {
      await Promise.resolve();
      await Promise.resolve();
      const target = now + ms;
      while (now < target) {
        const nxt = nextAt();
        if (nxt === null || nxt > target) {
          now = target;
          flushDue();
          await Promise.resolve();
          flushDue();
          break;
        }
        now = nxt;
        flushDue();
        await Promise.resolve();
        flushDue();
      }
    },
  };
}

describe('tab lease (BroadcastChannel fallback)', () => {
  it('elects the lower owner id and never holds two leases on one bus', async () => {
    const bus = createMemoryTabBus();
    const time = fakeTime();
    const a = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'a',
    });
    const b = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'b',
    });
    const pa = a.acquire({ wait: false });
    const pb = b.acquire({ wait: false });
    await time.advance(TAB_LEASE_PROBE_MS + TAB_LEASE_TIE_MS);
    expect(await pa).toBe(true);
    expect(await pb).toBe(false);
    expect(a.isHeld()).toBe(true);
    expect(b.isHeld()).toBe(false);
    a.destroy();
    b.destroy();
  });

  it('waiter takes over after the holder abandons and the lease expires', async () => {
    const bus = createMemoryTabBus();
    const now = (): number => Date.now();
    const a = createTabLease({
      name: 'n',
      bus,
      now,
      timers: realTimers(),
      ownerId: 'a',
      heartbeatMs: 15,
      ttlMs: 45,
      probeMs: 15,
      tieMs: 10,
    });
    const b = createTabLease({
      name: 'n',
      bus,
      now,
      timers: realTimers(),
      ownerId: 'b',
      heartbeatMs: 15,
      ttlMs: 45,
      probeMs: 15,
      tieMs: 10,
    });
    expect(await a.acquire()).toBe(true);
    const pb = b.acquire({ wait: true });
    a.abandon();
    expect(await pb).toBe(true);
    expect(a.isHeld()).toBe(false);
    expect(b.isHeld()).toBe(true);
    b.destroy();
    a.destroy();
  });

  it('steal transfers ownership immediately', async () => {
    const bus = createMemoryTabBus();
    const time = fakeTime();
    const a = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'a',
    });
    const b = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'b',
    });
    const pa = a.acquire();
    await time.advance(TAB_LEASE_PROBE_MS + TAB_LEASE_TIE_MS);
    expect(await pa).toBe(true);
    const stolen = b.acquire({ steal: true, wait: false });
    await time.advance(0);
    expect(await stolen).toBe(true);
    expect(a.isHeld()).toBe(false);
    expect(b.isHeld()).toBe(true);
    a.destroy();
    b.destroy();
  });

  it('release wakes the waiter without waiting for expiry', async () => {
    const bus = createMemoryTabBus();
    const time = fakeTime();
    const a = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'a',
    });
    const b = createTabLease({
      name: 'n',
      bus,
      now: time.now,
      timers: time.timers,
      ownerId: 'b',
    });
    const pa = a.acquire();
    await time.advance(TAB_LEASE_PROBE_MS + TAB_LEASE_TIE_MS);
    expect(await pa).toBe(true);
    const pb = b.acquire({ wait: true });
    a.release();
    await time.advance(TAB_LEASE_PROBE_MS + TAB_LEASE_TIE_MS);
    expect(await pb).toBe(true);
    expect(a.isHeld()).toBe(false);
    a.destroy();
    b.destroy();
  });

  it('real timers still elect a single holder (sanity)', async () => {
    const bus = createMemoryTabBus();
    const now = (): number => Date.now();
    const a = createTabLease({ name: 'n', bus, now, timers: realTimers(), ownerId: 'a' });
    const b = createTabLease({ name: 'n', bus, now, timers: realTimers(), ownerId: 'b' });
    const [ra, rb] = await Promise.all([a.acquire({ wait: false }), b.acquire({ wait: false })]);
    expect([ra, rb].filter(Boolean)).toHaveLength(1);
    a.destroy();
    b.destroy();
  });
});
