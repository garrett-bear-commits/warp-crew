import type { IdleCivClient } from '../../src/store.ts';
import { idleCivEngine, type IdleCivAction, type IdleCivEffect } from '../../src/sim/index.ts';
import { ctx, fresh } from './helpers.ts';

export function fakeClient(): IdleCivClient {
  let state = fresh();
  const subs = new Set<() => void>();
  const notify = (): void => {
    for (const s of subs) s();
  };
  const effects: IdleCivEffect[] = [];
  return {
    dispatch(action: IdleCivAction) {
      const r = idleCivEngine.apply(state, action, ctx(0));
      state = r.state;
      effects.push(...r.effects);
      notify();
    },
    state: () => state,
    rev: () => state.acceptedActions,
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    effects: {
      drain: () => effects.splice(0, effects.length),
      subscribe: () => () => {},
    },
    booted: true,
    bootMachine: {
      state: () => ({
        phase: 'live',
        player: null,
        preview: null,
        decision: null,
        prompt: null,
        pendingQuarantine: null,
        blockedReason: null,
        notes: [],
      }),
      onChange: () => () => {},
      startNew: () => {},
      retry: () => {},
    },
    platform: {
      analytics: { markFirstMilestone: () => {}, track: () => {} },
    },
  } as unknown as IdleCivClient;
}
