// Game context: the wired client + api + live-ops config (GET /v1/config, re-fetched every 30 s
// and on visible → "config publish without rebuild"), grant application (grants are the one
// reward primitive: claim on the server, then dispatch {type:'grant'} into the engine), boot-time
// purchase adjustments (unconditional boot instructions, acked after apply), toasts.
import type { Grant, GrantClaimResult, ConfigResponse } from '@foundation/contracts';
import { mintId, type Clock, type GameClient } from '@foundation/client';
import { useVisibility } from '@foundation/client/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { GameApi } from './api.ts';
import type { GameConfig } from './config.ts';
import type { TemplateAction, TemplateEffect, TemplateState } from './engine.ts';
import { compareBuildVersions } from './versions.ts';

export type TemplateClient = GameClient<TemplateState, TemplateAction, TemplateEffect>;

export type LiveConfig = Pick<
  ConfigResponse,
  'flags' | 'schedules' | 'killSwitches' | 'minBuildVersion' | 'maintenance' | 'contentVersions'
> & { fetchedAt: number };

export interface Toast {
  id: number;
  text: string;
}

export interface GameContextValue {
  cfg: GameConfig;
  client: TemplateClient;
  api: GameApi;
  clock: Clock;
  live: LiveConfig | null;
  liveError: string | null;
  refreshConfig(): Promise<void>;
  /** The public config's minBuildVersion is above this build, the server answered 426 build_too_old on any call, or the sync client halted on it. */
  updateRequired: boolean;
  /** Claim a grant on the server, then apply its rewards to the engine. */
  claimGrant(grantKey: string): Promise<GrantClaimResult | null>;
  applyGrant(grant: Grant): void;
  toast(text: string): void;
  toasts: Toast[];
  /** Diagnostics opt-in (PrivacyPanel): game-authored integrity events are sent only when true. */
  diagnostics: boolean;
  setDiagnostics(v: boolean): void;
  /** Bumped when server-side player data changed (claims, purchases) so panels re-fetch. */
  serverRev: number;
  bumpServer(): void;
}

const Ctx = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame: wrap the tree in <GameProvider>');
  return v;
}

const DIAG_KEY = 'template:diagnostics';

/** Sum a grant's rewards into one engine action per currency (+ one per cosmetic). */
export function grantActions(grant: Grant): TemplateAction[] {
  let gold = 0;
  let gems = 0;
  const cosmetics: string[] = [];
  for (const r of grant.rewards) {
    if (r.kind === 'soft_currency') gold += r.amount;
    else if (r.kind === 'premium_currency') gems += r.amount;
    else if (r.kind === 'cosmetic') cosmetics.push(r.cosmeticId);
    // items are not modelled by the template engine
  }
  const out: TemplateAction[] = [];
  const first = cosmetics.shift();
  out.push({
    type: 'grant',
    ref: grant.grantKey,
    ...(gold ? { gold } : {}),
    ...(gems ? { gems } : {}),
    ...(first ? { cosmetic: first } : {}),
  });
  for (const c of cosmetics) out.push({ type: 'grant', ref: grant.grantKey, cosmetic: c });
  return out;
}

