import { describe, expect, it } from 'vitest';
import { LIMITS } from '@foundation/contracts/enums';
import type { SaveBeaconBody, SaveWriteBody } from '@foundation/contracts';
import { makeWorld } from '../helpers/world.ts';
import { slotKey } from '../../src/storage/envelope.ts';
import type { SyncEvent } from '../../src/sync/client.ts';
import type { CounterState } from '../helpers/fixtures.ts';

const putBodies = (w: ReturnType<typeof makeWorld>): SaveWriteBody[] =>
  w.ff.calls
    .filter((c) => c.method === 'PUT' && c.url.endsWith('/v1/saves'))
    .map((c) => c.body as SaveWriteBody);

describe('sync client — push, verdicts, commandId reuse (§5.2 Sync)', () => {
  it('fresh player: boot → start_new → first push anchored (synced), envelope acked, status "Saved to cloud"', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    const r = await client.boot();
    expect(r.decision.action).toBe('start_new');
    expect(client.bootMachine.state().phase).toBe('live');
    client.dispatch({ type: 'inc', n: 3 });
    const report = await client.sync.push('important');
    expect(report.skipped).toBeUndefined();
    if (!report.skipped) expect(report.verdict).toBe('synced');
    const env = client.sync.envelope();
    expect(env.pending).toBeUndefined();
    expect(env.lastAckedSeq).toBe(1);
    expect(env.lastVerdict).toBe('synced');
    expect(client.sync.status().kind).toBe('saved_to_cloud');
    expect(client.sync.statusText()).toMatch(/^Saved to cloud \d+ s ago$/);
    expect(w.server.anchor()?.progress).toBe(3);
    // the local slot was persisted before the first attempt (pending recorded) and after the ack
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toContain('"lastAckedSeq":1');
  });

  it('commandId is minted with the snapshot BEFORE the first attempt and reused verbatim on retry; the retry is a duplicate, never a double write', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    w.server.down = true;
    const first = await client.sync.push('timer');
    expect(!first.skipped && first.verdict).toBe('unreachable');
    const pending = client.sync.envelope().pending!;
    expect(pending.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.sync.status().kind).toBe('cloud_unavailable_local');
    expect(client.sync.statusText()).toBe('Cloud unavailable — saving on this device');
    // envelope with the pending was persisted before the attempt
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toContain(pending.commandId);
    w.server.down = false;
    const second = await client.sync.push('timer');
    expect(!second.skipped && second.verdict).toBe('synced');
    expect(putBodies(w).map((b) => b.commandId)).toEqual([pending.commandId, pending.commandId]);
    // request landed but the response was lost → the retry gets `duplicate`, no second row
    client.dispatch({ type: 'inc', n: 1 });
    const bodiesBefore = putBodies(w).length;
    // simulate lost response: server records, client sees a network error
    const realFetch = w.ff.fetch;
    let dropOnce = true;
    const dropping: typeof fetch = async (input, init) => {
      const res = await realFetch(input, init);
      if (dropOnce && init?.method === 'PUT') {
        dropOnce = false;
        throw new TypeError('connection reset');
      }
      return res;
    };
    const { client: c2 } = w.newClient({ fetch: dropping });
    await c2.boot();
    c2.dispatch({ type: 'inc', n: 5 });
    const lost = await c2.sync.push('important');
    expect(!lost.skipped && lost.verdict).toBe('unreachable');
    const retry = await c2.sync.push('important');
    expect(!retry.skipped && retry.verdict).toBe('duplicate');
    expect(
      w.server.rows.filter((r) => r.commandId === c2.sync.envelope().lastAckedSeq.toString())
        .length,
    ).toBe(0);
    const ids = putBodies(w)
      .slice(bodiesBefore)
      .map((b) => b.commandId);
    expect(new Set(ids).size).toBe(1);
    expect(w.server.rows.filter((r) => r.commandId === ids[0]).length).toBe(1);
  });

  it('a newer snapshot replaces an unacked pending with a NEW commandId (payload never drifts under one id)', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    w.server.down = true;
    await client.sync.push('timer');
    const c1 = client.sync.envelope().pending!.commandId;
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.push('timer');
    const c2 = client.sync.envelope().pending!.commandId;
    expect(c2).not.toBe(c1);
    w.server.down = false;
    const r = await client.sync.push('timer');
    expect(!r.skipped && r.verdict).toBe('synced');
    // no idempotency_mismatch ever happened
    expect(w.ff.calls.length).toBeGreaterThan(0);
  });

  it('refused_regression: server deeper → pending dropped, local kept, server_deeper event', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    await client.sync.push('important');
    w.server.otherDeviceWrite(
      50,
      JSON.stringify({ schemaVersion: 2, state: { count: 50, ticks: 0, progress: 50 } }),
    );
    const events: SyncEvent<CounterState>[] = [];
    client.sync.onEvent((e) => events.push(e));
    client.dispatch({ type: 'inc', n: 1 });
    const r = await client.sync.push('important');
    expect(!r.skipped && r.verdict).toBe('refused_regression');
    expect(client.sync.envelope().pending).toBeUndefined();
    expect(client.state().progress).toBe(3);
    expect(events.some((e) => e.type === 'server_deeper' && e.serverProgress === 50)).toBe(true);
    // the refusal is stored on the server (evidence), never lost
    expect(w.server.rows.at(-1)?.disposition).toBe('stored_refused');
  });

  it('quarantined (unknown schema) → synced_quarantined; status is "pending review", never "saved to cloud"', async () => {
    const w = makeWorld();
    w.server = new (
      w.server.constructor as typeof import('../helpers/server-model.ts').ServerTruth
    )({ gameId: 'game', now: w.clock.now, knownSchemaVersions: [1] });
    w.ff.reset();
    w.server.mount(w.ff);
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    const r = await client.sync.push('important');
    expect(!r.skipped && r.verdict).toBe('synced_quarantined');
    expect(client.sync.status().kind).toBe('pending_review');
    expect(client.sync.statusText()).not.toMatch(/Saved to cloud/);
    expect(client.sync.envelope().pending).toBeUndefined();
  });

  it('401 → unauthorized (pending kept); 429 → throttled with backoff; 426 → update_required halts; 503 → rejected_transport', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    w.server.forceStatus = 401;
    expect(!(await client.sync.push('timer')).skipped && client.sync.envelope().lastVerdict).toBe(
      'unauthorized',
    );
    expect(client.sync.envelope().pending).toBeDefined();
    w.server.forceStatus = 429;
    await client.sync.push('timer');
    expect(client.sync.envelope().lastVerdict).toBe('throttled');
    expect(client.sync.needsPush()).toBe(false); // backoff
    await w.timers.advance(2_000);
    expect(client.sync.needsPush()).toBe(true);
    w.server.forceStatus = 503;
    await client.sync.push('timer');
    expect(client.sync.envelope().lastVerdict).toBe('rejected_transport');
    w.server.forceStatus = 426;
    await w.timers.advance(2_000);
    await client.sync.push('timer');
    expect(client.sync.envelope().lastVerdict).toBe('update_required');
    expect(client.sync.halted()).toBe('update_required');
    expect(client.sync.status().kind).toBe('halted');
    expect((await client.sync.push('timer')).skipped).toBe('halted');
    client.sync.resume();
    w.server.forceStatus = null;
    const ok = await client.sync.push('timer');
    expect(!ok.skipped && ok.verdict).toBe('synced');
  });

  it('no token → no_token; sync disabled → disabled', async () => {
    const w = makeWorld({ pathologies: { noToken: true } });
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    const r = await client.sync.push('timer');
    expect(!r.skipped && r.verdict).toBe('no_token');
    const w2 = makeWorld();
    const { client: c2 } = w2.newClient({ sync: { enabled: false } });
    await c2.boot();
    const r2 = await c2.sync.push('timer');
    expect(!r2.skipped && r2.verdict).toBe('disabled');
    expect(c2.sync.status().kind).toBe('disabled');
  });

  it('erased player → verdict erased; halted', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    w.server.erased = true;
    const r = await client.sync.push('timer');
    expect(!r.skipped && r.verdict).toBe('erased');
    expect(client.sync.halted()).toBe('erased');
  });

  it('memory-only storage: status is "Not saving on this device — cloud only" until synced', async () => {
    const w = makeWorld({ localStorage: null });
    const { client } = w.newClient();
    await client.boot();
    expect(client.storage.mode).toBe('memory');
    expect(client.sync.statusText()).toBe('Not saving on this device — cloud only');
    client.dispatch({ type: 'inc', n: 1 });
    w.server.down = true;
    await client.sync.push('timer');
    expect(client.sync.statusText()).toBe('Cloud unavailable — not saving on this device');
  });

  it('timers: autosave every 10 s only when dirty; push on the 60 s state-driven timer only when there is something to push', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    const putsAtStart = putBodies(w).length;
    await w.timers.advance(70_000);
    // a fresh start_new state is not dirty: nothing is pushed until the player acts
    const afterFirst = putBodies(w).length;
    expect(afterFirst).toBe(putsAtStart);
    await w.timers.advance(120_000);
    expect(putBodies(w).length).toBe(afterFirst);
    client.dispatch({ type: 'inc', n: 4 });
    await w.timers.advance(10_000);
    const slot = JSON.parse(w.ls!.getItem(slotKey('game', 'guest-1'))!) as {
      progress: number;
      pending?: unknown;
    };
    expect(slot.progress).toBe(4);
    expect(slot.pending).toBeDefined();
    await w.timers.advance(60_000);
    expect(putBodies(w).length).toBe(afterFirst + 1);
    expect(w.server.anchor()?.progress).toBe(4);
  });

  it('beacon on hidden: save first, body ≤ 64 KiB, text/plain with auth inside, SAME commandId as the pending push; delivery yields duplicate on the boot re-push', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 7 });
    platform.controls.setVisible(false);
    await w.timers.flush();
    expect(w.beacons.length).toBe(1);
    const b = JSON.parse(w.beacons[0]!.body) as SaveBeaconBody;
    expect(w.beacons[0]!.url).toBe('http://api.test/v1/saves/beacon');
    expect(new TextEncoder().encode(w.beacons[0]!.body).length).toBeLessThanOrEqual(
      LIMITS.beaconMaxBytes,
    );
    expect(b.playerKey).toBe('guest-1');
    expect(b.token).toMatch(/^mock\.guest-1\./);
    expect(b.reason).toBe('teardown');
    const pending = client.sync.envelope().pending!;
    expect(b.commandId).toBe(pending.commandId);
    expect(b.blob).toBe(pending.encodedBlob);
    // slot saved first
    expect(w.ls!.getItem(slotKey('game', 'guest-1'))).toContain(pending.commandId);
    // the browser delivers the beacon after unload; the next boot re-pushes the pending → duplicate
    await w.deliverBeacons();
    expect(w.server.anchor()?.progress).toBe(7);
    client.destroy();
    const { client: c2 } = w.newClient();
    const r = await c2.boot();
    expect(r.decision.action).toBe('keep_local');
    const last = putBodies(w).at(-1)!;
    expect(last.commandId).toBe(pending.commandId);
    expect(last.reason).toBe('teardown');
    expect(c2.sync.envelope().lastVerdict).toBe('duplicate');
    expect(c2.sync.envelope().pending).toBeUndefined();
    expect(w.server.rows.filter((x) => x.commandId === pending.commandId).length).toBe(1);
  });

  it('a beacon minted while a push is in flight is NOT dropped when the older push acks (ack is matched by commandId)', async () => {
    const w = makeWorld();
    // hold the PUT response until released
    let release: (() => void) | null = null;
    const realFetch = w.ff.fetch;
    const slow: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT') await new Promise<void>((r) => (release = r));
      return realFetch(input, init);
    };
    const { client, platform } = w.newClient({ fetch: slow });
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    const inflight = client.sync.push('important');
    await w.timers.flush();
    const firstId = client.sync.envelope().pending!.commandId;
    // the player acts again and the tab hides: the beacon mints a NEWER pending
    client.dispatch({ type: 'inc', n: 1 });
    platform.controls.setVisible(false);
    await w.timers.flush();
    const beaconId = client.sync.envelope().pending!.commandId;
    expect(beaconId).not.toBe(firstId);
    expect(w.beacons.length).toBe(1);
    // the older push now acks: the newer pending must survive, unacked
    release!();
    const report = await inflight;
    expect(!report.skipped && report.commandId).toBe(firstId);
    expect(!report.skipped && report.verdict).toBe('synced');
    expect(client.sync.envelope().pending?.commandId).toBe(beaconId);
    expect(client.sync.envelope().dirty).toBe(true);
    expect(client.sync.envelope().lastAckedSeq).toBe(1);
    // the beacon is delivered later → the boot re-push of the same commandId is a duplicate
    await w.deliverBeacons();
    expect(w.server.anchor()?.progress).toBe(2);
  });

  it('beacon body over 64 KiB is not sent (the boot re-push carries it)', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.loop.replaceState({ count: 1, ticks: 0, progress: 1, note: 'x'.repeat(70 * 1024) });
    client.sync.markDirty();
    platform.controls.setVisible(false);
    await w.timers.flush();
    expect(w.beacons.length).toBe(0);
    expect(client.sync.envelope().pending).toBeDefined();
  });

  it('boot re-push of the last unacked snapshot happens before live (reason frozen with the pending)', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    w.server.down = true;
    await client.sync.autosave();
    const pending = client.sync.envelope().pending!;
    expect(pending.reason).toBe('autosave');
    client.destroy();
    w.server.down = false;
    const { client: c2 } = w.newClient();
    await c2.boot();
    const last = putBodies(w).at(-1)!;
    expect(last.commandId).toBe(pending.commandId);
    expect(last.reason).toBe('autosave');
    expect(c2.sync.envelope().lastVerdict).toBe('synced');
    expect(w.server.anchor()?.progress).toBe(2);
  });

  it('dirty state without a pending (old-schema pending dropped) → boot-retry reason', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 2 });
    await client.sync.autosave();
    client.destroy();
    // corrupt the pending's schemaVersion so the slot read drops it
    const raw = JSON.parse(w.ls!.getItem(slotKey('game', 'guest-1'))!) as {
      pending: { schemaVersion: number };
      dirty: boolean;
    };
    raw.pending.schemaVersion = 1;
    raw.dirty = true;
    w.ls!.setItem(slotKey('game', 'guest-1'), JSON.stringify(raw));
    const { client: c2 } = w.newClient();
    await c2.boot();
    expect(putBodies(w).at(-1)!.reason).toBe('boot-retry');
  });

  it('kv mirror is written on autosave (write-only) and never read on the normal path', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    await client.sync.autosave();
    await w.timers.flush();
    expect(platform.controls.kvStore.get(slotKey('game', 'guest-1'))).toContain('"progress":1');
    const { client: c2 } = w.newClient({ kvMirror: 'off' });
    await c2.boot();
    c2.dispatch({ type: 'inc', n: 1 });
    await c2.sync.autosave();
    await w.timers.flush();
    // still the first value: no mirror writes with kvMirror off
    expect(platform.controls.kvStore.get(slotKey('game', 'guest-1'))).toContain('"progress":1');
  });

  it('journal: errors_only ships only after a game_error; ≤ 16 KiB; never at teardown', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    await w.timers.advance(61_000);
    expect(w.ff.calls.some((c) => c.url.endsWith('/v1/journal'))).toBe(false);
    client.reportError(new Error('boom'));
    expect(client.journal.breadcrumbs().some((b) => b.name === 'inc')).toBe(true);
    platform.controls.setVisible(false); // teardown path: never ships the journal
    await w.timers.flush();
    expect(w.ff.calls.some((c) => c.url.endsWith('/v1/journal'))).toBe(false);
    platform.controls.setVisible(true);
    await w.timers.advance(61_000);
    const ship = w.ff.calls.find((c) => c.url.endsWith('/v1/journal'));
    expect(ship).toBeDefined();
    expect(JSON.stringify(ship!.body).length).toBeLessThanOrEqual(
      LIMITS.journalMaxBytesPerCall + 512,
    );
    // the integrity event with breadcrumbs also rode the timer path
    const integ = w.ff.calls.find((c) => c.url.endsWith('/v1/telemetry/integrity'));
    expect(integ).toBeDefined();
    expect(
      (integ!.body as { events: { kind: string; breadcrumbs: unknown[] }[] }).events[0]!.kind,
    ).toBe('game_error');
    expect(platform.controls.reported()[0]?.kind).toBe('game_error');
  });
});
