import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand/react';
import type { StoreApi } from 'zustand/vanilla';
import { createIdleCivStore, type IdleCivClient, type IdleCivStore } from './store.ts';

const StoreCtx = createContext<StoreApi<IdleCivStore> | null>(null);

export function IdleCivProvider(props: { client: IdleCivClient; children: ReactNode }) {
  const [store] = useState<StoreApi<IdleCivStore>>(() => createIdleCivStore());
  useEffect(() => store.getState().bind(props.client), [props.client, store]);
  return <StoreCtx.Provider value={store}>{props.children}</StoreCtx.Provider>;
}

export function useIdleCiv<T>(selector: (s: IdleCivStore) => T): T {
  const api = useContext(StoreCtx);
  if (!api) throw new Error('useIdleCiv: wrap the tree in <IdleCivProvider>');
  return useStore(api, selector);
}
