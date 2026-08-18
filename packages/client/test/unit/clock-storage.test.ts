import { describe, expect, it } from 'vitest';
import { FakeClock } from '@foundation/testkit';
import { createClock, medianOffset, offlineCredit } from '../../src/clock/index.ts';
import {
  createStorage,
  memoryStorage,
  requestPersistentStorage,
  resetPersistGuard,
  storageMode,
} from '../../src/storage/tiers.ts';
import {
  defineSave,
  decodeFromWire,
  encodeForWire,
  gzipSupported,
  utf8Bytes,
} from '../../src/storage/codec.ts';
import {
  createSlot,
  lastKnownPlayerKey,
  slotKey,
  type CacheEnvelope,
} from '../../src/storage/envelope.ts';
import { createSpool, memorySpool } from '../../src/storage/spool.ts';
import { counterCodec } from '../helpers/fixtures.ts';

describe('clock (§5.2, ADR-009)', () => {
  it('now() equals deviceNow() until the first sample, then is server-anchored by the median offset', () => {
    const fake = new FakeClock(1_000_000);
    const c = createClock({ deviceNow: fake.now, monotonic: fake.now });
    expect(c.now()).toBe(1_000_000);
    expect(c.anchored()).toBe(false);
    // server is 5 s ahead; rtt 100 ms
    c.observe(1_000_000, 1_000_100, 1_005_050);
    expect(c.anchored()).toBe(true);
    expect(c.offset()).toBe(5_000);
    expect(c.now()).toBe(fake.now() + 5_000);
  });
  it('RTT filter: slow samples do not drag the median', () => {
    const samples = [
      { offset: 5000, rtt: 50 },
      { offset: 5010, rtt: 60 },
      { offset: 4990, rtt: 40 },
      { offset: 9000, rtt: 3000 }, // queued
      { offset: -2000, rtt: 2500 }, // queued
    ];
    expect(medianOffset(samples)).toBe(5000);
    expect(medianOffset([])).toBe(0);
    expect(medianOffset([{ offset: 7, rtt: 1 }])).toBe(7);
  });
  it('keeps at most maxSamples and ignores non-finite input', () => {
    const fake = new FakeClock(0);
    const c = createClock({ deviceNow: fake.now, monotonic: fake.now, maxSamples: 3 });
    for (let i = 0; i < 10; i++) c.observe(i, i + 10, i + 1000);
    expect(c.samples()).toBe(3);
    c.observe(NaN, 1, 2);
    expect(c.samples()).toBe(3);
  });
  it('mark()/sinceMark() are monotonic even when the source steps backwards', () => {
    let t = 100;
    const c = createClock({ deviceNow: () => t, monotonic: () => t });
    const m = c.mark();
    t = 150;
    expect(c.sinceMark(m)).toBe(50);
    t = 20; // clock jumped back
    expect(c.sinceMark(m)).toBe(50);
    expect(c.mark()).toBeGreaterThanOrEqual(m);
  });
  it('offlineCredit = min(deviceGap, serverGap + tolerance), never negative', () => {
    expect(offlineCredit(10_000, 5_000, 1_000)).toBe(6_000);
    expect(offlineCredit(3_000, 5_000, 1_000)).toBe(3_000);
    expect(offlineCredit(-5, 5_000, 0)).toBe(0);
    expect(offlineCredit(5_000, -5, 100)).toBe(100);
    expect(offlineCredit(NaN, 5, 5)).toBe(0);
  });
});

