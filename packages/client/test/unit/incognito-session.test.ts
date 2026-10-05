import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INCOGNITO_MAX_BLOB_BYTES,
  INCOGNITO_PROTOCOL,
  announceIncognitoFailed,
  announceIncognitoLoaded,
  announceIncognitoReady,
  createIncognitoSessionRequest,
  createIncognitoSessionUrl,
  incognitoClientOptions,
  readIncognitoSessionRequest,
  seedIncognitoSnapshot,
  validateIncognitoSnapshotMessage,
  waitForIncognitoSnapshot,
  type IncognitoMessageEvent,
  type IncognitoMessageHost,
  type IncognitoSnapshot,
} from '../../src/incognito/session.ts';
import { createGameClient } from '../../src/game-client.ts';
import { createStandalonePlatform } from '../../src/providers/standalone.ts';
import { createSlot, slotKey } from '../../src/storage/envelope.ts';
import {
  counterCodec,
  counterEngine,
  createFakeTimers,
  FakeClock,
  boundClock,
} from '../helpers/fixtures.ts';

const request = () =>
  createIncognitoSessionRequest({
    adminOrigin: 'https://operator.example',
    sessionId: '12345678-1234-4234-8234-123456789abc',
  });

const snapshot = (overrides: Partial<IncognitoSnapshot> = {}): IncognitoSnapshot => ({
  protocol: INCOGNITO_PROTOCOL,
  kind: 'snapshot',
  sessionId: request().sessionId,
  playerKey: 'actual-player',
  seq: 17,
  generation: 3,
  enc: 'json',
  blob: JSON.stringify({ schemaVersion: 1, state: { total: 7, ticks: 2, progress: 7 } }),
  savedAt: 1_000,
  ...overrides,
});

class Host implements IncognitoMessageHost {
  readonly opener: unknown;
  constructor(opener: unknown) {
    this.opener = opener;
  }
  private listener: ((event: IncognitoMessageEvent) => void) | null = null;
  addEventListener(_type: 'message', listener: (event: IncognitoMessageEvent) => void): void {
    this.listener = listener;
  }
  removeEventListener(_type: 'message', listener: (event: IncognitoMessageEvent) => void): void {
    if (this.listener === listener) this.listener = null;
  }
  send(event: IncognitoMessageEvent): void {
    this.listener?.(event);
  }
}

