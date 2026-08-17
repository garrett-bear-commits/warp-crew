import { describe, expect, it } from 'vitest';
import type { SaveWriteBody } from '@foundation/contracts';
import { makeWorld } from '../helpers/world.ts';
import { createSlot, slotKey } from '../../src/storage/envelope.ts';
import { counterCodec } from '../helpers/fixtures.ts';
import { waitForPhase } from '../../src/boot/machine.ts';
import type { ClientEvent } from '../../src/game-client.ts';
import type { CounterState } from '../helpers/fixtures.ts';
import type { IdentitySwitchOutcome } from '../../src/identity/switch.ts';

const blob = (progress: number) =>
  JSON.stringify({ schemaVersion: 2, state: { count: progress, ticks: 0, progress } });
const puts = (w: ReturnType<typeof makeWorld>) =>
  w.ff.calls.filter((c) => c.method === 'PUT').map((c) => c.body as SaveWriteBody);

describe('boot machine (§5.2 State lifecycle)', () => {
  it('phases: booting → identityReady → checkingCloud → reconciled → live; lastKnownPlayerId written; preview read-only', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    const phases: string[] = [];
    client.bootMachine.onChange((s) => {
      if (phases.at(-1) !== s.phase) phases.push(s.phase);
    });
    await client.boot();
    expect(phases).toEqual(['booting', 'identityReady', 'checkingCloud', 'reconciled', 'live']);
    expect(w.ls!.getItem('foundation:game:lastKnownPlayerId')).toBe('guest-1');
    // second boot paints a preview from the last known slot before identity confirms
    client.dispatch({ type: 'inc', n: 4 });
    await client.sync.autosave();
    client.destroy();
    const { client: c2 } = w.newClient();
    let preview: CounterState | null = null;
    c2.bootMachine.onChange((s) => {
      if (s.phase === 'booting') preview = s.preview;
    });
    await c2.boot();
    expect((preview as CounterState | null)?.count).toBe(4);
  });

  it('remote deeper + local clean → adopt_remote (blob fetched, trial-deserialised, floor moved)', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    await client.sync.push('important');
    client.destroy();
    w.server.otherDeviceWrite(30, blob(30));
    const { client: c2 } = w.newClient();
    const r = await c2.boot();
    expect(r.decision.action).toBe('adopt_remote');
    expect(c2.state().progress).toBe(30);
    expect(c2.sync.envelope().ratchetFloor?.progress).toBe(30);
    expect(c2.sync.envelope().lastAckedSeq).toBe(w.server.anchor()!.seq);
    // GET current?meta=1 first (bounded), then the blob
    const gets = w.ff.calls.filter(
      (c) => c.method === 'GET' && c.url.includes('/v1/saves/current'),
    );
    expect(gets.at(-2)?.url).toContain('meta=1');
    expect(gets.at(-1)?.url).not.toContain('meta=1');
  });

  it('remote deeper + local dirty → prompt; keep_local keeps and pushes local; adopt_remote adopts', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    await client.sync.push('important');
    client.dispatch({ type: 'inc', n: 1 }); // dirty, unpushed
    await client.sync.autosave();
    w.server.down = true;
    await client.sync.push('timer'); // pending stays
    w.server.down = false;
    client.destroy();
    w.server.otherDeviceWrite(30, blob(30));

    const { client: c2 } = w.newClient();
    const bootP = c2.boot();
    const st = await waitForPhase(c2.bootMachine, 'prompt', w.timers);
    expect(st.prompt).toEqual({
      local: { progress: 3, savedAt: expect.any(Number), generation: 0 },
      remote: { progress: 30, savedAt: expect.any(Number), seq: expect.any(Number), generation: 0 },
    });
    c2.bootMachine.resolvePrompt('keep_local');
    const r = await bootP;
    expect(r.decision.action).toBe('prompt');
    expect(c2.state().progress).toBe(3);
    // the boot re-push sent the local snapshot; the server refused it (regression) and kept it as evidence
    expect(puts(w).at(-1)?.progress).toBe(3);
    expect(w.server.rows.at(-1)?.disposition).toBe('stored_refused');
    c2.destroy();

    const { client: c3 } = w.newClient();
    const bootP3 = c3.boot();
    await waitForPhase(c3.bootMachine, 'prompt', w.timers);
    c3.bootMachine.resolvePrompt('adopt_remote');
    await bootP3;
    expect(c3.state().progress).toBe(30);
  });

  it('head check is bounded (800 ms): a hanging server → keep_local, status "Cloud unavailable"', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.push('important');
    client.destroy();
    // hang GET /v1/saves/current
    w.ff.on(
      'GET',
      '/v1/saves/current',
      () =>
        new Promise((res) => w.timers.set(() => res(new Response('{}', { status: 200 })), 5_000)),
    );
    const { client: c2 } = w.newClient();
    const bootP = c2.boot();
    await w.timers.advance(700);
    expect(c2.bootMachine.state().phase).toBe('checkingCloud');
    await w.timers.advance(200);
    await w.timers.flush();
    const r = await bootP;
    expect(r.decision.action).toBe('keep_local');
    expect(r.decision.reason).toBe('unreachable_local_present');
    expect(c2.state().progress).toBe(1);
  });

  it('empty cache for a returning identity + cloud unreachable → cloudUnreachable (hang bounded at ~3 s); retry recovers; start_new starts fresh', async () => {
    const w = makeWorld({ registered: true, localStorage: null });
    w.server.otherDeviceWrite(12, blob(12));
    // a hanging cloud: the empty-cache head check waits ~3 s (not 800 ms) before giving up
    let hang = true;
    const realFetch = w.ff.fetch;
    const hanging: typeof fetch = (input, init) =>
      hang && init?.method !== 'PUT' && String(input).includes('/v1/saves/current')
        ? new Promise((res) => w.timers.set(() => res(realFetch(input, init)), 30_000))
        : realFetch(input, init);
    const { client } = w.newClient({ fetch: hanging });
    const bootP = client.boot();
    await w.timers.advance(2_900);
    expect(client.bootMachine.state().phase).toBe('checkingCloud');
    await w.timers.advance(200);
    expect(client.bootMachine.state().phase).toBe('cloudUnreachable');
    // retry while the network is down → immediate cloudUnreachable again
    hang = false;
    w.server.down = true;
    client.bootMachine.retry();
    await w.timers.flush();
    expect(client.bootMachine.state().phase).toBe('cloudUnreachable');
    // server comes back → retry adopts the cloud copy
    w.server.down = false;
    client.bootMachine.retry();
    const r = await bootP;
    expect(r.decision.action).toBe('adopt_remote');
    expect(client.state().progress).toBe(12);
    client.destroy();

    const w2 = makeWorld({ registered: true, localStorage: null });
    w2.server.down = true;
    const { client: c2 } = w2.newClient();
    const bootP2 = c2.boot();
    await w2.timers.flush();
    expect(c2.bootMachine.state().phase).toBe('cloudUnreachable');
    c2.bootMachine.startNew();
    const r2 = await bootP2;
    expect(r2.decision.action).toBe('start_new');
    expect(c2.state().progress).toBe(0);
    expect(c2.sync.statusText()).toBe('Not saving on this device — cloud only');
  });

  it('empty cache for a NEW identity + unreachable → start_new immediately (no 3 s wait)', async () => {
    const w = makeWorld({ localStorage: null });
    w.server.down = true;
    const { client } = w.newClient();
    const r = await client.boot();
    expect(r.decision.action).toBe('start_new');
  });

  it('a newer server generation ALWAYS wins at boot: local pushed once (stored refused), server head adopted regardless of depth, floor reset, pending dropped', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 500 });
    await client.sync.push('important');
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.autosave();
    client.destroy();
    w.server.restart({ progress: 1, blob: blob(1) });
    const { client: c2 } = w.newClient();
    const r = await c2.boot();
    expect(r.decision.action).toBe('adopt_remote');
    expect(r.decision.reason).toBe('remote_newer_generation');
    expect(c2.sync.envelope().generation).toBe(1);
    expect(c2.state().progress).toBe(1);
    expect(c2.sync.envelope().ratchetFloor).toEqual({
      playerId: 'guest-1',
      generation: 1,
      progress: 1,
    });
    expect(c2.sync.envelope().pending).toBeUndefined();
    const stale = w.server.rows.filter(
      (x) => x.disposition === 'stored_refused' && x.reason === 'stale_generation',
    );
    expect(stale.length).toBe(1);
    expect(stale[0]!.progress).toBe(501);
    // subsequent play pushes in the new generation and is anchored (divergent: the adopted head
    // was written by another session — the server says so, and the client tells the truth)
    c2.dispatch({ type: 'inc', n: 2 });
    const rep = await c2.sync.push('important');
    expect(!rep.skipped && rep.verdict).toBe('synced_divergent');
    expect(c2.sync.status()).toMatchObject({ kind: 'saved_to_cloud', divergent: true });
    expect(w.server.anchor(1)?.progress).toBe(3);
    // the next write continues our own lineage → plain synced
    c2.dispatch({ type: 'inc', n: 1 });
    const rep2 = await c2.sync.push('important');
    expect(!rep2.skipped && rep2.verdict).toBe('synced');
  });

  it('newer empty generation on the server (restart elsewhere) → start_new in that generation', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 9 });
    await client.sync.push('important');
    client.destroy();
    w.server.restart();
    const { client: c2 } = w.newClient();
    const r = await c2.boot();
    expect(r.decision.action).toBe('start_new');
    expect(c2.sync.envelope().generation).toBe(1);
    expect(c2.state().progress).toBe(0);
  });

  it('stale_generation mid-session (restart from another device) → push once, adopt server head, broadcast', async () => {
    const sent: unknown[] = [];
    const w = makeWorld();
    const { client } = w.newClient({
      channel: () => ({ onmessage: null, postMessage: (m) => sent.push(m), close: () => {} }),
    });
    await client.boot();
    client.dispatch({ type: 'inc', n: 5 });
    await client.sync.push('important');
    w.server.restart({ progress: 2, blob: blob(2) });
    const events: ClientEvent<CounterState>[] = [];
    client.onEvent((e) => events.push(e));
    client.dispatch({ type: 'inc', n: 1 });
    const r = await client.sync.push('important');
    expect(!r.skipped && r.verdict).toBe('refused_stale_generation');
    expect(client.sync.envelope().generation).toBe(1);
    expect(client.state().progress).toBe(2);
    expect(sent).toEqual([
      expect.objectContaining({ type: 'generation', playerId: 'guest-1', generation: 1 }),
    ]);
    expect(
      events.some(
        (e) => e.type === 'sync' && e.event.type === 'generation_changed' && e.event.to === 1,
      ),
    ).toBe(true);
  });

  it('server_behind (server generation < local) → stop pushing + alarm; reattach recovers', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 5 });
    await client.sync.push('important');
    w.server.restart({ progress: 5, blob: blob(5) });
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.push('important'); // adopts generation 1
    expect(client.sync.envelope().generation).toBe(1);
    // disaster restore on the server: back to generation 0
    w.server.generation = 0;
    w.server.rows = w.server.rows.filter((x) => x.generation === 0);
    const events: ClientEvent<CounterState>[] = [];
    client.onEvent((e) => events.push(e));
    client.dispatch({ type: 'inc', n: 1 });
    const r = await client.sync.push('important');
    expect(!r.skipped && r.verdict).toBe('server_behind');
    expect(client.sync.halted()).toBe('server_behind');
    expect(
      events.some(
        (e) => e.type === 'sync' && e.event.type === 'alarm' && e.event.kind === 'server_behind',
      ),
    ).toBe(true);
    expect((await client.sync.push('important')).skipped).toBe('halted');
    expect(client.sync.statusText()).toMatch(/paused/);
    // operator enables reattach
    const out = await client.restore.reattach();
    expect(out.ok).toBe(true);
    expect(w.server.generation).toBeGreaterThanOrEqual(1);
    expect(client.sync.halted()).toBeNull();
    client.dispatch({ type: 'inc', n: 1 });
    const again = await client.sync.push('important');
    expect(!again.skipped && ['synced', 'synced_divergent'].includes(again.verdict)).toBe(true);
    expect(w.server.anchor()?.progress).toBe(client.state().progress);
  });

  it('erased on the server → blocked at boot', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.destroy();
    w.server.erased = true;
    const { client: c2 } = w.newClient();
    await expect(c2.boot()).rejects.toThrow(/blocked/);
    expect(c2.bootMachine.state()).toMatchObject({ phase: 'blocked', blockedReason: 'erased' });
  });

  it('426 at boot → blocked update_required', async () => {
    const w = makeWorld();
    w.server.forceStatus = 426;
    const { client } = w.newClient();
    await expect(client.boot()).rejects.toThrow();
    expect(client.bootMachine.state().blockedReason).toBe('update_required');
  });

  it('visible after a long hide → head re-check adopts a deeper cloud copy when local is clean', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient({
      sync: { longHideMs: 60_000, autosaveMs: 10_000, pushMs: 60_000, headCheckMs: 800 },
    });
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.push('important');
    platform.controls.setVisible(false);
    await w.timers.flush();
    w.server.otherDeviceWrite(40, blob(40));
    await w.timers.advance(120_000);
    platform.controls.setVisible(true);
    await w.timers.flush();
    expect(client.state().progress).toBe(40);
    expect(client.bootMachine.state().phase).toBe('live');
  });

  it('pendingQuarantine surfaced when a deeper quarantined save awaits review', async () => {
    const w = makeWorld({ maxProgressPerHour: 10 });
    w.server.otherDeviceWrite(5, blob(5));
    w.server.otherDeviceWrite(5000, blob(5000)); // progress_jump → quarantined
    const { client } = w.newClient();
    await client.boot();
    expect(client.bootMachine.state().pendingQuarantine?.progress).toBe(5000);
    expect(client.state().progress).toBe(5);
  });
});

