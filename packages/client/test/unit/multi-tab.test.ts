// Multi-tab (§5.2, audit F9): two GameClients on the SAME player sharing one origin (world.ls),
// one Web Locks and one BroadcastChannel. Only the leader writes: a follower — demoted or booted as
// one — sends NO saves, beacons, journal ships or integrity telemetry and never writes the shared
// slot; what it queues (journal entries, game_error events) is held and shipped once it leads.
import { describe, expect, it } from 'vitest';
import type { SaveWriteBody } from '@foundation/contracts';
import { makeWorld, type World } from '../helpers/world.ts';
import { channelPeers, fakeLocks } from '../helpers/tabs.ts';
import { slotKey } from '../../src/storage/envelope.ts';

/** Per-tab request/beacon recorder (both tabs share the player key, so tag by tab). */
function tab(w: World) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const beacons: { url: string; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method: init?.method ?? 'GET', url: String(input), body });
    return w.ff.fetch(input, init);
  };
  const sendBeacon = (url: string, body: string): boolean => {
    beacons.push({ url, body });
    return true;
  };
  const mutating = (from = 0) => calls.slice(from).filter((c) => c.method !== 'GET');
  return { calls, beacons, fetch, sendBeacon, mutating };
}

const blob = (progress: number) =>
  JSON.stringify({ schemaVersion: 2, state: { count: progress, ticks: 0, progress } });

