import { describe, expect, it } from 'vitest';
import { createIdleCivStore } from '../../src/store.ts';
import { fakeClient } from './fake-client.ts';

describe('Zustand store', () => {
  it('mirrors sim and routes assign through the engine', () => {
    const store = createIdleCivStore();
    const client = fakeClient();
    store.getState().bind(client);
    expect(store.getState().view?.population).toBe(5);
    expect(store.getState().overlay).toBe('none');
    store.getState().assign('forager', 5);
    expect(store.getState().sim?.workers.forager).toBe(5);
    expect(store.getState().sim?.foodStabilized).toBe(true);
    expect(store.getState().overlay).toBe('kit');
    store.getState().equipKit();
    expect(store.getState().sim?.kitEquipped).toBe(true);
    expect(store.getState().overlay).toBe('none');
  });
});