describe('storage tiers (§5.2, ADR-005)', () => {
  it('memory shim when localStorage is null; mode reported', () => {
    const t = createStorage({ localStorage: null });
    expect(storageMode(t)).toBe('memory');
    expect(t.set('k', 'v').ok).toBe(false);
    expect(t.get('k')).toBe('v');
    t.remove('k');
    expect(t.get('k')).toBeNull();
  });
  it('blocked storage (throws on access) → memory shim', () => {
    const boom = (): never => {
      const e = new Error('blocked');
      e.name = 'SecurityError';
      throw e;
    };
    const t = createStorage({
      localStorage: {
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        key: boom,
        get length(): number {
          return boom();
        },
      },
    });
    expect(t.mode).toBe('memory');
    expect(t.lastError()).toContain('blocked');
  });
  it('quota exceeded on set: reported, overlay keeps the value, tier degraded but still local', () => {
    const mem = memoryStorage();
    let full = false;
    const ls = {
      ...mem,
      setItem(k: string, v: string) {
        if (full) {
          const e = new Error('QuotaExceededError');
          e.name = 'QuotaExceededError';
          throw e;
        }
        mem.setItem(k, v);
      },
      get length() {
        return mem.length;
      },
    };
    const t = createStorage({ localStorage: ls });
    expect(t.mode).toBe('local');
    expect(t.set('a', '1').ok).toBe(true);
    full = true;
    const r = t.set('a', '2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('quota');
    expect(t.get('a')).toBe('2');
    expect(t.degraded()).toBe(true);
    expect(t.mode).toBe('local');
    expect(mem.getItem('a')).toBe('1');
  });
  it('storage that becomes blocked mid-session falls back to memory', () => {
    const mem = memoryStorage();
    let blocked = false;
    const ls = {
      ...mem,
      setItem(k: string, v: string) {
        if (blocked) throw new Error('SecurityError');
        mem.setItem(k, v);
      },
      get length() {
        return mem.length;
      },
    };
    const t = createStorage({ localStorage: ls });
    blocked = true;
    expect(t.set('x', '1').ok).toBe(false);
    expect(t.mode).toBe('memory');
  });
  it('a value the primary accepted is read back from the primary: a sibling tab\'s later write to the shared localStorage is visible (multi-tab "Play here" reload)', () => {
    const shared = memoryStorage();
    const tabA = createStorage({ localStorage: shared });
    const tabB = createStorage({ localStorage: shared });
    expect(tabA.set('k', 'from-a').ok).toBe(true);
    expect(tabB.get('k')).toBe('from-a');
    expect(tabB.set('k', 'from-b').ok).toBe(true);
    expect(tabA.get('k')).toBe('from-b');
    tabB.remove('k');
    expect(tabA.get('k')).toBeNull();
    // memory mode still reads its own overlay
    const mem = createStorage({ localStorage: null });
    mem.set('m', '1');
    expect(mem.get('m')).toBe('1');
  });
  it('keys(prefix) merges overlay + primary', () => {
    const t = createStorage({ localStorage: memoryStorage() });
    t.set('foundation:g:slot:a', '1');
    t.set('other', '2');
    expect(t.keys('foundation:')).toEqual(['foundation:g:slot:a']);
  });
  it('navigator.storage.persist() is requested once and guarded', async () => {
    resetPersistGuard();
    let calls = 0;
    const nav = { storage: { persist: async () => (calls++, true) } };
    expect(await requestPersistentStorage(nav)).toBe(true);
    expect(await requestPersistentStorage(nav)).toBeNull();
    expect(calls).toBe(1);
    resetPersistGuard();
    expect(await requestPersistentStorage({})).toBeNull();
    resetPersistGuard();
    expect(
      await requestPersistentStorage({
        storage: { persist: async () => Promise.reject(new Error('x')) },
      }),
    ).toBeNull();
  });
  it('slot naming is origin-scoped by game + player', () => {
    expect(slotKey('g1', 'p1')).toBe('foundation:g1:slot:p1');
    expect(lastKnownPlayerKey('g1')).toBe('foundation:g1:lastKnownPlayerId');
  });
});

describe('codec: defineSave + numbered migrations + trialDeserialize (§11)', () => {
  it('encodes canonical JSON {schemaVersion, state} and decodes it back', () => {
    const blob = counterCodec.encode({ count: 2, ticks: 1, progress: 2 });
    expect(JSON.parse(blob)).toEqual({
      schemaVersion: 2,
      state: { count: 2, ticks: 1, progress: 2 },
    });
    expect(counterCodec.decode(blob)).toEqual({ count: 2, ticks: 1, progress: 2 });
  });
  it('migrates an older schema forward through numbered steps', () => {
    const r = counterCodec.trialDeserialize(
      JSON.stringify({ schemaVersion: 1, state: { total: 7, progress: 7 } }),
    );
    expect(r.ok && r.migrated).toBe(true);
    if (r.ok) expect(r.state).toEqual({ count: 7, ticks: 0, progress: 7 });
  });
  it('trialDeserialize never throws: not json / not object / bad version / newer schema / missing migration / failing migration / invalid state', () => {
    expect(counterCodec.trialDeserialize('nope')).toMatchObject({ ok: false, reason: 'not_json' });
    expect(counterCodec.trialDeserialize('[1]')).toMatchObject({ ok: false, reason: 'not_object' });
    expect(counterCodec.trialDeserialize('{"state":{}}')).toMatchObject({
      ok: false,
      reason: 'bad_schema_version',
    });
    expect(counterCodec.trialDeserialize('{"schemaVersion":3,"state":{}}')).toMatchObject({
      ok: false,
      reason: 'newer_schema',
    });
    const gap = defineSave<{ v: number }>({ schemaVersion: 3, migrations: { 2: (o) => o } });
    expect(gap.trialDeserialize('{"schemaVersion":1,"state":{"v":1}}')).toMatchObject({
      ok: false,
      reason: 'missing_migration',
    });
    const boom = defineSave<{ v: number }>({
      schemaVersion: 2,
      migrations: {
        1: () => {
          throw new Error('bad');
        },
      },
    });
    expect(boom.trialDeserialize('{"schemaVersion":1,"state":{}}')).toMatchObject({
      ok: false,
      reason: 'migration_failed',
    });
    expect(
      counterCodec.trialDeserialize('{"schemaVersion":2,"state":{"count":"x"}}'),
    ).toMatchObject({ ok: false, reason: 'invalid_state' });
    expect(() => counterCodec.decode('nope')).toThrow(/not_json/);
  });
  it('custom encode/decode round-trips through the blob', () => {
    const c = defineSave<{ set: Set<number> }>({
      schemaVersion: 1,
      encode: (s) => ({ items: [...s.set] }),
      decode: (r) => ({ set: new Set((r as { items: number[] }).items) }),
    });
    expect(c.decode(c.encode({ set: new Set([1, 2]) })).set.has(2)).toBe(true);
  });
  it('rejects a non-positive schemaVersion', () => {
    expect(() => defineSave({ schemaVersion: 0 })).toThrow();
  });
  it('utf8Bytes counts multi-byte characters', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('😀')).toBe(4);
  });
  it('encodeForWire: json by default; gzip only when supported, requested and worthwhile', async () => {
    const small = await encodeForWire('{"a":1}', { gzip: true });
    expect(small.enc).toBe('json');
    const big = JSON.stringify({ s: 'x'.repeat(5000) });
    const wire = await encodeForWire(big, { gzip: true });
    if (gzipSupported()) {
      expect(wire.enc).toBe('gzip+b64');
      expect(wire.encBytes).toBeLessThan(big.length);
      expect(await decodeFromWire(wire.enc, wire.blob)).toBe(big);
    } else {
      expect(wire.enc).toBe('json');
    }
    expect(await decodeFromWire('json', big)).toBe(big);
  });
});

