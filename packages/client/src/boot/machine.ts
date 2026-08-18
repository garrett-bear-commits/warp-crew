// Boot machine (§5.2 State lifecycle, ADR-005): booting → identityReady → checkingCloud →
// reconciled → live. Instant paint from the lastKnownPlayerId slot (read-only); when identity
// confirms: read the local slot + ALWAYS a bounded server head check (GET /v1/saves/current?meta=1,
// ≤ 800 ms; ~3 s when the cache is empty for a returning identity → "cloud unreachable — retry /
// start new"); reconcile (adopt / keep / prompt / start new); re-push the last unacked snapshot
// BEFORE offline credit; re-check on visible after a long hide. Blocked ≠ empty.
import type { PendingQuarantine } from '@foundation/contracts';
import type { Clock } from '../clock/index.ts';
import type { Timers } from '../ids.ts';
import type { IdentityClient, Player } from '../providers/types.ts';
import {
  createSlot,
  readLastKnownPlayerId,
  slotKey,
  writeLastKnownPlayerId,
  type CacheEnvelope,
  type Slot,
} from '../storage/envelope.ts';
import type { SaveCodec } from '../storage/codec.ts';
import type { StorageTier } from '../storage/tiers.ts';
import type { SyncClient } from '../sync/client.ts';
import { reconcile, type ReconcileDecision, type RemoteHead } from '../sync/reconcile.ts';

export type BootPhase =
  | 'booting'
  | 'identityReady'
  | 'checkingCloud'
  | 'cloudUnreachable'
  | 'prompt'
  | 'reconciled'
  | 'live'
  | 'blocked';

export interface BootPrompt {
  local: { progress: number; savedAt: number; generation: number };
  remote: { progress: number; savedAt: number; seq: number; generation: number };
}

export interface BootState<S> {
  phase: BootPhase;
  player: Player | null;
  /** Instant-paint preview from the lastKnownPlayerId slot; read-only, never written back. */
  preview: S | null;
  decision: ReconcileDecision | null;
  prompt: BootPrompt | null;
  pendingQuarantine: PendingQuarantine | null;
  blockedReason: 'update_required' | 'erased' | 'no_identity' | null;
  /** Non-fatal notes for diagnostics (adopt failure fallback etc.). */
  notes: string[];
}

export interface BootResult<S> {
  player: Player;
  decision: ReconcileDecision;
  generation: number;
  state: S;
  sync: SyncClient<S>;
  /** The local slot was migrated from an older schema at read. */
  migrated: boolean;
}

export interface BootDeps<S> {
  gameId: string;
  identity: IdentityClient;
  storage: StorageTier;
  codec: SaveCodec<S>;
  clock: Clock;
  timers: Timers;
  /** Build the sync client for the confirmed player with the envelope the machine chose. */
  createSync: (player: Player, envelope: CacheEnvelope<S>, slot: Slot<S>) => SyncClient<S>;
  /** Fresh envelope for a player with no usable local slot. */
  newEnvelope: (player: Player) => CacheEnvelope<S>;
  headCheckMs?: number;
  emptyCacheHeadCheckMs?: number;
  /** Hidden for longer than this → re-check the server head on visible (default 5 min). */
  longHideMs?: number;
  onChange?: (s: BootState<S>) => void;
}

export interface BootMachine<S> {
  state(): BootState<S>;
  onChange(cb: (s: BootState<S>) => void): () => void;
  boot(): Promise<BootResult<S>>;
  /** Answer a "keep local / adopt cloud" prompt. */
  resolvePrompt(choice: 'keep_local' | 'adopt_remote'): void;
  /** cloudUnreachable: retry the head check. */
  retry(): void;
  /** cloudUnreachable: start a new game on this device (server head adopted later if deeper). */
  startNew(): void;
  /** Visible again after `hiddenMs`; re-checks the head after a long hide. */
  onVisible(hiddenMs: number): Promise<void>;
  /** Force a bounded head re-check + reconcile now (visible after long hide, manual refresh). */
  recheck(): Promise<ReconcileDecision | null>;
  sync(): SyncClient<S> | null;
  /**
   * Identity switch (audit F1): the adapter built a NEW sync/slot for the new player; every later
   * re-check (visible after a long hide, server_deeper, broadcast, manual) must use it. A re-check
   * that was in flight for the previous player is abandoned at its next await.
   */
  rebind(binding: {
    player: Player;
    sync: SyncClient<S>;
    slot: Slot<S>;
    decision?: ReconcileDecision;
  }): void;
}

