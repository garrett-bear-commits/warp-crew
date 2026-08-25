import { createClock, INCOGNITO_PROTOCOL, type IncognitoSnapshot } from '@foundation/client';
import { FakeClock } from '@foundation/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleCivIncognitoRuntime } from '../../src/incognito.ts';
import { idleCivCodec } from '../../src/sim/codec.ts';
import { fresh } from './helpers.ts';

describe('idle-civ disposable player snapshot', () => {
  const sendBeaconDescriptor = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
  const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    if (sendBeaconDescriptor) Object.defineProperty(navigator, 'sendBeacon', sendBeaconDescriptor);
    else Reflect.deleteProperty(navigator, 'sendBeacon');
    if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
    else Reflect.deleteProperty(navigator, 'storage');
  });

  it('plays from the retained state without touching browser storage or network', async () => {
    const state = fresh();
    state.settlementName = 'Player village';
    const sourceBlob = idleCivCodec.encode(state);
    const snapshot: IncognitoSnapshot = {
      protocol: INCOGNITO_PROTOCOL,
      kind: 'snapshot',
      sessionId: '12345678-1234-4234-8234-123456789abc',
      playerKey: 'real-player-42',
      seq: 27,
      generation: 4,
      enc: 'json',
      blob: sourceBlob,
      savedAt: 1_700_000_000_000,
    };
    const playerSlot = 'foundation:idle-civ:slot:real-player-42';
    const operatorSlot = 'foundation:idle-civ:slot:operator-player';
    window.localStorage.setItem(playerSlot, 'player-slot-untouched');
    window.localStorage.setItem(operatorSlot, 'operator-slot-untouched');
    const network = vi.fn();
    const beacon = vi.fn();
    const persist = vi.fn();
    vi.stubGlobal('fetch', network);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist },
    });
    const fake = new FakeClock(1_800_000_000_000);
    const clock = createClock({ deviceNow: fake.now, monotonic: fake.now });
    const runtime = await createIdleCivIncognitoRuntime({ snapshot, clock });

    await runtime.client.boot();
    expect(runtime.client.player?.playerId).toMatch(/^incognito-/);
    expect(runtime.client.player?.playerId).not.toBe(snapshot.playerKey);
    expect(runtime.client.state().settlementName).toBe('Player village');

    runtime.client.dispatch({ type: 'assign_worker', profession: 'forager', delta: 1 });
    runtime.client.saveNow('important');
    document.dispatchEvent(new Event('visibilitychange'));
    globalThis.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    expect(runtime.client.state().acceptedActions).toBe(1);
    expect(idleCivCodec.decode(sourceBlob).acceptedActions).toBe(0);
    expect(window.localStorage.getItem(playerSlot)).toBe('player-slot-untouched');
    expect(window.localStorage.getItem(operatorSlot)).toBe('operator-slot-untouched');
    expect(network).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();

    runtime.client.destroy();
    runtime.session.dispose();
  });
});
