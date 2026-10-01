import { describe, expect, it } from 'vitest';
import { makeWorld } from '../helpers/world.ts';
import { damagedSlotKey, slotKey } from '../../src/storage/envelope.ts';

type Damage = (raw: Record<string, unknown>) => string;
const DAMAGES: [string, Damage][] = [
  ['a truncated slot', (raw) => JSON.stringify(raw).slice(0, 40)],
  ['an invalid state', (raw) => JSON.stringify({ ...raw, state: { count: 'seven' } })],
  // schema 1 migrates through counterCodec's 1→2 step, which throws on a null state
  ['a failed migration', (raw) => JSON.stringify({ ...raw, schemaVersion: 1, state: null })],
  ['an unknown envelope format', (raw) => JSON.stringify({ ...raw, format: 'v1' })],
];

describe('a damaged local save (not from a newer build) never blocks boot', () => {
  it.each(DAMAGES)(
    '%s is backed up once, reported, and boot continues on the server copy',
    async (_name, damage) => {
      const w = makeWorld();
      const first = w.newClient().client;
      await first.boot();
      first.dispatch({ type: 'inc', n: 7 });
      await first.sync.push('important');
      first.destroy();
      const key = slotKey('game', 'guest-1');
      const damaged = damage(JSON.parse(w.ls!.getItem(key)!) as Record<string, unknown>);
      w.ls!.setItem(key, damaged);

      const errors: { error: unknown; detail: Record<string, unknown> | undefined }[] = [];
      const next = w.newClient({
        onError: (error, detail) => errors.push({ error, detail }),
      }).client;
      const result = await next.boot();

      expect(result.decision.action).toBe('adopt_remote');
      expect(next.bootMachine.state().phase).toBe('live');
      expect(next.state().count).toBe(7);
      expect(w.ls!.getItem(damagedSlotKey('game', 'guest-1'))).toBe(damaged);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.detail).toMatchObject({
        operation: 'local_save_damaged',
        reason: 'corrupt',
        chars: damaged.length,
        backedUp: true,
      });
      // the slot holds the server save again, so the next boot reads it cleanly
      next.dispatch({ type: 'inc', n: 1 });
      await next.sync.autosave();
      next.destroy();
      const again = w.newClient().client;
      expect((await again.boot()).decision.action).toBe('keep_local');
      expect(again.state().count).toBe(8);
      again.destroy();
    },
  );

  it('waits for the cloud (retry) instead of an update when the server is unreachable', async () => {
    const w = makeWorld();
    const first = w.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 5 });
    await first.sync.push('important');
    first.destroy();
    const key = slotKey('game', 'guest-1');
    w.ls!.setItem(key, '{"format":1,"gameId":"game"');
    w.server.down = true;
    const next = w.newClient().client;
    const booting = next.boot();
    await w.timers.advance(3_000);
    expect(next.bootMachine.state()).toMatchObject({
      phase: 'cloudUnreachable',
      blockedReason: null,
    });
    w.server.down = false;
    next.bootMachine.retry();
    await booting;
    expect(next.state().count).toBe(5);
    expect(w.ls!.getItem(damagedSlotKey('game', 'guest-1'))).toBe('{"format":1,"gameId":"game"');
    next.destroy();
  });
});

