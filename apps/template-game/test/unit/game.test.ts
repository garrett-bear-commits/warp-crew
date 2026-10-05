// Game glue: grant → engine actions, player id resolution, catalog/config defaults.
import type { Grant } from '@foundation/contracts';
import { createStorage, memoryStorage } from '@foundation/client';
import { describe, expect, it } from 'vitest';
import { CATALOG, PLAYER_ID_KEY, resolvePlayerId } from '../../src/config.ts';
import { grantActions } from '../../src/game.tsx';
import { compareBuildVersions } from '../../src/versions.ts';

const grant = (rewards: Grant['rewards']): Grant => ({
  grantKey: 'g:1',
  source: 'admin',
  rewards,
  reason: 'test',
  createdAt: 1,
});

describe('grantActions', () => {
  it('sums soft and premium currency into one grant action and keeps the grantKey as ref', () => {
    const a = grantActions(
      grant([
        { kind: 'soft_currency', currency: 'gold', amount: 100 },
        { kind: 'soft_currency', currency: 'gold', amount: 50 },
        { kind: 'premium_currency', amount: 5 },
      ]),
    );
    expect(a).toEqual([{ type: 'grant', ref: 'g:1', gold: 150, gems: 5 }]);
  });
  it('emits one action per extra cosmetic; items are ignored by the template engine', () => {
    const a = grantActions(
      grant([
        { kind: 'cosmetic', cosmeticId: 'hat' },
        { kind: 'cosmetic', cosmeticId: 'badge' },
        { kind: 'item', itemId: 'potion', qty: 3 },
      ]),
    );
    expect(a).toEqual([
      { type: 'grant', ref: 'g:1', cosmetic: 'hat' },
      { type: 'grant', ref: 'g:1', cosmetic: 'badge' },
    ]);
  });
  it('an empty grant still records one (zero) grant action so the claim is visible in the journal', () => {
    expect(grantActions(grant([]))).toEqual([{ type: 'grant', ref: 'g:1' }]);
  });
});

describe('resolvePlayerId', () => {
  it('?player wins, else the stored id, else a fresh UUID that is persisted', () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    expect(resolvePlayerId(storage, new URLSearchParams('player=abc-1'))).toBe('abc-1');
    const fresh = resolvePlayerId(storage, new URLSearchParams(''));
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.get(PLAYER_ID_KEY)).toBe(fresh);
    expect(resolvePlayerId(storage, new URLSearchParams(''))).toBe(fresh);
  });
  it('rejects ids that would break the dot-separated mock token', () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    const id = resolvePlayerId(storage, new URLSearchParams('player=a.b'));
    expect(id).not.toBe('a.b');
  });
});

describe('catalog mirror', () => {
  it('mirrors the server catalog SKUs', () => {
    expect(CATALOG.map((c) => c.sku)).toEqual(['gems_100', 'gems_550', 'gems_1200']);
  });
});

describe('compareBuildVersions (same rule as the server minBuild check)', () => {
  it('orders numeric segments, ignores -pre and +meta, pads missing segments', () => {
    expect(compareBuildVersions('1.0.0-dev', '9.9.9')).toBe(-1);
    expect(compareBuildVersions('9.9.9', '1.0.0-dev')).toBe(1);
    expect(compareBuildVersions('1.0.0-dev', '0.0.0')).toBe(1);
    expect(compareBuildVersions('2.0.0+abc', '2.0.0')).toBe(0);
    expect(compareBuildVersions('2.0', '2.0.0')).toBe(0);
    expect(compareBuildVersions('1.10.0', '1.9.9')).toBe(1);
  });
});