export function GameProvider(props: {
  cfg: GameConfig;
  client: TemplateClient;
  api: GameApi;
  clock: Clock;
  booted: boolean;
  children: ReactNode;
}) {
  const { cfg, client, api, clock, booted } = props;
  const [live, setLive] = useState<LiveConfig | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [status426, setStatus426] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [serverRev, setServerRev] = useState(0);
  const [diagnostics, setDiagnosticsState] = useState<boolean>(
    () => client.storage.get(DIAG_KEY) !== '0',
  );
  const toastId = useRef(0);
  const visible = useVisibility();

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-7), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6_000);
  }, []);

  type ConfigFetch =
    | { kind: 'ok'; live: LiveConfig }
    | { kind: 'update_required' }
    | { kind: 'error'; message: string };
  const fetchConfig = useCallback(async (): Promise<ConfigFetch> => {
    const authed = client.booted && client.player !== null;
    const r = await api.liveops.config(authed);
    if (r.ok) {
      const b = r.body;
      return {
        kind: 'ok',
        live: {
          schedules: b.schedules,
          killSwitches: b.killSwitches,
          minBuildVersion: b.minBuildVersion,
          maintenance: b.maintenance,
          contentVersions: b.contentVersions,
          fetchedAt: clock.now(),
          ...(b.flags ? { flags: b.flags } : {}),
        },
      };
    }
    if (r.status === 426) return { kind: 'update_required' };
    return {
      kind: 'error',
      message: r.status === 0 ? (r.networkError ?? 'network') : `http ${r.status}`,
    };
  }, [api, client, clock]);
  const applyConfig = useCallback(
    (c: ConfigFetch) => {
      if (c.kind === 'ok') {
        setLive(c.live);
        setLiveError(null);
        setStatus426(false);
        // an authenticated 200 means this build is acceptable again (minBuild lowered): clear a
        // 426 halt so the sync timer resumes
        if (client.booted && client.sync.halted() === 'update_required') client.sync.resume();
      } else if (c.kind === 'update_required') setStatus426(true);
      else setLiveError(c.message);
    },
    [client],
  );
  const refreshConfig = useCallback(
    () => fetchConfig().then(applyConfig),
    [fetchConfig, applyConfig],
  );

  // config: on mount + once booted (authenticated: per-player flags), then every configRefreshMs
  // while visible, and again on every hidden → visible transition
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void fetchConfig().then((c) => {
        if (alive) applyConfig(c);
      });
    };
    tick();
    const h = visible ? setInterval(tick, cfg.configRefreshMs) : null;
    return () => {
      alive = false;
      if (h !== null) clearInterval(h);
    };
  }, [fetchConfig, applyConfig, visible, booted, cfg.configRefreshMs]);
  // any authenticated call answered 426 → update banner
  useEffect(
    () =>
      api.onStatus((s) => {
        if (s === 426) setStatus426(true);
      }),
    [api],
  );

  const applyGrant = useCallback(
    (grant: Grant) => {
      for (const a of grantActions(grant)) client.dispatch(a);
      client.saveNow('important');
    },
    [client],
  );

  const claimGrant = useCallback(
    async (grantKey: string): Promise<GrantClaimResult | null> => {
      const r = await api.grants.claim({ commandId: mintId(), grantKey });
      if (!r.ok) {
        toast(`Claim failed (${r.error?.error ?? `http ${r.status}`})`);
        return null;
      }
      if (r.body.outcome === 'claimed' && r.body.grant) applyGrant(r.body.grant);
      else if (r.body.outcome !== 'claimed') toast(`Claim: ${r.body.outcome}`);
      setServerRev((n) => n + 1);
      return r.body;
    },
    [api, applyGrant, toast],
  );

  // boot-time work once live: pending purchase adjustments (apply then ack), storage_blocked
  // integrity event when the local tier is the memory shim (blocked ≠ empty).
  const bootWork = useRef(false);
  useEffect(() => {
    if (!booted || bootWork.current) return;
    bootWork.current = true;
    void (async () => {
      const mine = await api.purchases.mine();
      if (mine.ok && mine.body.pendingAdjustments.length) {
        for (const adj of mine.body.pendingAdjustments)
          client.dispatch({ type: 'adjust', gems: adj.delta, ref: `adjustment:${adj.id}` });
        client.saveNow('important');
        await api.purchases.ackAdjustments({
          commandId: mintId(),
          adjustmentIds: mine.body.pendingAdjustments.map((a) => a.id),
        });
        toast(`Applied ${mine.body.pendingAdjustments.length} purchase adjustment(s)`);
        setServerRev((n) => n + 1);
      }
      if (client.storage.mode === 'memory' && diagnostics) {
        await api.telemetry.integrity({
          commandId: mintId(),
          events: [
            {
              kind: 'storage_blocked',
              at: clock.now(),
              detail: { mode: 'memory', error: client.storage.lastError() ?? '' },
              buildVersion: cfg.buildVersion,
            },
          ],
        });
      }
    })();
  }, [api, booted, cfg.buildVersion, client, clock, diagnostics, toast]);

  const setDiagnostics = useCallback(
    (v: boolean) => {
      setDiagnosticsState(v);
      client.storage.set(DIAG_KEY, v ? '1' : '0');
    },
    [client],
  );

  const haltedSubscribe = useCallback(
    (cb: () => void) => (booted ? client.sync.onEvent(() => cb()) : () => {}),
    [client, booted],
  );
  const haltedGet = useCallback(
    () => booted && client.sync.halted() === 'update_required',
    [client, booted],
  );
  const halted = useSyncExternalStore(haltedSubscribe, haltedGet, haltedGet);

  const value = useMemo<GameContextValue>(
    () => ({
      cfg,
      client,
      api,
      clock,
      live,
      liveError,
      refreshConfig,
      updateRequired:
        status426 ||
        halted ||
        (live !== null && compareBuildVersions(cfg.buildVersion, live.minBuildVersion) < 0),
      claimGrant,
      applyGrant,
      toast,
      toasts,
      diagnostics,
      setDiagnostics,
      serverRev,
      bumpServer: () => setServerRev((n) => n + 1),
    }),
    [
      cfg,
      client,
      api,
      clock,
      live,
      liveError,
      refreshConfig,
      status426,
      halted,
      claimGrant,
      applyGrant,
      toast,
      toasts,
      diagnostics,
      setDiagnostics,
      serverRev,
    ],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
