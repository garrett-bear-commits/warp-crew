import { describe, expect, it } from 'vitest';
import type { SaveBeaconBody, SaveWriteBody } from '@foundation/contracts';
import { counterCodec, counterEngine, type CounterState } from '../helpers/fixtures.ts';
import { makeWorld } from '../helpers/world.ts';
import { slotKey } from '../../src/storage/envelope.ts';

const remoteBlob = (state: CounterState): string => counterCodec.encode(state);

describe('opt-in equal-progress reconciliation', () => {
  it('treats an accepted teardown beacon matching the local pending command as its acknowledgement', async () => {
    const world = makeWorld();
    const first = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    await first.boot();
    first.dispatch({ type: 'pause', on: true });
    expect(first.sync.beacon()).toBe(true);
    const beacon = JSON.parse(world.beacons[0]!.body) as SaveBeaconBody;
    const pendingId = first.sync.envelope().pending!.commandId;
    expect(beacon.commandId).toBe(pendingId);
    await world.deliverBeacons();
    first.destroy();

    const second = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    const result = await second.boot();

    expect(result.decision).toMatchObject({
      action: 'keep_local',
      reason: 'local_deeper_or_equal',
    });
    expect(second.bootMachine.state().phase).toBe('live');
    expect(second.state()).toMatchObject({ progress: 0, note: 'paused' });
    expect(second.sync.envelope().pending).toBeUndefined();
    const replay = world.ff.calls
      .filter((call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'))
      .at(-1)!.body as SaveWriteBody;
    expect(replay.commandId).toBe(pendingId);
    expect(replay.blob).toBe(beacon.blob);
    expect(world.server.rows).toHaveLength(1);
    second.destroy();
  });

  it('recognizes an older own pending command delivered after the newer local pending', async () => {
    const world = makeWorld();
    const first = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    await first.boot();

    first.dispatch({ type: 'pause', on: true });
    expect(first.sync.beacon()).toBe(true);
    const older = JSON.parse(world.beacons[0]!.body) as SaveBeaconBody;
    first.dispatch({ type: 'pause', on: false });
    expect(first.sync.beacon()).toBe(true);
    const newer = JSON.parse(world.beacons[1]!.body) as SaveBeaconBody;
    expect(newer.commandId).not.toBe(older.commandId);
    expect(first.sync.envelope().pending?.ancestors).toContainEqual(
      expect.objectContaining({ commandId: older.commandId, clientSeq: older.clientSeq }),
    );

    // Network completion is reversed: the older own command becomes the equal-progress head even
    // though the slot correctly retains the newer pending snapshot.
    for (const beacon of [world.beacons[1]!, world.beacons[0]!]) {
      await world.ff.fetch(beacon.url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: beacon.body,
      });
    }
    expect(world.server.anchor()?.commandId).toBe(older.commandId);
    first.destroy();

    const second = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    const result = await second.boot();

    expect(result.decision).toMatchObject({ action: 'keep_local', reassertPending: true });
    expect(second.bootMachine.state().phase).toBe('live');
    expect(second.state().note).toBeUndefined();
    expect(second.sync.envelope().pending).toBeUndefined();
    const replay = world.ff.calls
      .filter((call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'))
      .at(-1)!.body as SaveWriteBody;
    expect(replay.commandId).not.toBe(newer.commandId);
    expect(replay.blob).toBe(newer.blob);
    expect(world.server.anchor()?.commandId).toBe(replay.commandId);
    second.destroy();

    // The descendant push must make the newest body the durable head. With no intervening tick or
    // user action, another reload remains live and cannot adopt the late older snapshot.
    const third = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    const thirdResult = await third.boot();
    expect(thirdResult.decision.action).toBe('keep_local');
    expect(third.bootMachine.state().phase).toBe('live');
    expect(third.state().note).toBeUndefined();
    expect(third.sync.envelope().lastAckedSeq).toBe(world.server.anchor()!.seq);
    third.destroy();
  });

  it('still prompts when an equal-progress remote anchor has a different pending commandId', async () => {
    const world = makeWorld();
    const first = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    await first.boot();
    first.dispatch({ type: 'pause', on: true });
    expect(first.sync.beacon()).toBe(true);
    await world.deliverBeacons();
    first.destroy();

    const key = slotKey('game', 'guest-1');
    const stored = JSON.parse(world.ls!.getItem(key)!) as {
      pending: { commandId: string };
    };
    stored.pending.commandId = '00000000-0000-4000-8000-000000000099';
    world.ls!.setItem(key, JSON.stringify(stored));

    const second = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    const booting = second.boot();
    await world.timers.flush();
    expect(second.bootMachine.state().phase).toBe('prompt');
    expect(second.bootMachine.state().decision).toMatchObject({
      action: 'prompt',
      reason: 'remote_equal_newer_local_dirty',
    });

    second.bootMachine.resolvePrompt('adopt_remote');
    await booting;
    second.destroy();
  });

  it('adopts a newer equal-progress remote sequence on boot when local state is clean', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 1 });
    await first.sync.push('important');
    first.destroy();

    world.server.otherDeviceWrite(
      1,
      remoteBlob({ count: 41, ticks: 0, progress: 1, note: 'remote economy' }),
    );

    const second = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    const result = await second.boot();
    expect(result.decision).toMatchObject({
      action: 'adopt_remote',
      reason: 'remote_equal_newer_local_clean',
    });
    expect(second.state()).toMatchObject({ count: 41, progress: 1, note: 'remote economy' });
    expect(second.sync.envelope().lastAckedSeq).toBe(2);
    second.destroy();
  });

  it('freezes a live dirty client at an equal-progress prompt until the choice resolves', async () => {
    const world = makeWorld();
    const { client, platform } = world.newClient({ sync: { reconcileEqualProgress: true } });
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.push('important');
    world.server.otherDeviceWrite(
      1,
      remoteBlob({ count: 77, ticks: 0, progress: 1, note: 'remote economy' }),
    );
    client.dispatch({ type: 'noop' });

    const checking = client.bootMachine.recheck();
    await world.timers.flush();
    expect(client.bootMachine.state().phase).toBe('prompt');
    expect(client.bootMachine.state().decision?.reason).toBe('remote_equal_newer_local_dirty');
    expect(client.loop.running()).toBe(false);
    const before = client.state();
    const writesBefore = world.ff.calls.filter(
      (call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'),
    ).length;
    client.dispatch({ type: 'inc', n: 10 });
    expect(client.state()).toEqual(before);
    client.saveNow('important');
    platform.controls.setVisible(false);
    platform.controls.firePageHide();
    await world.timers.flush();
    expect(world.beacons).toHaveLength(0);
    await world.timers.advance(70_000);
    expect(
      world.ff.calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'))
        .length,
    ).toBe(writesBefore);

    client.bootMachine.resolvePrompt('adopt_remote');
    await checking;
    expect(client.bootMachine.state().phase).toBe('live');
    expect(client.loop.running()).toBe(true);
    expect(client.state()).toMatchObject({ count: 77, progress: 1, note: 'remote economy' });
    client.destroy();
  });

  it('retains the established keep-local behavior when the option is absent', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 1 });
    await first.sync.push('important');
    first.destroy();
    world.server.otherDeviceWrite(
      1,
      remoteBlob({ count: 99, ticks: 0, progress: 1, note: 'remote economy' }),
    );

    const second = world.newClient().client;
    const result = await second.boot();
    expect(result.decision).toMatchObject({
      action: 'keep_local',
      reason: 'local_deeper_or_equal',
    });
    expect(second.state().count).toBe(1);
    second.destroy();
  });
});