describe('incognito snapshot session', () => {
  it('puts only session routing information in the game URL fragment', () => {
    const url = createIncognitoSessionUrl('https://game.example/play?theme=dark', request());
    const parsed = new URL(url);
    expect(parsed.search).toBe('?theme=dark');
    expect(parsed.hash).toContain('foundationIncognito=12345678-1234-4234-8234-123456789abc');
    expect(parsed.hash).toContain('foundationAdminOrigin=https%3A%2F%2Foperator.example');
    expect(url).not.toContain('actual-player');
    expect(url).not.toContain('blob');
    expect(readIncognitoSessionRequest(parsed.hash)).toEqual(request());
    expect(readIncognitoSessionRequest(parsed.hash.slice(1))).toBeNull();
    expect(
      readIncognitoSessionRequest(
        `?foundationIncognito=${request().sessionId}&foundationAdminOrigin=https://operator.example`,
      ),
    ).toBeNull();
    expect(() => createIncognitoSessionUrl('https://secret@game.example/', request())).toThrow(
      'without credentials',
    );
    expect(() => createIncognitoSessionUrl('http://game.example/', request())).toThrow('https');
    expect(createIncognitoSessionUrl('http://localhost:5173/', request())).toContain(
      '#foundationIncognito',
    );
    expect(() =>
      createIncognitoSessionRequest({
        adminOrigin: 'http://operator.example',
        sessionId: request().sessionId,
      }),
    ).toThrow('https');
  });

  it('announces ready/loaded/failed only to the configured exact operator origin', () => {
    const postMessage = vi.fn();
    const opener = { postMessage };
    expect(announceIncognitoReady(request(), opener)).toBe(true);
    expect(announceIncognitoLoaded(request(), opener)).toBe(true);
    expect(announceIncognitoFailed(request(), opener)).toBe(true);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      { protocol: INCOGNITO_PROTOCOL, kind: 'ready', sessionId: request().sessionId },
      'https://operator.example',
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      { protocol: INCOGNITO_PROTOCOL, kind: 'loaded', sessionId: request().sessionId },
      'https://operator.example',
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      3,
      { protocol: INCOGNITO_PROTOCOL, kind: 'failed', sessionId: request().sessionId },
      'https://operator.example',
    );
    expect(announceIncognitoReady(request(), null)).toBe(false);
  });

  it('accepts a snapshot only from the original opener at the exact configured origin', async () => {
    const opener = {};
    const host = new Host(opener);
    const pending = waitForIncognitoSnapshot(request(), { host, timeoutMs: 1_000 });
    host.send({ origin: 'https://operator.example', source: {}, data: snapshot() });
    host.send({ origin: 'https://wrong.example', source: opener, data: snapshot() });
    host.send({
      origin: 'https://operator.example',
      source: opener,
      data: snapshot({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    });
    expect(
      validateIncognitoSnapshotMessage(
        { origin: 'https://operator.example', source: opener, data: snapshot() },
        { request: request(), opener },
      ),
    ).toEqual(snapshot());
    expect(
      validateIncognitoSnapshotMessage(
        {
          origin: 'https://operator.example',
          source: opener,
          data: { ...snapshot(), enc: 'gzip+b64' },
        },
        { request: request(), opener },
      ),
    ).toBeNull();
    host.send({ origin: 'https://operator.example', source: opener, data: snapshot() });
    expect(await pending).toEqual(snapshot());
  });

  it('migrates the retained blob into an isolated synthetic player slot', async () => {
    const session = await seedIncognitoSnapshot({
      gameId: 'counter',
      codec: counterCodec,
      snapshot: snapshot(),
      progressOf: (s) => s.progress,
      now: () => 5_000,
    });
    expect(session.playerId).toBe(`incognito-${request().sessionId}`);
    expect(session.playerId).not.toBe(snapshot().playerKey);
    expect(session.state).toEqual({ count: 7, ticks: 2, progress: 7 });
    expect(session.envelope).toMatchObject({
      generation: 3,
      lastAckedSeq: 17,
      dirty: false,
      savedAt: 5_000,
      schemaVersion: 2,
    });
    expect(
      createSlot(session.storage, slotKey('counter', session.playerId), counterCodec, {
        gameId: 'counter',
        playerId: session.playerId,
      }).read(),
    ).toMatchObject({ ok: true, envelope: { state: { count: 7, ticks: 2, progress: 7 } } });
    expect(session.localStorage.getItem(slotKey('counter', 'actual-player'))).toBeNull();
    session.dispose();
    expect(session.localStorage.length).toBe(0);
  });

  it('bounds the canonical admin blob before decode', async () => {
    await expect(
      seedIncognitoSnapshot({
        gameId: 'counter',
        codec: counterCodec,
        snapshot: snapshot({ blob: 'x'.repeat(DEFAULT_INCOGNITO_MAX_BLOB_BYTES + 1) }),
        progressOf: (s) => s.progress,
      }),
    ).rejects.toThrow('exceeds canonical blob limit');
  });

  it('boots through an isolated memory slot and cannot reach global fetch', async () => {
    const session = await seedIncognitoSnapshot({
      gameId: 'counter',
      codec: counterCodec,
      snapshot: snapshot(),
      progressOf: (s) => s.progress,
      now: () => 5_000,
    });
    const globalFetch = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', globalFetch);
    const clock = new FakeClock(10_000);
    const timers = createFakeTimers(clock);
    const client = createGameClient({
      gameId: 'counter',
      serverUrl: 'https://api.example',
      engine: counterEngine(),
      codec: counterCodec,
      platform: createStandalonePlatform({ playerId: session.playerId, token: 'incognito-only' }),
      clock: boundClock(clock),
      timers,
      ...incognitoClientOptions(session),
    });
    await client.boot();
    expect(client.state()).toEqual({ count: 7, ticks: 2, progress: 7 });
    client.dispatch({ type: 'inc', n: 2 });
    expect(client.state().count).toBe(9);
    client.reportError(new Error('disposable-test'));
    await timers.advance(60_000);
    expect(globalFetch).not.toHaveBeenCalled();
    client.destroy();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });
});