describe('multi-tab followers (audit F9): a follower never mutates', () => {
  it('after demotion the follower sends zero saves/beacons/journal/integrity across timers, saveNow, push, hidden and pagehide, never writes the shared slot; its queued journal + game_error are held and shipped after "Play here"; the leader keeps syncing', async () => {
    const w = makeWorld();
    const locks = fakeLocks();
    const channel = channelPeers();
    const A = tab(w);
    const B = tab(w);
    const { client: a, platform: pa } = w.newClient({
      locks,
      channel,
      fetch: A.fetch,
      sendBeacon: A.sendBeacon,
    });
    const { client: b, platform: pb } = w.newClient({
      locks,
      channel,
      fetch: B.fetch,
      sendBeacon: B.sendBeacon,
    });
    await a.boot();
    await b.boot();
    expect(a.leader.isLeader()).toBe(true);
    expect(b.leader.isLeader()).toBe(false);
    // the follower booted read-only: no write at all during its boot
    expect(B.mutating().length).toBe(0);
    a.dispatch({ type: 'inc', n: 3 });
    const r = await a.sync.push('important');
    expect(!r.skipped && r.verdict).toBe('synced');
    // journal entries + a game_error queued on A while it still leads → shipped normally later;
    // now B takes over: A is demoted
    await b.playHere();
    await w.timers.flush();
    expect(b.leader.isLeader()).toBe(true);
    expect(a.leader.isLeader()).toBe(false);
    expect(a.loop.running()).toBe(false);
    expect(b.state().progress).toBe(3);

    const markA = A.calls.length;
    const beaconsA = A.beacons.length;
    // everything a demoted tab could still try:
    a.dispatch({ type: 'inc', n: 100 }); // blocked
    expect(a.state().progress).toBe(3);
    a.saveNow('important');
    expect((await a.sync.push('important')).skipped).toBe('follower');
    expect(await a.sync.autosave()).toBe(false);
    expect(a.sync.beacon()).toBe(false);
    a.reportError(new Error('follower boom'));
    expect(a.journal.shouldShip()).toBe(true); // held, not lost
    expect(await a.sync.shipJournal()).toBe(false);
    pa.controls.setVisible(false); // hidden → (would) beacon + journal persist
    await w.timers.flush();
    pa.controls.firePageHide();
    await w.timers.flush();
    pa.controls.setVisible(true);
    // meanwhile the leader plays and syncs
    b.dispatch({ type: 'inc', n: 5 });
    await w.timers.advance(130_000); // autosave ×13, push ×2, integrity ×2, journal on both tabs
    await a.idle();
    await b.idle();
    // the follower: no mutating request, no beacon, the shared slot holds the LEADER's state
    expect(A.mutating(markA)).toEqual([]);
    expect(A.beacons.length).toBe(beaconsA);
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toContain('"progress":8');
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).not.toContain('"progress":3,');
    // the leader kept syncing
    expect(B.mutating().some((c) => c.method === 'PUT')).toBe(true);
    expect(w.server.anchor()?.progress).toBe(8);
    // the follower's queue is intact
    expect(a.journal.shouldShip()).toBe(true);
    expect(a.journal.breadcrumbs().some((x) => x.name === 'inc')).toBe(true);

    // "Play here" on A: it leads again, reloads the leader's slot, and ships what it held
    const markB = B.calls.length;
    await a.playHere();
    await w.timers.flush();
    expect(a.leader.isLeader()).toBe(true);
    expect(b.leader.isLeader()).toBe(false);
    expect(a.state().progress).toBe(8);
    await w.timers.advance(70_000);
    await a.idle();
    const shipped = A.calls.slice(markA);
    const journalShip = shipped.find((c) => c.url.endsWith('/v1/journal'));
    const integrity = shipped.find((c) => c.url.endsWith('/v1/telemetry/integrity'));
    expect(journalShip).toBeDefined();
    expect(integrity).toBeDefined();
    const events = (integrity!.body as { events: { kind: string; message: string }[] }).events;
    expect(events.some((e) => e.kind === 'game_error' && /follower boom/.test(e.message))).toBe(
      true,
    );
    expect(a.journal.shouldShip()).toBe(false);
    // and B, now the follower, mutates nothing (its timers stopped on demotion)
    b.reportError(new Error('b boom'));
    pb.controls.setVisible(false);
    await w.timers.flush();
    pb.controls.firePageHide();
    await w.timers.advance(130_000);
    expect(B.mutating(markB)).toEqual([]);
    expect(B.beacons.length).toBe(0);
    a.destroy();
    b.destroy();
  });

  it('with Web Locks available the LEADER decides leadership before the boot machine runs: the boot re-push happens and a boot-time adoption is persisted to the slot', async () => {
    const w = makeWorld();
    const locks = fakeLocks();
    const { client } = w.newClient({ locks });
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    w.server.down = true;
    await client.sync.autosave();
    const pending = client.sync.envelope().pending!;
    client.destroy();
    await w.timers.flush();
    expect(locks.holders()).toBe(0);
    w.server.down = false;
    const { client: c2 } = w.newClient({ locks });
    await c2.boot();
    expect(c2.leader.isLeader()).toBe(true);
    const puts = w.ff.calls.filter((c) => c.method === 'PUT').map((c) => c.body as SaveWriteBody);
    expect(puts.at(-1)?.commandId).toBe(pending.commandId);
    expect(c2.sync.envelope().lastVerdict).toBe('synced');
    expect(c2.sync.envelope().pending).toBeUndefined();
    c2.destroy();
    await w.timers.flush();
    // boot-time adoption is written to the slot immediately (not only at the first autosave)
    w.server.otherDeviceWrite(30, blob(30));
    const { client: c3 } = w.newClient({ locks });
    const r = await c3.boot();
    expect(r.decision.action).toBe('adopt_remote');
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toContain('"progress":30');
    c3.destroy();
  });

  it('a tab that boots as a follower (another tab holds the lock) does not re-push a pending from the shared slot and does not write it', async () => {
    const w = makeWorld();
    const locks = fakeLocks();
    const { client: leader } = w.newClient({ locks });
    await leader.boot();
    leader.dispatch({ type: 'inc', n: 4 });
    w.server.down = true;
    await leader.sync.autosave(); // pending in the shared slot
    const raw = w.ls!.getItem(slotKey('game', 'guest-1'));
    w.server.down = false;
    const F = tab(w);
    const { client: follower } = w.newClient({ locks, fetch: F.fetch, sendBeacon: F.sendBeacon });
    await follower.boot();
    expect(follower.leader.isLeader()).toBe(false);
    expect(F.mutating()).toEqual([]);
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toBe(raw);
    expect(follower.state().progress).toBe(4); // it reads the shared slot
    leader.destroy();
    follower.destroy();
  });
});