describe('restore (§1, §5.2 Restore, ADR-005 break-glass)', () => {
  it('forward-only: trial-deserialise, deeper only, push current → write local → confirm → reload; the gate blocks the teardown push while restoring', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 3 });
    await client.sync.push('important');
    // shallower → refused before anything happens
    expect(await client.restore.forwardOnly(blob(2))).toMatchObject({
      ok: false,
      reason: 'not_deeper',
    });
    expect(await client.restore.forwardOnly('garbage')).toMatchObject({
      ok: false,
      reason: 'trial_failed',
    });
    // observe the gate: while held, a hidden→beacon (teardown push) is refused
    let sawGateClosed = false;
    let beaconsDuringGate = 0;
    client.gate.onChange((r) => {
      if (r) {
        sawGateClosed = true;
        platform.controls.setVisible(false);
        beaconsDuringGate = w.beacons.length;
        expect(client.sync.beacon()).toBe(false);
      }
    });
    const out = await client.restore.forwardOnly(blob(50));
    expect(out).toMatchObject({ ok: true, kind: 'forward', progress: 50 });
    // the live state follows immediately (the reload only re-runs boot on the same slot)
    expect(client.state().progress).toBe(50);
    expect(sawGateClosed).toBe(true);
    expect(beaconsDuringGate).toBe(0);
    expect(w.reloads()).toBe(1);
    // slot holds the restored state with a forced floor; the pre-restore state was pushed first
    const slot = JSON.parse(w.ls!.getItem(slotKey('game', 'guest-1'))!) as {
      progress: number;
      ratchetFloor: { progress: number };
      dirty: boolean;
    };
    expect(slot.progress).toBe(50);
    expect(slot.ratchetFloor.progress).toBe(50);
    expect(slot.dirty).toBe(true);
    expect(puts(w).at(-1)?.reason).toBe('restore');
    // after the reload the restored state boots and is pushed with reason 'restore'
    client.destroy();
    const { client: c2 } = w.newClient();
    await c2.boot();
    expect(c2.state().progress).toBe(50);
    await w.timers.flush();
    expect(w.server.anchor()?.progress).toBe(50);
    expect(puts(w).at(-1)?.reason).toBe('boot-retry');
  });

  it('restore-to-point: POST lineage/restoreToSeq → generation bump → adopt the seeded head → reload; 409 stale_generation surfaced', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 3 });
    await client.sync.push('important');
    const seq = w.server.anchor()!.seq;
    client.dispatch({ type: 'inc', n: 4 });
    await client.sync.push('important');
    const out = await client.restore.restoreToSeq(seq);
    expect(out).toMatchObject({ ok: true, kind: 'restore_to_seq', generation: 1, progress: 3 });
    expect(client.sync.envelope().generation).toBe(1);
    expect(client.state().progress).toBe(3);
    expect(w.reloads()).toBe(1);
    // stale: another device already bumped
    w.server.restart();
    const stale = await client.restore.restoreToSeq(seq);
    expect(stale).toMatchObject({ ok: false, reason: 'stale_generation', serverGeneration: 2 });
  });

  it('fromHistory fetches a blob by seq and restores forward-only', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    w.server.otherDeviceWrite(90, blob(90));
    const seq = w.server.anchor()!.seq;
    // local is at 0 (fresh); history blob at 90 is deeper → restore
    const out = await client.restore.fromHistory(seq);
    expect(out).toMatchObject({ ok: true, progress: 90 });
    expect(await client.restore.fromHistory(999)).toMatchObject({
      ok: false,
      reason: 'blob_unavailable',
    });
  });

  it('KV break-glass: human-initiated read once, trial-deserialise, forward-only; never read on the normal path', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    await client.sync.autosave();
    await w.timers.flush();
    // the mirror holds progress 2; corrupt the local slot forward to a shallower state to make it "deeper"
    platform.controls.kvStore.set(slotKey('game', 'guest-1'), blob(77));
    const out = await client.restore.breakGlassFromKv();
    expect(out).toMatchObject({ ok: true, kind: 'break_glass', progress: 77 });
    expect(w.reloads()).toBe(1);
    const w2 = makeWorld({ pathologies: { kvBreakGlassValue: null } });
    const { client: c2 } = w2.newClient();
    await c2.boot();
    expect(await c2.restore.breakGlassFromKv()).toMatchObject({ ok: false, reason: 'kv_empty' });
    const w3 = makeWorld({ pathologies: { kvBreakGlassValue: 'not json' } });
    const { client: c3 } = w3.newClient();
    await c3.boot();
    expect(await c3.restore.breakGlassFromKv()).toMatchObject({
      ok: false,
      reason: 'trial_failed',
    });
  });
});

