// React shells and hooks (§5.3): PlatformProvider, LoadingGate (markLoaded once), RegistrationGate,
// ErrorBoundary (game_error integrity events with breadcrumbs), useSaveSync, useVisibility,
// useTeardown, useTickScheduler, useEffects(kinds), defineModals + ONE Z table, MaintenanceScreen,
// UpdateBanner, Inbox, SyncPill, PrivacyPanel (diagnostics toggle only), useGameState(selector).
// React 19, no CSS framework: every element carries a stable `foundation-*` className hook.
import type { InboxLetter, PendingQuarantine } from '@foundation/contracts';
import type { SyncVerdict } from '@foundation/contracts/enums';
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ContextType,
  type ReactNode,
} from 'react';
import type { Effect } from '../engine/contract.ts';
import type { GameClient } from '../game-client.ts';
import type { PlatformAdapter } from '../providers/types.ts';
import type { PushReport, SyncStatus } from '../sync/client.ts';

// ─── Platform context ─────────────────────────────────────────────────────

const PlatformContext = createContext<PlatformAdapter | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ClientContext = createContext<GameClient<any, any, any> | null>(null);

export function PlatformProvider(props: {
  platform: PlatformAdapter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: GameClient<any, any, any>;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={props.platform}>
      <ClientContext.Provider value={props.client ?? null}>{props.children}</ClientContext.Provider>
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformAdapter {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('usePlatform: wrap the tree in <PlatformProvider>');
  return p;
}

export function useGameClient<S, A, E extends Effect>(): GameClient<S, A, E> {
  const c = useContext(ClientContext);
  if (!c) throw new Error('useGameClient: pass `client` to <PlatformProvider>');
  return c as GameClient<S, A, E>;
}

// ─── State selectors ──────────────────────────────────────────────────────

/** `useState(selector)` style: re-renders only when the selected value changes (Object.is). */
export function useGameState<S, T>(
  client: { subscribe(cb: () => void): () => void; state(): S },
  selector: (s: S) => T,
): T {
  const subscribe = useCallback((cb: () => void) => client.subscribe(cb), [client]);
  // selectors must be referentially stable for object results (like any external-store selector)
  const get = (): T => selector(client.state());
  return useSyncExternalStore(subscribe, get, get);
}

/** Effects of the given kinds, drained from the ring as they arrive (bounded ring, §5.1). */
export function useEffects<E extends Effect>(
  client: {
    effects: { drain(kinds?: readonly string[]): E[]; subscribe(cb: () => void): () => void };
  },
  kinds: readonly string[],
): E[] {
  const [items, setItems] = useState<E[]>([]);
  const key = kinds.join('|');
  useEffect(() => {
    const pull = (): void => {
      const got = client.effects.drain(kinds);
      if (got.length) setItems((prev) => [...prev.slice(-63), ...got]);
    };
    pull();
    return client.effects.subscribe(pull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return items;
}

/** Ticks a callback on a fixed interval while visible (UI-side timers, not the sim loop). */
export function useTickScheduler(cb: () => void, intervalMs: number, enabled = true): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  const visible = useVisibility();
  useEffect(() => {
    if (!enabled || !visible) return;
    const h = setInterval(() => ref.current(), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs, enabled, visible]);
}

export function useVisibility(): boolean {
  const platform = useContext(PlatformContext);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (platform) return platform.lifecycle.onVisibilityChange(() => cb());
      const doc = (globalThis as { document?: Document }).document;
      if (!doc) return () => {};
      doc.addEventListener('visibilitychange', cb);
      return () => doc.removeEventListener('visibilitychange', cb);
    },
    [platform],
  );
  const get = useCallback(() => {
    if (platform) return platform.lifecycle.visible();
    const doc = (globalThis as { document?: Document }).document;
    return doc ? doc.visibilityState !== 'hidden' : true;
  }, [platform]);
  return useSyncExternalStore(subscribe, get, () => true);
}

/** Runs `fn` on hidden/pagehide (the teardown path — the adapter already beacons; this is for game UI). */
export function useTeardown(fn: () => void): void {
  const platform = useContext(PlatformContext);
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!platform) return;
    const a = platform.lifecycle.onVisibilityChange((v) => {
      if (!v) ref.current();
    });
    const b = platform.lifecycle.onPageHide(() => ref.current());
    return () => {
      a();
      b();
    };
  }, [platform]);
}

export interface SaveSyncView {
  status: SyncStatus;
  text: string;
  lastVerdict: SyncVerdict | null;
  lastReport: PushReport | null;
  /**
   * A newer (or the only) save awaits review on the server, as of the last head check — set even
   * when this device's cache was empty and the remote had no anchor (audit F8): the player learns
   * "a newer save is awaiting review" instead of silently starting new.
   */
  pendingReview: PendingQuarantine | null;
  saveNow(): void;
}