describe('opt-in boot offline resume', () => {
  it('hands one verified persisted gap to onGap before the live loop and keeps progress fixed', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 2 });
    await first.sync.push('important');
    first.destroy();
    world.clock.advance(3_600_000);

    let gaps = 0;
    const base = counterEngine();
    const resumedEngine = {
      ...base,
      onGap(state: CounterState, gap: { deviceSec: number; serverSec: number }) {
        gaps++;
        return {
          state: { ...state, note: `gap:${gap.deviceSec}:${gap.serverSec}` },
          effects: [],
        };
      },
    };
    const second = world.newClient({
      engine: resumedEngine,
      sync: { resumeOffline: true },
    }).client;
    const result = await second.boot();
    expect(gaps).toBe(1);
    expect(result.state.note).toBe('gap:3600:3600');
    expect(second.state().progress).toBe(2);
    second.loop.frame();
    expect(gaps).toBe(1);
    second.destroy();
  });

  it('uses the selected save timestamps when boot re-push replaces a dirty envelope', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 2 });
    await first.sync.push('important');
    first.destroy();

    const key = slotKey('game', 'guest-1');
    const stored = JSON.parse(world.ls!.getItem(key)!) as Record<string, unknown>;
    stored.dirty = true;
    world.ls!.setItem(key, JSON.stringify(stored));
    world.clock.advance(3_600_000);

    const second = world.newClient({ sync: { resumeOffline: true } }).client;
    const result = await second.boot();

    expect(result.state.note).toBe('gap:3600');
    const repush = world.ff.calls
      .filter((call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'))
      .at(-1)!.body as SaveWriteBody;
    expect(repush.savedAt).toBe(world.clock.now());
    const persisted = JSON.parse(world.ls!.getItem(key)!) as {
      state: CounterState;
      pending?: { encodedBlob: string };
    };
    expect(persisted.state.note).toBe('gap:3600');
    expect(persisted.pending?.encodedBlob).toContain('gap:3600');
    second.destroy();
  });

  it('keeps the offline anchor when boot reasserts a newer descendant snapshot', async () => {
    const world = makeWorld();
    const first = world.newClient({ sync: { reconcileEqualProgress: true } }).client;
    await first.boot();
    first.dispatch({ type: 'pause', on: true });
    expect(first.sync.beacon()).toBe(true);
    first.dispatch({ type: 'pause', on: false });
    expect(first.sync.beacon()).toBe(true);
    for (const beacon of [world.beacons[1]!, world.beacons[0]!]) {
      await world.ff.fetch(beacon.url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: beacon.body,
      });
    }
    first.destroy();
    world.clock.advance(3_600_000);

    const second = world.newClient({
      sync: { reconcileEqualProgress: true, resumeOffline: true },
    }).client;
    const result = await second.boot();

    expect(result.decision).toMatchObject({ action: 'keep_local', reassertPending: true });
    expect(result.state.note).toBe('gap:3600');
    const persisted = JSON.parse(world.ls!.getItem(slotKey('game', 'guest-1'))!) as {
      state: CounterState;
      pending?: { encodedBlob: string };
    };
    expect(persisted.state.note).toBe('gap:3600');
    expect(persisted.pending?.encodedBlob).toContain('gap:3600');
    second.destroy();
  });

  it('skips resume for a legacy envelope without a device timestamp', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 1 });
    await first.sync.push('important');
    first.destroy();
    const key = slotKey('game', 'guest-1');
    const stored = JSON.parse(world.ls!.getItem(key)!) as Record<string, unknown>;
    delete stored.deviceSavedAt;
    world.ls!.setItem(key, JSON.stringify(stored));
    world.clock.advance(3_600_000);

    let gaps = 0;
    const base = counterEngine();
    const second = world.newClient({
      engine: {
        ...base,
        onGap(state: CounterState) {
          gaps++;
          return { state, effects: [] };
        },
      },
      sync: { resumeOffline: true },
    }).client;
    await second.boot();
    expect(gaps).toBe(0);
    second.destroy();
  });

  it('skips resume when the saved timestamp was never server anchored', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 1 });
    await first.sync.push('important');
    first.destroy();
    const key = slotKey('game', 'guest-1');
    const stored = JSON.parse(world.ls!.getItem(key)!) as Record<string, unknown>;
    stored.savedAtServerAnchored = false;
    world.ls!.setItem(key, JSON.stringify(stored));
    world.clock.advance(3_600_000);

    let gaps = 0;
    const base = counterEngine();
    const second = world.newClient({
      engine: {
        ...base,
        onGap(state: CounterState) {
          gaps++;
          return { state, effects: [] };
        },
      },
      sync: { resumeOffline: true },
    }).client;
    await second.boot();
    expect(gaps).toBe(0);
    second.destroy();
  });

  it('a hung boot re-push holds boot for at most 3 s; the pre-gap snapshot still goes first and the gap is credited once', async () => {
    const world = makeWorld();
    const first = world.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 2 });
    world.server.down = true;
    await first.sync.push('important');
    const preGap = first.sync.envelope().pending!;
    expect(preGap).toBeDefined();
    first.destroy();
    world.server.down = false;
    world.clock.advance(3_600_000);

    // the save server answers the head check but holds the re-push
    let release: (() => void) | null = null;
    const realFetch = world.ff.fetch;
    const held: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT' && release === null) await new Promise<void>((r) => (release = r));
      return realFetch(input, init);
    };
    const notes: string[] = [];
    const base = counterEngine();
    const engine = {
      ...base,
      onGap(state: CounterState, gap: { deviceSec: number; serverSec: number }) {
        const note = `gap:${Math.round(gap.serverSec)}`;
        notes.push(note);
        return { state: { ...state, note }, effects: [] };
      },
    };
    const second = world.newClient({ fetch: held, engine, sync: { resumeOffline: true } }).client;
    const booting = second.boot();
    await world.timers.advance(2_900);
    expect(second.bootMachine.state().phase).toBe('reconciled');
    expect(release).not.toBeNull();
    await world.timers.advance(100);
    const result = await booting;
    expect(second.bootMachine.state().phase).toBe('live');
    expect(notes).toEqual(['gap:3603']);
    expect(result.state.note).toBe('gap:3603');
    // the credit is a newer pending, waiting behind the pre-gap snapshot still in flight
    const credited = second.sync.envelope().pending!;
    expect(credited.commandId).not.toBe(preGap.commandId);
    expect(credited.encodedBlob).toContain('gap:3603');

    release!();
    await world.timers.flush();
    await second.sync.push('timer');
    const sent = world.ff.calls
      .filter((call) => call.method === 'PUT' && call.url.endsWith('/v1/saves'))
      .map((call) => (call.body as SaveWriteBody).commandId);
    expect(sent.slice(-2)).toEqual([preGap.commandId, credited.commandId]);
    expect(world.server.anchor()?.commandId).toBe(credited.commandId);
    second.destroy();

    // a minute later the next boot resumes from the credited save: the hour is not credited again
    world.clock.advance(60_000);
    const third = world.newClient({ engine, sync: { resumeOffline: true } }).client;
    await third.boot();
    expect(notes).toEqual(['gap:3603', 'gap:60']);
    third.destroy();
  });
});