export function createBootMachine<S>(deps: BootDeps<S>): BootMachine<S> {
  const headCheckMs = deps.headCheckMs ?? 800;
  const emptyCacheMs = deps.emptyCacheHeadCheckMs ?? 3_000;
  const longHideMs = deps.longHideMs ?? 5 * 60_000;
  const subs = new Set<(s: BootState<S>) => void>();
  let st: BootState<S> = {
    phase: 'booting',
    player: null,
    preview: null,
    decision: null,
    prompt: null,
    pendingQuarantine: null,
    blockedReason: null,
    notes: [],
  };
  let sync: SyncClient<S> | null = null;
  let slot: Slot<S> | null = null;
  let promptResolver: ((c: 'keep_local' | 'adopt_remote') => void) | null = null;
  let unreachableResolver: ((c: 'retry' | 'start_new') => void) | null = null;
  let booted = false;

  const phase = (): BootPhase => st.phase;
  const set = (patch: Partial<BootState<S>>): void => {
    st = { ...st, ...patch };
    deps.onChange?.(st);
    for (const s of subs) s(st);
  };
  const note = (n: string): void => set({ notes: [...st.notes, n] });

  const readPreview = (): S | null => {
    const last = readLastKnownPlayerId(deps.storage, deps.gameId);
    if (!last) return null;
    const s = createSlot(deps.storage, slotKey(deps.gameId, last), deps.codec, {
      gameId: deps.gameId,
      playerId: last,
    });
    const r = s.read();
    return r.ok ? r.envelope.state : null;
  };

  const waitPrompt = (prompt: BootPrompt): Promise<'keep_local' | 'adopt_remote'> =>
    new Promise((resolve) => {
      promptResolver = (c) => {
        promptResolver = null;
        resolve(c);
      };
      set({ phase: 'prompt', prompt });
    });

  const waitUnreachable = (): Promise<'retry' | 'start_new'> =>
    new Promise((resolve) => {
      unreachableResolver = (c) => {
        unreachableResolver = null;
        resolve(c);
      };
      set({ phase: 'cloudUnreachable' });
    });

  const promptFrom = (local: CacheEnvelope<S>, head: RemoteHead): BootPrompt | null => {
    if (head.kind !== 'snapshot') return null;
    return {
      local: { progress: local.progress, savedAt: local.savedAt, generation: local.generation },
      remote: {
        progress: head.snapshot.progress,
        savedAt: head.snapshot.savedAt ?? 0,
        seq: head.snapshot.seq,
        generation: head.generation,
      },
    };
  };

  /** The sync client this step started with was replaced (identity switch): abandon the step. */
  const stale = (s: SyncClient<S>): boolean => s !== sync;

  /** Act on a decision against `s`'s envelope. Returns false when the adoption failed / was abandoned. */
  const act = async (
    s: SyncClient<S>,
    decision: ReconcileDecision,
    head: RemoteHead | null,
    hadLocal: boolean,
  ): Promise<boolean> => {
    switch (decision.action) {
      case 'keep_local':
        return true;
      case 'adopt_remote': {
        if (decision.pushLocalFirst && hadLocal) await s.bootRepush();
        if (stale(s)) return false;
        const env = s.envelope();
        const needAdopt =
          !!head &&
          (env.generation < decision.generation ||
            (head.kind === 'snapshot' &&
              head.generation === env.generation &&
              head.snapshot.progress > env.progress) ||
            !hadLocal);
        if (!needAdopt || !head) return true;
        const r = await s.adoptRemote(head, 'boot');
        if (!r.ok) {
          note(`adopt failed: ${r.reason}; keeping local`);
          return false;
        }
        return true;
      }
      case 'start_new': {
        if (decision.reason === 'erased') {
          set({ phase: 'blocked', blockedReason: 'erased' });
          return false;
        }
        if (decision.pushLocalFirst && hadLocal) await s.bootRepush();
        if (stale(s)) return false;
        s.startNew(decision.generation, 'boot');
        return true;
      }
      case 'prompt': {
        const p = head ? promptFrom(s.envelope(), head) : null;
        if (!p) return true;
        const choice = await waitPrompt(p);
        if (choice === 'keep_local') return true;
        if (stale(s)) return false;
        const r = await s.adoptRemote(head!, 'boot');
        if (!r.ok) {
          note(`adopt failed: ${r.reason}; keeping local`);
          return false;
        }
        return true;
      }
      case 'cloud_unreachable':
        return true;
    }
  };

  const headCheck = async (
    s: SyncClient<S>,
    timeoutMs: number,
  ): Promise<{
    head: RemoteHead | null;
    unreachable: boolean;
    blocked: 'update_required' | null;
  }> => {
    const r = await s.fetchHead({ withBlob: false, timeoutMs });
    if (r.ok) return { head: r.head, unreachable: false, blocked: null };
    if (r.verdict === 'update_required')
      return { head: null, unreachable: false, blocked: 'update_required' };
    // any other failure (network, 5xx, 401, 429) is "cloud unreachable" for boot purposes
    return { head: null, unreachable: true, blocked: null };
  };

  const boot = async (): Promise<BootResult<S>> => {
    if (booted) throw new Error('boot() may be called once');
    booted = true;
    set({ phase: 'booting', preview: readPreview() });
    await deps.identity.ready();
    const player = deps.identity.getPlayer();
    if (!player) {
      set({ phase: 'blocked', blockedReason: 'no_identity' });
      throw new Error('identity ready without a player');
    }
    set({ phase: 'identityReady', player });
    const lastKnown = readLastKnownPlayerId(deps.storage, deps.gameId);
    writeLastKnownPlayerId(deps.storage, deps.gameId, player.playerId);

    slot = createSlot(deps.storage, slotKey(deps.gameId, player.playerId), deps.codec, {
      gameId: deps.gameId,
      playerId: player.playerId,
    });
    const read = slot.read();
    const local = read.ok ? read.envelope : null;
    const migrated = read.ok && read.migrated;
    if (!read.ok && read.reason !== 'empty')
      note(`local slot unusable: ${read.reason}${read.message ? ` (${read.message})` : ''}`);
    const returning = local !== null || player.registered || lastKnown === player.playerId;

    sync = deps.createSync(player, local ?? deps.newEnvelope(player), slot);
    set({ phase: 'checkingCloud' });

    let decision: ReconcileDecision;
    let head: RemoteHead | null = null;
    for (;;) {
      const hc = await headCheck(sync, local ? headCheckMs : emptyCacheMs);
      if (hc.blocked) {
        set({ phase: 'blocked', blockedReason: hc.blocked });
        throw new Error('update required');
      }
      head = hc.head;
      decision = reconcile({
        local,
        remote: head,
        remoteUnreachable: hc.unreachable,
        returningIdentity: returning,
      });
      set({ decision, pendingQuarantine: decision.pendingQuarantine ?? null });
      if (decision.action !== 'cloud_unreachable') break;
      const c = await waitUnreachable();
      if (c === 'start_new') {
        decision = { action: 'start_new', reason: 'unreachable_new_identity', generation: 0 };
        set({ decision });
        break;
      }
      set({ phase: 'checkingCloud' });
    }

    await act(sync, decision, head, local !== null);
    if (phase() === 'blocked') throw new Error(`blocked: ${st.blockedReason}`);
    set({ phase: 'reconciled', prompt: null });
    // §5.2: re-push the last unacked snapshot before offline credit is computed by the loop
    await sync.bootRepush();
    set({ phase: 'live' });
    return {
      player,
      decision,
      generation: sync.envelope().generation,
      state: sync.envelope().state,
      sync,
      migrated,
    };
  };

  const recheck = async (): Promise<ReconcileDecision | null> => {
    // bind to the CURRENT player's sync for the whole step: an identity switch mid-flight makes
    // this step stale and it stops before touching the new player's envelope
    const s = sync;
    if (!s || s.retired() || phase() !== 'live') return null;
    const hc = await headCheck(s, headCheckMs);
    if (stale(s)) return null;
    if (hc.blocked) {
      set({ phase: 'blocked', blockedReason: hc.blocked });
      return null;
    }
    const env = s.envelope();
    const decision = reconcile({
      local: env,
      remote: hc.head,
      remoteUnreachable: hc.unreachable,
      returningIdentity: true,
    });
    set({ decision, pendingQuarantine: decision.pendingQuarantine ?? null });
    if (decision.action === 'keep_local' || decision.action === 'cloud_unreachable')
      return decision;
    await act(s, decision, hc.head, true);
    if (stale(s)) return null;
    if (phase() !== 'blocked') set({ phase: 'live', prompt: null });
    return decision;
  };

  return {
    state: () => st,
    onChange(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    boot,
    resolvePrompt(choice) {
      promptResolver?.(choice);
    },
    retry() {
      unreachableResolver?.('retry');
    },
    startNew() {
      unreachableResolver?.('start_new');
    },
    async onVisible(hiddenMs) {
      if (hiddenMs >= longHideMs) await recheck();
    },
    recheck,
    sync: () => sync,
    rebind(binding) {
      sync = binding.sync;
      slot = binding.slot;
      set({
        player: binding.player,
        ...(binding.decision
          ? {
              decision: binding.decision,
              pendingQuarantine: binding.decision.pendingQuarantine ?? null,
            }
          : {}),
        prompt: null,
      });
    },
  };
}

/** Wait helper for tests/UI: resolves when the machine reaches `phase` (or rejects on blocked). */
export function waitForPhase<S>(
  m: BootMachine<S>,
  phase: BootPhase,
  timers: Timers,
  timeoutMs = 10_000,
): Promise<BootState<S>> {
  return new Promise((resolve, reject) => {
    if (m.state().phase === phase) {
      resolve(m.state());
      return;
    }
    const t = timers.set(() => {
      off();
      reject(new Error(`timeout waiting for ${phase}`));
    }, timeoutMs);
    const off = m.onChange((s) => {
      if (s.phase === phase) {
        timers.clear(t);
        off();
        resolve(s);
      }
    });
  });
}