/** Player-visible sync status + last verdict, refreshed on every verdict and every `refreshMs`. */
export function useSaveSync<S, A, E extends Effect>(
  client: GameClient<S, A, E>,
  refreshMs = 5_000,
): SaveSyncView {
  const [tick, setTick] = useState(0);
  const [lastReport, setLastReport] = useState<PushReport | null>(null);
  useEffect(() => {
    if (!client.booted) return;
    const off = client.sync.onVerdict((_v, report) => {
      setLastReport(report);
      setTick((t) => t + 1);
    });
    const h = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => {
      off();
      clearInterval(h);
    };
  }, [client, client.booted, refreshMs]);
  return useMemo(() => {
    void tick;
    const booted = client.booted;
    const status: SyncStatus = booted ? client.sync.status() : { kind: 'local_only' };
    const text = booted ? client.sync.statusText() : 'Loading…';
    const lastVerdict = booted ? client.sync.envelope().lastVerdict : null;
    const pendingReview = booted
      ? (client.bootMachine.state().pendingQuarantine ?? client.sync.pendingQuarantine())
      : null;
    return {
      status,
      text,
      lastVerdict,
      lastReport,
      pendingReview,
      saveNow: () => client.saveNow('important'),
    };
  }, [client, tick, lastReport]);
}

// ─── Gates and shells ─────────────────────────────────────────────────────

/** Calls platform.loading.markLoaded() exactly once when `ready` flips true; renders `fallback` before. */
export function LoadingGate(props: { ready: boolean; fallback?: ReactNode; children: ReactNode }) {
  const platform = usePlatform();
  const marked = useRef(false);
  useEffect(() => {
    if (props.ready && !marked.current) {
      marked.current = true;
      platform.loading.markLoaded();
    }
  }, [props.ready, platform]);
  return (
    <>
      {props.ready
        ? props.children
        : (props.fallback ?? <div className="foundation-loading">Loading…</div>)}
    </>
  );
}

