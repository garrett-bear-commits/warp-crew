import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveBeaconBody, SaveWriteBody } from '@foundation/contracts';
import { counterCodec, type CounterState } from '../helpers/fixtures.ts';
import { makeWorld, type Client, type World } from '../helpers/world.ts';

const puts = (w: World): { at: number; body: SaveWriteBody }[] =>
  w.ff.calls
    .filter((c) => c.method === 'PUT' && c.url.endsWith('/v1/saves'))
    .map((c) => ({ at: c.at, body: c.body as SaveWriteBody }));

const countOf = (body: SaveWriteBody): number =>
  (JSON.parse(body.blob) as { state: CounterState }).state.count;

/** A counter codec that counts snapshot encodes (the expensive step in a real game). */
function countingCodec() {
  const counter = { encodes: 0 };
  const codec = {
    ...counterCodec,
    encode(state: CounterState) {
      counter.encodes++;
      return counterCodec.encode(state);
    },
  };
  return { codec, counter };
}

/** One committed intent, saved the way a game asks for it. */
function act(client: Client, priority: 'routine' | 'immediate' = 'routine'): Promise<void> {
  client.dispatch({ type: 'inc', n: 1 });
  return client.sync.requestSave(priority);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('save cadence: routine changes throttle, immediate ones go now', () => {
  it('25 routine intents in a minute (chest Auto) make at most 6 pushes and the newest state still lands', async () => {
    const w = makeWorld();
    const { codec, counter } = countingCodec();
    const { client } = w.newClient({ codec });
    await client.boot();
    const before = puts(w).length;
    const encodesBefore = counter.encodes;
    const start = w.clock.now();
    for (let i = 0; i < 25; i++) {
      await act(client);
      await w.timers.advance(2_400);
    }
    expect(w.clock.now() - start).toBe(60_000);
    const sent = puts(w).slice(before);
    // leading push, then one per 12 s window (was one per intent: 25)
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < sent.length; i++)
      expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(12_000);
    // device snapshots: about one per 5 s window plus the pushes (was two encodes per intent: 50+)
    expect(counter.encodes - encodesBefore).toBeLessThanOrEqual(20);
    // trailing: the last change reaches the server once its window ends
    await w.timers.advance(12_000);
    expect(w.server.anchor()?.progress).toBe(25);
    expect(client.sync.envelope().pending).toBeUndefined();
    client.destroy();
  });

  it('an immediate intent pushes at once inside a routine window, carrying its change', async () => {
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    await act(client);
    await w.timers.advance(1_000);
    expect(w.server.anchor()?.progress).toBe(1); // leading routine push
    await act(client);
    await w.timers.advance(1_000);
    expect(w.server.anchor()?.progress).toBe(1); // the next routine push waits for its window
    await act(client, 'immediate');
    expect(w.server.anchor()?.progress).toBe(3);
    expect(puts(w).at(-1)!.body.reason).toBe('important');
    // the routine push it replaced is not sent again
    const sent = puts(w).length;
    await w.timers.advance(30_000);
    expect(puts(w).length).toBe(sent);
    client.destroy();
  });

  it('an immediate intent waits out an in-flight push and then sends its own state', async () => {
    const w = makeWorld();
    let release: (() => void) | null = null;
    const realFetch = w.ff.fetch;
    const held: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT' && release === null) await new Promise<void>((r) => (release = r));
      return realFetch(input, init);
    };
    const { client } = w.newClient({ fetch: held });
    await client.boot();
    await act(client);
    await w.timers.advance(0); // the leading routine push is now held in flight
    expect(release).not.toBeNull();
    const done = act(client, 'immediate');
    await w.timers.flush();
    release!();
    await done;
    const sent = puts(w);
    expect(sent.map((p) => countOf(p.body))).toEqual([1, 2]);
    expect(w.server.anchor()?.progress).toBe(2);
    client.destroy();
  });

  it('hiding the page flushes the state a routine window was still holding', async () => {
    const w = makeWorld();
    const { client, platform } = w.newClient();
    await client.boot();
    await act(client);
    await w.timers.advance(1_000);
    await act(client);
    await act(client);
    expect(w.server.anchor()?.progress).toBe(1);
    platform.controls.setVisible(false);
    await w.timers.flush();
    expect(w.beacons).toHaveLength(1);
    const beacon = JSON.parse(w.beacons[0]!.body) as SaveBeaconBody;
    expect((JSON.parse(beacon.blob) as { state: CounterState }).state.count).toBe(3);
    await w.deliverBeacons();
    expect(w.server.anchor()?.progress).toBe(3);
    client.destroy();
  });

  it('a hung save request is abandoned after 10 s and later pushes back off with jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = makeWorld();
    let hang = true;
    const realFetch = w.ff.fetch;
    const sentAt: number[] = [];
    const hanging: typeof fetch = (input, init) => {
      if (init?.method === 'PUT') sentAt.push(w.clock.now());
      return hang && init?.method === 'PUT'
        ? new Promise<Response>(() => {})
        : realFetch(input, init);
    };
    const { client } = w.newClient({ fetch: hanging });
    await client.boot();
    const before = sentAt.length;
    await act(client);
    await w.timers.advance(9_000);
    expect(client.sync.envelope().lastVerdict).toBeNull();
    await w.timers.advance(1_000);
    expect(client.sync.envelope().lastVerdict).toBe('unreachable');
    expect(client.sync.envelope().pending).toBeDefined();
    // the network is down outright now: each retry fails at once and the backoff doubles; a
    // retry never comes sooner than the 12 s routine window after the last send
    hang = false;
    w.ff.offline = true;
    await w.timers.advance(40_000);
    const attempts = (): number[] => sentAt.slice(before);
    const gaps = (): number[] =>
      attempts()
        .slice(1)
        .map((at, i) => at - attempts()[i]!);
    // jitter 0.5 → 75 % of each step: 3 s (after the 10 s hang), then the window, then 24 s
    expect(gaps()).toEqual([10_000 + 3_000, 12_000, 12_000]);
    // the server is back: the next retry (24 s after the last) lands and the backoff resets
    w.ff.offline = false;
    await w.timers.advance(11_000);
    expect(gaps().at(-1)).toBe(24_000);
    expect(client.sync.envelope().lastVerdict).toBe('synced');
    expect(w.server.anchor()?.progress).toBe(1);
    await act(client);
    await w.timers.advance(12_000);
    expect(w.server.anchor()?.progress).toBe(2);
    client.destroy();
  });

  it('5xx answers back off the timer push exponentially; any other answer resets the step', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const w = makeWorld();
    const { client } = w.newClient();
    await client.boot();
    client.dispatch({ type: 'inc', n: 1 });
    w.server.forceStatus = 503;
    await client.sync.push('timer');
    expect(client.sync.envelope().lastVerdict).toBe('rejected_transport');
    // step 4 s, jitter 0 → 2 s (the 503's 500 ms retry hint is only a floor)
    expect(client.sync.needsPush()).toBe(false);
    await w.timers.advance(1_999);
    expect(client.sync.needsPush()).toBe(false);
    await w.timers.advance(1);
    expect(client.sync.needsPush()).toBe(true);
    await client.sync.push('timer'); // step 8 s → 4 s
    await w.timers.advance(3_999);
    expect(client.sync.needsPush()).toBe(false);
    await w.timers.advance(1);
    expect(client.sync.needsPush()).toBe(true);
    // a 4xx is an answer: no backoff, and the next failure starts over at the first step
    w.server.forceStatus = 401;
    await client.sync.push('timer');
    expect(client.sync.envelope().lastVerdict).toBe('unauthorized');
    expect(client.sync.needsPush()).toBe(true);
    w.server.forceStatus = 503;
    await client.sync.push('timer');
    await w.timers.advance(1_999);
    expect(client.sync.needsPush()).toBe(false);
    await w.timers.advance(1);
    expect(client.sync.needsPush()).toBe(true);
    // the 60 s timer does not push inside a backoff
    const sent = puts(w).length;
    await w.timers.advance(59_000 - 8_000 - 1);
    await client.sync.push('timer'); // fails again at 59 s: backs off past the timer
    await w.timers.advance(2_000);
    expect(puts(w).length).toBe(sent + 1);
    client.destroy();
  });

  it('a boot re-push lost to the network retries in the background, not at the 60 s timer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const w = makeWorld();
    const first = w.newClient().client;
    await first.boot();
    first.dispatch({ type: 'inc', n: 4 });
    await first.sync.autosave();
    first.destroy();
    w.server.down = true;
    const { client } = w.newClient();
    await client.boot();
    expect(client.sync.envelope().lastVerdict).toBe('unreachable');
    w.server.down = false;
    // retried when both its backoff (2 s) and the routine window (12 s) have passed
    await w.timers.advance(11_999);
    expect(w.server.anchor()).toBeNull();
    await w.timers.advance(1);
    expect(w.server.anchor()?.progress).toBe(4);
    expect(client.sync.envelope().lastVerdict).toBe('synced');
    client.destroy();
  });
});
