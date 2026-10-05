// Small subscriptions over the adapter's observable pieces (boot machine, leader role, sync
// envelope). Everything renders from the client's own state — the UI never keeps a shadow copy.
import type { BootState, CacheEnvelope, LeaderRole } from '@foundation/client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { TemplateState } from '../engine.ts';
import type { TemplateClient } from '../game.tsx';

export function useBootState(client: TemplateClient): BootState<TemplateState> {
  const subscribe = useCallback(
    (cb: () => void) => client.bootMachine.onChange(() => cb()),
    [client],
  );
  const get = useCallback(() => client.bootMachine.state(), [client]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useLeaderRole(client: TemplateClient): LeaderRole {
  const subscribe = useCallback(
    (cb: () => void) => {
      const a = client.leader.onChange(() => cb());
      const b = client.onEvent((e) => {
        if (e.type === 'leader') cb();
      });
      return () => {
        a();
        b();
      };
    },
    [client],
  );
  const get = useCallback(() => client.leader.role(), [client]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The sync envelope (generation, acked seq, verdict …) refreshed on every sync event + every second. */
export function useEnvelope(
  client: TemplateClient,
  booted: boolean,
): CacheEnvelope<TemplateState> | null {
  const [env, setEnv] = useState<CacheEnvelope<TemplateState> | null>(null);
  useEffect(() => {
    if (!booted) return;
    const read = (): void => setEnv(client.sync.envelope());
    read();
    const off = client.sync.onEvent(read);
    const h = setInterval(read, 1000);
    return () => {
      off();
      clearInterval(h);
    };
  }, [client, booted]);
  return env;
}

/** Re-render every `ms` (for "n s ago" style readouts). */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
  return n;
}