describe('slot envelope read/write', () => {
  const env: CacheEnvelope<{ count: number; ticks: number; progress: number }> = {
    format: 1,
    gameId: 'g',
    playerId: 'p',
    schemaVersion: 2,
    generation: 1,
    state: { count: 1, ticks: 0, progress: 1 },
    progress: 1,
    savedAt: 5,
    dirty: true,
    lastAckedSeq: 3,
    sessionId: 's',
    clientSeq: 4,
    ratchetFloor: { playerId: 'p', generation: 1, progress: 1 },
    lastVerdict: 'synced',
    lastSyncedAt: 4,
    pending: {
      commandId: 'c',
      encodedBlob: '{}',
      enc: 'json',
      progress: 1,
      savedAt: 5,
      reason: 'autosave',
      clientSeq: 4,
      generation: 1,
      schemaVersion: 2,
    },
  };
  it('round-trips and refuses wrong owners / corrupt / incompatible', () => {
    const t = createStorage({ localStorage: memoryStorage() });
    const slot = createSlot(t, slotKey('g', 'p'), counterCodec, { gameId: 'g', playerId: 'p' });
    expect(slot.read()).toMatchObject({ ok: false, reason: 'empty' });
    expect(slot.write(env).ok).toBe(true);
    const r = slot.read();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope).toEqual(env);
      expect(r.migrated).toBe(false);
    }
    const other = createSlot(t, slotKey('g', 'p'), counterCodec, { gameId: 'g', playerId: 'q' });
    expect(other.read()).toMatchObject({ ok: false, reason: 'wrong_owner' });
    t.set(slotKey('g', 'p'), '{not json');
    expect(slot.read()).toMatchObject({ ok: false, reason: 'corrupt' });
    t.set(slotKey('g', 'p'), JSON.stringify({ format: 99 }));
    expect(slot.read()).toMatchObject({ ok: false, reason: 'incompatible' });
    slot.clear();
    expect(slot.read()).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('migrates an older schema envelope on read (dirty so it gets re-pushed) and drops an old-schema pending', () => {
    const t = createStorage({ localStorage: memoryStorage() });
    t.set(
      slotKey('g', 'p'),
      JSON.stringify({
        ...env,
        schemaVersion: 1,
        state: { total: 9, progress: 9 },
        dirty: false,
        pending: { ...env.pending, schemaVersion: 1 },
      }),
    );
    const slot = createSlot(t, slotKey('g', 'p'), counterCodec, { gameId: 'g', playerId: 'p' });
    const r = slot.read();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migrated).toBe(true);
      expect(r.envelope.state).toEqual({ count: 9, ticks: 0, progress: 9 });
      expect(r.envelope.schemaVersion).toBe(2);
      expect(r.envelope.dirty).toBe(true);
      expect(r.envelope.pending).toBeUndefined();
    }
  });
});

describe('journal spool (IndexedDB optional → memory)', () => {
  it('memory spool when indexedDB is absent', async () => {
    const s = await createSpool(null);
    expect(s.backend).toBe('memory');
    await s.put('k', 'v');
    expect(await s.get('k')).toBe('v');
    await s.delete('k');
    expect(await s.get('k')).toBeNull();
  });
  it('falls back to memory when open throws', async () => {
    const s = await createSpool({
      open() {
        throw new Error('blocked');
      },
    });
    expect(s.backend).toBe('memory');
    expect((await memorySpool().get('x')) ?? null).toBeNull();
  });
  it('uses IndexedDB when available (fake-indexeddb)', async () => {
    const { indexedDB } = await import('fake-indexeddb');
    const s = await createSpool(indexedDB);
    expect(s.backend).toBe('indexeddb');
    await s.put('journal', '[1]');
    expect(await s.get('journal')).toBe('[1]');
    await s.delete('journal');
    expect(await s.get('journal')).toBeNull();
  });
});