describe('incompatible saves preserve the original and stop writers', () => {
  it('blocks local newer state before replacing it or creating a fresh save', async () => {
    const w = makeWorld();
    const first = w.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 7 });
    await first.sync.autosave();
    first.destroy();
    const key = slotKey('game', 'guest-1');
    const raw = JSON.parse(w.ls!.getItem(key)!);
    raw.schemaVersion = 99;
    const saved = JSON.stringify(raw);
    w.ls!.setItem(key, saved);
    const puts = w.ff.calls.filter((call) => call.method === 'PUT').length;
    const next = w.newClient().client;
    await expect(next.boot()).rejects.toThrow(/update is required/i);
    expect(next.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    next.dispatch({ type: 'inc', n: 10 });
    expect(w.ls!.getItem(key)).toBe(saved);
    expect(w.ff.calls.filter((call) => call.method === 'PUT')).toHaveLength(puts);
    next.destroy();
  });

  it('blocks a local slot from a newer envelope format without backing it up', async () => {
    const w = makeWorld();
    const first = w.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 2 });
    await first.sync.autosave();
    first.destroy();
    const key = slotKey('game', 'guest-1');
    const saved = JSON.stringify({ ...JSON.parse(w.ls!.getItem(key)!), format: 2 });
    w.ls!.setItem(key, saved);
    const next = w.newClient().client;
    await expect(next.boot()).rejects.toThrow(/update is required/i);
    expect(next.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    expect(w.ls!.getItem(key)).toBe(saved);
    expect(w.ls!.getItem(damagedSlotKey('game', 'guest-1'))).toBeNull();
    next.destroy();
  });

  it('blocks a remote newer save without writing over its head', async () => {
    const w = makeWorld();
    w.server.otherDeviceWrite(
      20,
      JSON.stringify({ schemaVersion: 99, state: { count: 20, ticks: 0, progress: 20 } }),
    );
    const head = w.server.anchor();
    const client = w.newClient().client;
    await expect(client.boot()).rejects.toThrow(/blocked|update/i);
    expect(client.bootMachine.state().blockedReason).toBe('update_required');
    expect(client.sync.halted()).toBe('update_required');
    expect(await client.sync.autosave()).toBe(false);
    expect(w.server.anchor()).toEqual(head);
    client.destroy();
  });

  it('inspects and preserves a future remote blob even when the local save is deeper', async () => {
    const w = makeWorld();
    const first = w.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 9 });
    await first.sync.autosave();
    first.destroy();
    const key = slotKey('game', 'guest-1');
    const local = w.ls!.getItem(key);
    w.server.otherDeviceWrite(
      3,
      JSON.stringify({
        schemaVersion: 99,
        state: { count: 3, ticks: 0, progress: 3 },
      }),
    );
    const remote = w.server.anchor();

    const next = w.newClient().client;
    await expect(next.boot()).rejects.toThrow(/update/i);

    expect(next.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    expect(next.sync.halted()).toBe('update_required');
    expect(w.ls!.getItem(key)).toBe(local);
    expect(w.server.anchor()).toEqual(remote);
    next.destroy();
  });

  it('stops a live client if another writer replaces its local slot with a newer schema', async () => {
    const w = makeWorld();
    const client = w.newClient().client;
    await client.boot();
    client.dispatch({ type: 'inc', n: 3 });
    await client.sync.autosave();
    const key = slotKey('game', 'guest-1');
    const raw = JSON.parse(w.ls!.getItem(key)!);
    raw.schemaVersion = 99;
    const saved = JSON.stringify(raw);
    w.ls!.setItem(key, saved);
    const restore = client.restore;
    await client.playHere();
    expect(client.bootMachine.state().phase).toBe('blocked');
    client.dispatch({ type: 'inc', n: 10 });
    expect(client.state().count).toBe(3);
    expect(await client.sync.autosave()).toBe(false);
    expect(
      await restore.forwardOnly(
        JSON.stringify({
          schemaVersion: 2,
          state: { count: 30, ticks: 0, progress: 30 },
        }),
      ),
    ).toEqual({ ok: false, reason: 'blocked' });
    expect(await client.restartJourney()).toEqual({ ok: false, reason: 'not_live' });
    const writes = w.ff.calls.filter((call) => call.method !== 'GET').length;
    const beacons = w.beacons.length;
    client.reportError(new Error('held while update is required'));
    await w.timers.advance(61_000);
    await client.idle();
    expect(w.ff.calls.filter((call) => call.method !== 'GET')).toHaveLength(writes);
    expect(w.beacons).toHaveLength(beacons);
    expect(w.ls!.getItem(key)).toBe(saved);
    client.destroy();
  });

  it('blocks when a live recheck discovers a newer remote save', async () => {
    const w = makeWorld();
    const client = w.newClient().client;
    await client.boot();
    client.dispatch({ type: 'inc', n: 4 });
    await client.sync.push('important');
    const key = slotKey('game', 'guest-1');
    const local = w.ls!.getItem(key);
    w.server.otherDeviceWrite(
      20,
      JSON.stringify({
        schemaVersion: 99,
        state: { count: 20, ticks: 0, progress: 20 },
      }),
    );
    const head = w.server.anchor();

    await client.bootMachine.recheck();

    expect(client.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    expect(client.sync.halted()).toBe('update_required');
    expect(w.ls!.getItem(key)).toBe(local);
    expect(w.server.anchor()).toEqual(head);
    client.destroy();
  });

  it('preserves an incompatible target slot during an identity switch', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    const guestKey = slotKey('game', 'guest-1');
    const targetKey = slotKey('game', 'acct-newer-local');
    const target = JSON.parse(w.ls!.getItem(guestKey)!);
    target.playerId = 'acct-newer-local';
    target.schemaVersion = 99;
    const saved = JSON.stringify(target);
    w.ls!.setItem(targetKey, saved);

    platform.controls.switchIdentity('acct-newer-local', true);
    await w.timers.flush();
    await client.idle();

    expect(client.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    client.dispatch({ type: 'inc', n: 10 });
    client.saveNow('important');
    await w.timers.flush();
    expect(w.ls!.getItem(targetKey)).toBe(saved);
    expect(w.ls!.getItem(guestKey)).not.toBeNull();
    client.destroy();
  });

  it('blocks an identity switch to an account with a newer remote save', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    const account = w.server.forPlayer('acct-newer-remote');
    account.otherDeviceWrite(
      15,
      JSON.stringify({
        schemaVersion: 99,
        state: { count: 15, ticks: 0, progress: 15 },
      }),
    );
    const head = account.anchor();

    platform.controls.switchIdentity('acct-newer-remote', true);
    await w.timers.flush();
    await client.idle();

    expect(client.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    expect(client.sync.halted()).toBe('update_required');
    expect(account.anchor()).toEqual(head);
    expect(w.ls!.getItem(slotKey('game', 'acct-newer-remote'))).toBeNull();
    client.destroy();
  });

  it('keeps update-required terminal when a reconciliation prompt was already waiting', async () => {
    const w = makeWorld();
    const client = w.newClient().client;
    await client.boot();
    client.dispatch({ type: 'inc', n: 3 });
    await client.sync.autosave();
    w.server.otherDeviceWrite(
      12,
      JSON.stringify({
        schemaVersion: 2,
        state: { count: 12, ticks: 0, progress: 12 },
      }),
    );
    const checking = client.bootMachine.recheck();
    await w.timers.flush();
    expect(client.bootMachine.state().phase).toBe('prompt');

    client.bootMachine.requireUpdate();
    await checking;
    client.bootMachine.resolvePrompt('adopt_remote');

    expect(client.bootMachine.state()).toMatchObject({
      phase: 'blocked',
      blockedReason: 'update_required',
    });
    client.destroy();
  });
});
