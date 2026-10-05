import { beforeEach, describe, expect, it, vi } from 'vitest';

const encoding = vi.hoisted(() => ({
  calls: [] as Array<{
    json: string;
    resolve: (wire: { enc: 'json'; blob: string; bytes: number; encBytes: number }) => void;
  }>,
}));

vi.mock('../../src/storage/codec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/storage/codec.ts')>();
  return {
    ...actual,
    encodeForWire: (json: string) =>
      new Promise((resolve) => {
        encoding.calls.push({
          json,
          resolve: resolve as (wire: {
            enc: 'json';
            blob: string;
            bytes: number;
            encBytes: number;
          }) => void,
        });
      }),
  };
});

import { makeWorld } from '../helpers/world.ts';
import { counterEngine } from '../helpers/fixtures.ts';
import { slotKey } from '../../src/storage/envelope.ts';

const finish = (call: (typeof encoding.calls)[number]): void => {
  call.resolve({
    enc: 'json',
    blob: call.json,
    bytes: call.json.length,
    encBytes: call.json.length,
  });
};

describe('sync client — asynchronous snapshot ordering', () => {
  beforeEach(() => {
    encoding.calls.length = 0;
  });

  it('a slower older encoding cannot replace the newer pending snapshot or persisted slot', async () => {
    const w = makeWorld();
    const engine = counterEngine();
    const apply = engine.apply;
    engine.apply = (state, action, ctx) => {
      const result = apply(state, action, ctx);
      if (action.type !== 'inc') return result;
      return {
        ...result,
        state: { ...result.state, note: action.n === 1 ? 'old'.repeat(2_000) : 'new' },
      };
    };
    const { client } = w.newClient({ engine, sync: { gzip: true } });
    await client.boot();

    client.dispatch({ type: 'inc', n: 1 });
    const older = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));

    client.dispatch({ type: 'inc', n: 2 });
    const newer = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(2));
    expect(encoding.calls[0]!.json.length).toBeGreaterThan(encoding.calls[1]!.json.length);

    finish(encoding.calls[1]!);
    await newer;
    const newerCommandId = client.sync.envelope().pending!.commandId;
    expect(client.sync.envelope().progress).toBe(3);

    finish(encoding.calls[0]!);
    await older;

    expect(client.sync.envelope().progress).toBe(3);
    expect(client.sync.envelope().pending?.commandId).toBe(newerCommandId);
    const stored = JSON.parse(w.ls!.getItem(slotKey('game', 'guest-1'))!) as {
      progress: number;
      pending: { commandId: string };
    };
    expect(stored.progress).toBe(3);
    expect(stored.pending.commandId).toBe(newerCommandId);
  });

  it('gameplay published while encoding is pending remains dirty after that snapshot commits', async () => {
    const w = makeWorld();
    const { client } = w.newClient({ sync: { gzip: true } });
    await client.boot();

    client.dispatch({ type: 'inc', n: 1 });
    const saving = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));
    client.dispatch({ type: 'inc', n: 1 });

    finish(encoding.calls[0]!);
    await saving;

    expect(client.sync.envelope().progress).toBe(1);
    expect(client.sync.needsPush()).toBe(true);
    const nextSave = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(2));
    finish(encoding.calls[1]!);
    await nextSave;
    expect(client.sync.envelope().progress).toBe(2);
  });

  it('an older encoding that finishes first defers to the newer capture instead of failing', async () => {
    const w = makeWorld();
    const { client } = w.newClient({ sync: { gzip: true } });
    await client.boot();
    const autosaved: Array<{ ok: boolean; reason?: string }> = [];
    client.sync.onEvent((e) => {
      if (e.type === 'autosaved')
        autosaved.push(e.ok ? { ok: true } : { ok: false, reason: e.reason });
    });
    expect(client.sync.envelope().pending).toBeUndefined();

    client.dispatch({ type: 'inc', n: 1 });
    const older = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));
    client.dispatch({ type: 'inc', n: 1 });
    const newer = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(2));

    // Compression finishes in submission order: the older capture completes first.
    finish(encoding.calls[0]!);
    finish(encoding.calls[1]!);

    expect(await older).toBe(true);
    expect(await newer).toBe(true);
    expect(autosaved).toEqual([{ ok: true }, { ok: true }]);
    expect(client.sync.envelope().progress).toBe(2);
    const stored = JSON.parse(w.ls!.getItem(slotKey('game', 'guest-1'))!) as { progress: number };
    expect(stored.progress).toBe(2);
  });

  it('a push whose encoding is superseded sends the newer snapshot instead of skipping', async () => {
    const w = makeWorld();
    const { client } = w.newClient({ sync: { gzip: true } });
    await client.boot();

    client.dispatch({ type: 'inc', n: 1 });
    const pushing = client.sync.push('important');
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));
    client.dispatch({ type: 'inc', n: 1 });
    const saving = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(2));

    finish(encoding.calls[0]!);
    finish(encoding.calls[1]!);

    expect(await saving).toBe(true);
    const report = await pushing;
    expect(report.skipped).toBeUndefined();
    expect(report.skipped === undefined && report.verdict).toBe('synced');
    expect(w.server.anchor()?.progress).toBe(2);
  });

  it('a capture superseded by a generation swap still reports the failure', async () => {
    const w = makeWorld();
    const { client } = w.newClient({ sync: { gzip: true } });
    await client.boot();
    const autosaved: Array<{ ok: boolean; reason?: string }> = [];
    client.sync.onEvent((e) => {
      if (e.type === 'autosaved')
        autosaved.push(e.ok ? { ok: true } : { ok: false, reason: e.reason });
    });

    client.dispatch({ type: 'inc', n: 1 });
    const older = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));
    client.sync.startNew(client.sync.envelope().generation + 1, 'start_new');

    finish(encoding.calls[0]!);
    expect(await older).toBe(false);
    expect(autosaved).toEqual([{ ok: false, reason: 'superseded' }]);
    expect(client.sync.envelope().progress).toBe(0);
  });

  it('a synchronous teardown snapshot supersedes an older encoding still in progress', async () => {
    const w = makeWorld();
    const { client } = w.newClient({ sync: { gzip: true } });
    await client.boot();

    client.dispatch({ type: 'inc', n: 1 });
    const older = client.sync.autosave();
    await vi.waitFor(() => expect(encoding.calls).toHaveLength(1));
    client.dispatch({ type: 'inc', n: 1 });

    expect(client.sync.beacon()).toBe(true);
    const teardownPending = client.sync.envelope().pending!;
    expect(teardownPending.progress).toBe(2);
    expect(teardownPending.reason).toBe('teardown');

    finish(encoding.calls[0]!);
    await older;

    expect(client.sync.envelope().progress).toBe(2);
    expect(client.sync.envelope().pending?.commandId).toBe(teardownPending.commandId);
    expect(w.beacons).toHaveLength(1);
  });
});