describe('identity switch (§5.2 guest → account)', () => {
  it('pushes the guest snapshot under the previous token (one use), then adopts trivially into an empty account', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 6 });
    const outcomes: IdentitySwitchOutcome<CounterState>[] = [];
    client.onEvent((e) => {
      if (e.type === 'identity_switch') outcomes.push(e.outcome);
    });
    platform.controls.switchIdentity('acct-1', true);
    await w.timers.flush();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]!.kind).toBe('adopted_guest');
    // guest's final snapshot went to the server under the guest key
    const guestPut = puts(w).find((b) => b.progress === 6);
    expect(guestPut).toBeDefined();
    const guestCall = w.ff.calls.find(
      (c) => c.method === 'PUT' && (c.body as SaveWriteBody).commandId === guestPut!.commandId,
    )!;
    expect(guestCall.headers['x-player-key']).toBe('guest-1');
    expect(platform.controls.previousTokenConsumed()).toBe(true);
    // the account now plays with the guest state and pushes under its own key
    expect(client.player?.playerId).toBe('acct-1');
    expect(client.state().progress).toBe(6);
    const acctPuts = w.ff.calls.filter(
      (c) => c.method === 'PUT' && c.headers['x-player-key'] === 'acct-1',
    );
    expect(acctPuts.length).toBeGreaterThan(0);
    expect(w.ls!.getItem(slotKey('game', 'acct-1'))).toContain('"progress":6');
  });

  it('target with progress → "keep which?" prompt; choosing account keeps it; choosing a shallower guest over a deeper account → needs_admin', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 6 });
    // the account already has cloud progress 20 (written from another device)
    w.server.forPlayer('acct-2').otherDeviceWrite(20, blob(20));
    const outcomes: IdentitySwitchOutcome<CounterState>[] = [];
    client.onEvent((e) => {
      if (e.type === 'identity_switch') outcomes.push(e.outcome);
    });
    platform.controls.switchIdentity('acct-2', true);
    await w.timers.flush();
    const o = outcomes[0]!;
    expect(o.kind).toBe('prompt');
    if (o.kind !== 'prompt') return;
    expect(o.guest.progress).toBe(6);
    expect(o.account.progress).toBe(20);
    const chosen = await o.choose('guest');
    expect(chosen.kind).toBe('needs_admin');
    // the account state stays live and its slot untouched (no shallower overwrite)
    expect(client.state().progress).toBe(20);
    expect(client.sync.envelope().progress).toBe(20);
  });

  it('guest with no play → kept_target', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    const outcomes: IdentitySwitchOutcome<CounterState>[] = [];
    client.onEvent((e) => {
      if (e.type === 'identity_switch') outcomes.push(e.outcome);
    });
    platform.controls.switchIdentity('acct-3', true);
    await w.timers.flush();
    expect(outcomes[0]!.kind).toBe('kept_target');
  });
});