/** Registered gate for codes / board visibility / referral credit (§4.2). */
export function RegistrationGate(props: {
  registered: boolean;
  prompt?: ReactNode;
  /** Calls the provider's registration flow. Resolving may mean either completion or dismissal. */
  onLogin?: () => void | Promise<void>;
  loginLabel?: ReactNode;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (props.registered) return <>{props.children}</>;
  const login = async (): Promise<void> => {
    if (!props.onLogin || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="foundation-registration-gate">
      {props.prompt ?? <p>Sign in to use this feature.</p>}
      {props.onLogin ? (
        <button
          className="foundation-registration-login"
          disabled={busy}
          onClick={() => void login()}
        >
          {busy ? 'Opening…' : (props.loginLabel ?? 'Sign in')}
        </button>
      ) : null}
      {error ? (
        <p className="foundation-registration-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ErrorBoundaryProps {
  onError?: (error: unknown) => void;
  fallback?: ReactNode | ((error: unknown, reset: () => void) => ReactNode);
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: unknown | null;
}

/** Reports game_error integrity events with breadcrumbs through the client (or a callback). */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static override contextType = ClientContext;
  declare context: ContextType<typeof ClientContext>;
  override state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }
  override componentDidCatch(error: unknown): void {
    try {
      this.context?.reportError(error, { boundary: true });
    } catch {
      /* the boundary never throws */
    }
    this.props.onError?.(error);
  }
  reset = (): void => this.setState({ error: null });
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const f = this.props.fallback;
    if (typeof f === 'function') return f(this.state.error, this.reset);
    return (
      f ?? (
        <div className="foundation-error" role="alert">
          <p>Something went wrong.</p>
          <button className="foundation-error-retry" onClick={this.reset}>
            Try again
          </button>
        </div>
      )
    );
  }
}

/** ONE Z table for every layer (no ad-hoc z-index anywhere else). */
export const Z_TABLE = {
  base: 0,
  hud: 10,
  banner: 20,
  modal: 30,
  toast: 40,
  maintenance: 50,
} as const;
export type ZLayer = keyof typeof Z_TABLE;

export interface ModalDef<P> {
  id: string;
  layer?: ZLayer;
  render: (props: P, ctl: { close(): void }) => ReactNode;
}

/** Declare modals once; `useModals()` opens/closes by id and stacks them by the Z table. */
export function defineModals<M extends Record<string, ModalDef<never>>>(defs: M) {
  type Id = keyof M & string;
  type Open = { id: Id; props: unknown };
  const listeners = new Set<() => void>();
  let stack: Open[] = [];
  const notify = (): void => {
    for (const l of listeners) l();
  };
  const api = {
    defs,
    open<K extends Id>(id: K, props: M[K] extends ModalDef<infer P> ? P : never): void {
      stack = [...stack.filter((s) => s.id !== id), { id, props }];
      notify();
    },
    close(id: Id): void {
      stack = stack.filter((s) => s.id !== id);
      notify();
    },
    closeAll(): void {
      stack = [];
      notify();
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    current: (): readonly Open[] => stack,
  };
  function ModalHost() {
    const open = useSyncExternalStore(api.subscribe, api.current, api.current);
    return (
      <>
        {open.map((o) => {
          const def = defs[o.id]!;
          const z = Z_TABLE[def.layer ?? 'modal'];
          const render = def.render as (p: unknown, ctl: { close(): void }) => ReactNode;
          return (
            <div
              key={o.id}
              className={`foundation-modal foundation-modal-${o.id}`}
              style={{ zIndex: z, position: 'fixed', inset: 0 }}
              role="dialog"
            >
              {render(o.props, { close: () => api.close(o.id) })}
            </div>
          );
        })}
      </>
    );
  }
  return { ...api, ModalHost };
}

export function MaintenanceScreen(props: { message?: string; retry?: () => void }) {
  return (
    <div
      className="foundation-maintenance"
      role="alert"
      style={{ zIndex: Z_TABLE.maintenance, position: 'fixed', inset: 0 }}
    >
      <p>{props.message ?? 'We are doing maintenance. Your progress is safe.'}</p>
      {props.retry ? (
        <button className="foundation-maintenance-retry" onClick={props.retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Version-check banner (ADR-010): reload at a safe point; forced when the server says 426. */
export function UpdateBanner(props: {
  visible: boolean;
  forced?: boolean;
  onReload: () => void;
  message?: string;
}) {
  if (!props.visible) return null;
  return (
    <div className="foundation-update-banner" role="status" style={{ zIndex: Z_TABLE.banner }}>
      <span>
        {props.message ??
          (props.forced ? 'An update is required to keep playing.' : 'A new version is available.')}
      </span>
      <button className="foundation-update-reload" onClick={props.onReload}>
        {props.forced ? 'Update now' : 'Reload'}
      </button>
    </div>
  );
}

/** Renders letters from a passed loader (GET /v1/inbox); read/claim handlers are the game's. */
export function Inbox(props: {
  load: () => Promise<{ letters: InboxLetter[]; unread: number }>;
  onRead?: (letter: InboxLetter) => void;
  onClaim?: (letter: InboxLetter) => void;
  empty?: ReactNode;
}) {
  const [data, setData] = useState<{ letters: InboxLetter[]; unread: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = props.load;
  useEffect(() => {
    let alive = true;
    load().then(
      (d) => {
        if (alive) setData(d);
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [load]);
  if (error)
    return <div className="foundation-inbox foundation-inbox-error">Inbox unavailable</div>;
  if (!data) return <div className="foundation-inbox foundation-inbox-loading">Loading…</div>;
  if (data.letters.length === 0)
    return (
      <div className="foundation-inbox foundation-inbox-empty">{props.empty ?? 'No messages'}</div>
    );
  return (
    <ul className="foundation-inbox" data-unread={data.unread}>
      {data.letters.map((l) => (
        <li
          key={l.id}
          className={`foundation-letter foundation-letter-${l.kind}${l.readAt ? ' is-read' : ''}`}
        >
          <h4 className="foundation-letter-title">{l.title}</h4>
          <p className="foundation-letter-body">{l.body}</p>
          <div className="foundation-letter-actions">
            {!l.readAt && props.onRead ? (
              <button className="foundation-letter-read" onClick={() => props.onRead?.(l)}>
                Mark read
              </button>
            ) : null}
            {l.grantKey && !l.claimedAt && props.onClaim ? (
              <button className="foundation-letter-claim" onClick={() => props.onClaim?.(l)}>
                Claim
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Player-visible sync status pill ("Saved to cloud 42 s ago" / "Cloud unavailable — saving on this device" / …). */
export function SyncPill<S, A, E extends Effect>(props: {
  client: GameClient<S, A, E>;
  refreshMs?: number;
}) {
  const view = useSaveSync(props.client, props.refreshMs ?? 5_000);
  return (
    <span
      className={`foundation-sync-pill foundation-sync-${view.status.kind}`}
      title={view.lastVerdict ?? ''}
      role="status"
    >
      {view.text}
    </span>
  );
}

/** Privacy panel: the diagnostics toggle only (no analytics opt-outs live here on Jest). */
export function PrivacyPanel(props: {
  diagnostics: boolean;
  onChange: (enabled: boolean) => void;
  description?: string;
}) {
  return (
    <section className="foundation-privacy">
      <label className="foundation-privacy-diagnostics">
        <input
          type="checkbox"
          checked={props.diagnostics}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span>
          {props.description ?? 'Send anonymous diagnostics (error breadcrumbs) to help fix bugs'}
        </span>
      </label>
    </section>
  );
}