describe('multi-tab (§5.2)', () => {
  it('follower cannot dispatch or write; "Play here" takes over and reloads the slot', async () => {
    const w = makeWorld();
    const { client } = w.newClient({
      locks: {
        // this tab is always a follower until it steals
        request(_name, options, cb) {
          if (options.steal) return Promise.resolve(cb({}));
          return Promise.resolve(cb(null));
        },
      },
    });
    const events: ClientEvent<CounterState>[] = [];
    client.onEvent((e) => events.push(e));
    await client.boot();
    expect(client.leader.isLeader()).toBe(false);
    client.dispatch({ type: 'inc', n: 1 });
    expect(client.state().progress).toBe(0);
    expect(events.some((e) => e.type === 'follower_blocked')).toBe(true);
    expect((await client.sync.push('important')).skipped).toBe('follower');
    // the leader tab wrote a deeper slot meanwhile
    const leaderSlot = createSlot(client.storage, slotKey('game', 'guest-1'), counterCodec, {
      gameId: 'game',
      playerId: 'guest-1',
    });
    leaderSlot.write({
      ...client.sync.envelope(),
      state: { count: 8, ticks: 0, progress: 8 },
      progress: 8,
    });
    await client.playHere();
    expect(client.leader.isLeader()).toBe(true);
    expect(client.state().progress).toBe(8);
    client.dispatch({ type: 'inc', n: 1 });
    expect(client.state().progress).toBe(9);
  });

  it('a sibling tab announcing a newer generation makes this tab adopt the server head', async () => {
    let listener: ((ev: { data: unknown }) => void) | null = null;
    const w = makeWorld();
    const { client } = w.newClient({
      channel: () => {
        const ch = {
          onmessage: null as ((ev: { data: unknown }) => void) | null,
          postMessage() {},
          close() {},
        };
        queueMicrotask(() => {
          listener = ch.onmessage;
        });
        return ch;
      },
    });
    await client.boot();
    client.dispatch({ type: 'inc', n: 3 });
    await client.sync.push('important');
    w.server.restart({ progress: 1, blob: blob(1) });
    await w.timers.flush();
    listener!({
      data: { type: 'generation', gameId: 'game', playerId: 'guest-1', generation: 1, at: 0 },
    });
    await w.timers.flush();
    expect(client.sync.envelope().generation).toBe(1);
    expect(client.state().progress).toBe(1);
  });
});
