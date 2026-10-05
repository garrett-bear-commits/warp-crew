// createGameClient (Appendix, §5.2, §5.3): wires loop + storage + sync + boot + journal + restore
// + restartJourney + leader election + identity switch + generation broadcast + integrity events
// into one GameClient. Every external dependency (fetch, storage, timers, clock, locks, channel, reload,
// sendBeacon) is injectable so the whole adapter is deterministic under test; defaults probe the
// browser. journal defaults to 'errors_only' (ADR-020); kvMirror defaults to 'mirror' (ADR-005).
import type {
  GenerationReceipt,
  IntegrityBatchBody,
  IntegrityEvent,
  LineageRestartBody,
} from '@foundation/contracts';
import type { JournalMode, SaveReason } from '@foundation/contracts/enums';
import { createApi, type Api, type ClientAuth } from './api.ts';
import {
  createBootMachine,
  type BootMachine,
  type BootResult,
  type DamagedSlotReport,
} from './boot/machine.ts';
import { createClock, type Clock } from './clock/index.ts';
import {
  createEffectRing,
  createRngStreams,
  type Effect,
  type EffectRing,
  type Engine,
  type Rng,
} from './engine/contract.ts';
import { createLoop, type Loop, type LoopOptions, type Published } from './engine/loop.ts';
import { createGenerationBus, type ChannelLike, type GenerationBus } from './generations.ts';
import { createIdentitySwitch, type IdentitySwitchOutcome } from './identity/switch.ts';
import { mintId, realTimers, type Timers } from './ids.ts';
import { createJournal, type ArgsAllowlist, type Journal } from './journal/index.ts';
import type { PlatformAdapter, Player } from './providers/types.ts';
import { createRestoreGate, type RestoreGate } from './restore/gate.ts';
import { createRestore, type Restore } from './restore/index.ts';
import type { SaveCodec } from './storage/codec.ts';
import {
  backupDamagedSlot,
  createSlot,
  journalSpoolKey,
  slotKey,
  writeLastKnownPlayerId,
  type CacheEnvelope,
  type Slot,
} from './storage/envelope.ts';
import { createSpool, memorySpool, type Spool } from './storage/spool.ts';
import {
  createStorage,
  requestPersistentStorage,
  type StorageLike,
  type StorageTier,
} from './storage/tiers.ts';
import { createSyncClient, type SyncClient, type SyncEvent } from './sync/client.ts';
import { reconcile } from './sync/reconcile.ts';
import {
  createLeaderElection,
  type LeaderElection,
  type LeaderRole,
  type LocksLike,
} from './tabs/leader.ts';

export interface GameClientConfig<S, A, E extends Effect> {
  engine: Engine<S, A, E>;
  codec: SaveCodec<S>;
  platform: PlatformAdapter;
  serverUrl: string;
  gameId: string;
  buildVersion?: string;
  journal?: JournalMode;
  kvMirror?: 'mirror' | 'off';
  loop?: LoopOptions;
  /** Journal: which action names may carry args (bounded schemas only). */
  journalArgs?: ArgsAllowlist;
  /** Journal: name/args for an action (default: `action.type` when present). */
  describeAction?: (action: A) => {
    name: string;
    args?: Record<string, number | boolean | string>;
  };
  effectRingCapacity?: number;
  sync?: {
    enabled?: boolean;
    gzip?: boolean;
    autosaveMs?: number;
    pushMs?: number;
    /** Routine saves (SyncClient.requestSave): local snapshot / push windows, push timeout. */
    localSaveMs?: number;
    routinePushMs?: number;
    pushTimeoutMs?: number;
    /** Boot waits this long on the re-push of the last unacked snapshot (default 3 s). */
    bootRepushMs?: number;
    /** Integrity event flush cadence; defaults to pushMs. An empty queue makes no request. */
    integrityMs?: number;
    headCheckMs?: number;
    longHideMs?: number;
    /** Reconcile a newer remote seq when progress is equal (for state beyond the progress ordinal). */
    reconcileEqualProgress?: boolean;
    /** Resume an offline gap at boot when both persisted device and server times are trustworthy. */
    resumeOffline?: boolean;
  };
  seed?: number;
  /** Also receives every reportError with the original error (e.g. an error tracker). Never blocks. */
  onError?: (error: unknown, detail?: Record<string, string | number | boolean>) => void;
  /** Headers for every API call (an error tracker's trace headers: the API joins its trace). */
  traceHeaders?: () => Record<string, string>;
  // ── injectables (tests / non-browser hosts) ──
  fetch?: typeof fetch;
  localStorage?: StorageLike | null;
  timers?: Timers;
  clock?: Clock;
  locks?: LocksLike | null;
  channel?: ((name: string) => ChannelLike) | null;
  reload?: () => void;
  sendBeacon?: ((url: string, body: string) => boolean) | null;
  spool?: Spool | null;
  requestPersist?: boolean;
}

export type RestartJourneyOutcome =
  | { ok: true; generation: number; entitlement: number }
  | {
      ok: false;
      reason: 'not_live' | 'stale_generation' | 'unreachable' | 'rejected' | 'no_token';
      message?: string;
      serverGeneration?: number;
    };

export interface RestartJourneyOpts<S> {
  /** Mutate `next` (the fresh generation) from `previous`. Runs after startNew, before save. */
  seed?: (args: { previous: S; next: S; entitlement: number }) => void;
}

export type ClientEvent<S> =
  | { type: 'sync'; event: SyncEvent<S> }
  | { type: 'leader'; role: LeaderRole }
  | { type: 'identity_switch'; outcome: IdentitySwitchOutcome<S> }
  | { type: 'game_error'; event: IntegrityEvent }
  | { type: 'follower_blocked' };

export interface GameClient<S, A, E extends Effect> {
  dispatch(action: A): void;
  state(): S;
  rev(): number;
  subscribe(cb: (p: Published<S>) => void): () => void;
  /** Sync client for the current player (available after boot(); throws before). */
  readonly sync: SyncClient<S>;
  effects: EffectRing<E>;
  clock: Clock;
  boot(): Promise<BootResult<S>>;
  saveNow(reason: SaveReason): void;
  readonly booted: boolean;
  readonly bootMachine: BootMachine<S>;
  readonly journal: Journal;
  /** Restore flows for the current player (available after boot()). */
  readonly restore: Restore;
  /**
   * Open a new generation (POST /v1/lineage/restart). Paid entitlement (Σpaid − Σrefunded)
   * is returned; the game seeds the fresh state. Old-generation writes are then stale.
   */
  restartJourney(opts?: RestartJourneyOpts<S>): Promise<RestartJourneyOutcome>;
  readonly leader: LeaderElection;
  readonly storage: StorageTier;
  readonly platform: PlatformAdapter;
  readonly gate: RestoreGate;
  readonly loop: Loop<S, A>;
  readonly player: Player | null;
  /** Follower tab: "Play here" — take the lock, reload the slot, start the loop. */
  playHere(): Promise<void>;
  /** game_error integrity event with breadcrumbs (§8); marks the journal for errors_only shipping. */
  reportError(error: unknown, detail?: Record<string, string | number | boolean>): void;
  onEvent(cb: (e: ClientEvent<S>) => void): () => void;
  /** Resolves when background work (head re-checks, identity switches, broadcasts) has settled. */
  idle(): Promise<void>;
  destroy(): void;
}

export function createGameClient<S, A, E extends Effect>(
  cfg: GameClientConfig<S, A, E>,
): GameClient<S, A, E> {
  const { engine, codec, platform, gameId } = cfg;
  const buildVersion = cfg.buildVersion ?? '0.0.0';
  const timers = cfg.timers ?? realTimers();
  const clock = cfg.clock ?? createClock();
  const storage = createStorage(
    cfg.localStorage === undefined ? {} : { localStorage: cfg.localStorage },
  );
  const gate = createRestoreGate();
  const effects = createEffectRing<E>(cfg.effectRingCapacity ?? 64);
  const seed = cfg.seed ?? Math.floor(clock.deviceNow() % 2_147_483_647);
  const streams = createRngStreams(seed);
  const rng: Rng = streams.sim;
  const bus: GenerationBus = createGenerationBus(
    cfg.channel === undefined ? { gameId } : { gameId, channel: cfg.channel },
  );
  const leader = createLeaderElection(
    cfg.locks === undefined
      ? { name: `foundation:${gameId}:leader` }
      : { name: `foundation:${gameId}:leader`, locks: cfg.locks },
  );
  const journal = createJournal({
    mode: cfg.journal ?? 'errors_only',
    ...(cfg.journalArgs ? { argsAllowlist: cfg.journalArgs } : {}),
  });
  const subs = new Set<(e: ClientEvent<S>) => void>();
  const emit = (e: ClientEvent<S>): void => {
    for (const s of subs) s(e);
  };

  let booted = false;
  let player: Player | null = null;
  let sync: SyncClient<S> | null = null;
  let restore: Restore | null = null;
  let slot: Slot<S> | null = null;
  let spool: Spool | null = null;
  let adopting = false;
  let hiddenMark: number | null = null;
  const cleanups: Array<() => void> = [];
  /** Background work (rechecks, identity switches) tracked so tests can await quiescence. */
  const background = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>, task: string): Promise<T> => {
    background.add(p);
    // background work never surfaces as an unhandled rejection: failures are reported as game
    // errors, named by task
    void p
      .catch((e: unknown) => reportError(e, { background: true, operation: `background_${task}` }))
      .finally(() => background.delete(p));
    return p;
  };
  const integrityQueue: IntegrityEvent[] = [];
  let integrityInFlight: { commandId: string; events: IntegrityEvent[] } | null = null;

  /** Auth for ONE player: null once the provider no longer vouches for that id (identity switch). */
  const authFor = (playerId: string): ClientAuth | null => {
    const token = platform.identity.tokenFor(playerId);
    if (!token) return null;
    return { playerKey: playerId, token, buildVersion };
  };
  const currentAuth = (): ClientAuth | null => (player ? authFor(player.playerId) : null);
  const api: Api = createApi({
    baseUrl: cfg.serverUrl,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    auth: currentAuth,
    refreshAuth: async () => (await platform.identity.refreshCredential()) !== null,
    requestId: mintId,
    ...(cfg.traceHeaders ? { traceHeaders: cfg.traceHeaders } : {}),
  });

  const newState = (playerId?: string): S =>
    engine.newState({ now: clock.now(), seed, rng, ...(playerId ? { playerId } : {}) });

  const loop = createLoop<S, A, E>({
    engine,
    initialState: newState(),
    clock,
    rng,
    effects,
    options: cfg.loop ?? { tps: 10 },
    describeAction:
      cfg.describeAction ??
      ((a: A) => {
        const t = (a as { type?: unknown } | null)?.type;
        return { name: typeof t === 'string' ? t : 'action' };
      }),
    onJournal: (entry) => journal.record(entry),
    onInvariant: (message) => reportError(new Error(message), { invariant: true }),
  });
  loop.subscribe(() => {
    if (!adopting) sync?.markDirty();
  });

  const replaceState = (state: S, rngState?: number): void => {
    adopting = true;
    try {
      if (typeof rngState === 'number') rng.restore(rngState);
      loop.replaceState(state);
    } finally {
      adopting = false;
    }
  };

  const freshEnvelope = (p: Player): CacheEnvelope<S> => {
    const state = newState(p.playerId);
    return {
      format: 1,
      gameId,
      playerId: p.playerId,
      schemaVersion: codec.schemaVersion,
      generation: 0,
      state,
      progress: engine.progressOf(state),
      savedAt: clock.now(),
      deviceSavedAt: clock.deviceNow(),
      savedAtServerAnchored: clock.anchored(),
      dirty: false,
      lastAckedSeq: 0,
      sessionId: mintId(),
      clientSeq: 0,
      ratchetFloor: null,
      lastVerdict: null,
      lastSyncedAt: null,
    };
  };

  const buildSync = (p: Player, envelope: CacheEnvelope<S>, s: Slot<S>): SyncClient<S> => {
    // sessionId identifies this writer (device slot) across boots — the server flags a write
    // from another session as divergent, so it must NOT change on every reload
    const env: CacheEnvelope<S> = envelope.sessionId
      ? envelope
      : { ...envelope, sessionId: mintId() };
    const sc = createSyncClient<S>({
      api,
      gameId,
      playerId: p.playerId,
      buildVersion,
      codec,
      slot: s,
      envelope: env,
      // bound to THIS player: after an identity switch the previous player's client can never
      // carry the new player's token (audit F1)
      auth: () => authFor(p.playerId),
      clock,
      timers,
      gate,
      source: {
        state: () => loop.state(),
        settle: () => {
          // settle publishes; the snapshot taken right after already includes its changes
          adopting = true;
          try {
            return loop.settle();
          } finally {
            adopting = false;
          }
        },
        progressOf: (st) => engine.progressOf(st),
        ...(engine.summary ? { summary: (st: S) => engine.summary!(st) } : {}),
        rngState: () => rng.state(),
      },
      newState: () => newState(p.playerId),
      bus,
      journal,
      kv: (cfg.kvMirror ?? 'mirror') === 'mirror' ? platform.kv : null,
      kvKey: slotKey(gameId, p.playerId),
      storageMode: () => storage.mode,
      // This is the sync client's shared writer gate (push, autosave, beacon, journal and slot/KV
      // persistence). A prompt must block lifecycle/manual writers as well as scheduled ones.
      isLeader: () =>
        leader.isLeader() && !['prompt', 'blocked'].includes(bootMachine.state().phase),
      sendBeacon:
        cfg.sendBeacon === undefined
          ? (() => {
              const nav = (
                globalThis as { navigator?: { sendBeacon?: (u: string, b: string) => boolean } }
              ).navigator;
              return nav && typeof nav.sendBeacon === 'function'
                ? (u: string, b: string) => nav.sendBeacon!(u, b)
                : null;
            })()
          : cfg.sendBeacon,
      enabled: cfg.sync?.enabled !== false,
      gzip: cfg.sync?.gzip === true,
      intervals: {
        ...(cfg.sync?.autosaveMs !== undefined ? { autosaveMs: cfg.sync.autosaveMs } : {}),
        ...(cfg.sync?.pushMs !== undefined ? { pushMs: cfg.sync.pushMs } : {}),
        ...(cfg.sync?.headCheckMs !== undefined ? { headCheckMs: cfg.sync.headCheckMs } : {}),
        ...(cfg.sync?.localSaveMs !== undefined ? { localSaveMs: cfg.sync.localSaveMs } : {}),
        ...(cfg.sync?.routinePushMs !== undefined ? { routinePushMs: cfg.sync.routinePushMs } : {}),
        ...(cfg.sync?.pushTimeoutMs !== undefined ? { pushTimeoutMs: cfg.sync.pushTimeoutMs } : {}),
      },
      onEvent: (e) => {
        if (e.type === 'halted' && e.reason === 'update_required' && sc === sync)
          bootMachine.requireUpdate();
        if ((e.type === 'generation_changed' || e.type === 'reloaded') && sc === sync)
          replaceState(e.state);
        // the server holds a deeper anchor (another device): reconcile now instead of at the next boot
        if (e.type === 'server_deeper' && sc === sync && booted)
          void track(bootMachine.recheck(), 'server_deeper_recheck');
        emit({ type: 'sync', event: e });
      },
    });
    // the loop must run the envelope's state (local slot or fresh) from the moment the sync
    // client exists: every snapshot is taken from the loop
    sync = sc;
    slot = s;
    replaceState(env.state, env.rngState);
    return sc;
  };

  const bootMachine = createBootMachine<S>({
    gameId,
    identity: platform.identity,
    storage,
    codec,
    clock,
    timers,
    createSync: (p, envelope, s) => {
      player = p;
      return buildSync(p, envelope, s);
    },
    newEnvelope: freshEnvelope,
    ...(cfg.sync?.headCheckMs !== undefined ? { headCheckMs: cfg.sync.headCheckMs } : {}),
    ...(cfg.sync?.longHideMs !== undefined ? { longHideMs: cfg.sync.longHideMs } : {}),
    ...(cfg.sync?.reconcileEqualProgress !== undefined
      ? { reconcileEqualProgress: cfg.sync.reconcileEqualProgress }
      : {}),
    ...(cfg.sync?.bootRepushMs !== undefined ? { bootRepushMs: cfg.sync.bootRepushMs } : {}),
    onDamagedSlot: (report) => reportDamagedSlot(report),
  });

  // A live reconciliation prompt freezes all game mutations until the player chooses. Initial
  // boot prompts happen before either writer has started, so these calls remain harmless there.
  cleanups.push(
    bootMachine.onChange((state) => {
      if (!booted) return;
      if (state.phase === 'prompt' || state.phase === 'blocked') {
        loop.stop();
        sync?.stop();
      } else if (state.phase === 'live' && leader.isLeader()) {
        loop.start();
        sync?.start();
      }
    }),
  );

  const flushIntegrity = async (): Promise<void> => {
    // followers hold their events (never lost) and ship once they lead (audit F9)
    if (!sync || !leader.isLeader() || bootMachine.state().phase === 'blocked' || !currentAuth())
      return;
    if (!integrityInFlight) {
      if (integrityQueue.length === 0) return;
      integrityInFlight = { commandId: mintId(), events: integrityQueue.splice(0, 20) };
    }
    const body: IntegrityBatchBody = {
      commandId: integrityInFlight.commandId,
      events: integrityInFlight.events,
    };
    const res = await api.call('POST', '/v1/telemetry/integrity', body);
    if (
      res.ok ||
      (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 401)
    )
      integrityInFlight = null;
  };

  const reportError = (
    error: unknown,
    detail?: Record<string, string | number | boolean>,
  ): void => {
    // The integrity event is bounded (contracts/telemetry.ts): its message names the error and
    // up to three causes, and its detail is trimmed. The error sink gets the error and detail
    // whole.
    const describe = (e: unknown): string =>
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    let message = describe(error);
    let cause = error instanceof Error ? error.cause : undefined;
    for (let depth = 0; cause !== undefined && depth < 3; depth++) {
      message += ` <- ${describe(cause)}`;
      cause = cause instanceof Error ? cause.cause : undefined;
    }
    const ev: IntegrityEvent = {
      kind: 'game_error',
      at: clock.now(),
      message: message.slice(0, 512),
      breadcrumbs: journal.breadcrumbs(),
      buildVersion,
      ...(detail
        ? {
            detail: Object.fromEntries(
              Object.entries(detail).map(([key, value]) => [
                key.slice(0, 32),
                typeof value === 'string' ? value.slice(0, 256) : value,
              ]),
            ),
          }
        : {}),
    };
    journal.markError();
    integrityQueue.push(ev);
    if (integrityQueue.length > 100) integrityQueue.shift();
    try {
      platform.errors.report(ev);
    } catch {
      /* the sink never blocks */
    }
    try {
      cfg.onError?.(error, detail);
    } catch {
      /* the sink never blocks */
    }
    emit({ type: 'game_error', event: ev });
  };

  /** An unreadable local slot was set aside (backed up) and play continues from the server copy. */
  const reportDamagedSlot = (report: DamagedSlotReport): void =>
    reportError(new Error(`local save unreadable: ${report.reason}`), {
      operation: 'local_save_damaged',
      reason: report.reason,
      ...(report.message ? { message: report.message.slice(0, 200) } : {}),
      chars: report.chars,
      backedUp: report.backedUp,
    });

  const buildRestore = (): void => {
    if (!sync || !slot) return;
    restore = createRestore<S>({
      api,
      codec,
      slot,
      sync,
      gate,
      clock,
      progressOf: (s) => engine.progressOf(s),
      buildVersion,
      reload:
        cfg.reload ?? (() => (globalThis as { location?: { reload(): void } }).location?.reload()),
      kv: (cfg.kvMirror ?? 'mirror') === 'mirror' ? platform.kv : null,
      kvKey: player ? slotKey(gameId, player.playerId) : '',
      canWrite: () => bootMachine.state().phase !== 'blocked',
      onIntegrity: (kind, d) => {
        integrityQueue.push({ kind, at: clock.now(), detail: d, buildVersion });
      },
    });
  };

  /**
   * Bind a player after an identity switch: retire the previous player's sync (its timers, beacon,
   * journal shipping and slot writes stop for good), then slot + sync + bounded head check +
   * reconcile for the new player, and hand the new binding to the boot machine so every later
   * re-check uses the CURRENT player's sync/auth/envelope/slot (audit F1).
   */
  const rebind = async (
    next: Player,
  ): Promise<{ sync: SyncClient<S>; hadLocal: boolean; remoteEmpty: boolean }> => {
    sync?.retire();
    player = next;
    writeLastKnownPlayerId(storage, gameId, next.playerId);
    if (spool) journal.bindSpool(spool, journalSpoolKey(gameId, next.playerId));
    const s = createSlot(storage, slotKey(gameId, next.playerId), codec, {
      gameId,
      playerId: next.playerId,
    });
    const read = s.read();
    if (!read.ok && read.reason === 'incompatible') {
      bootMachine.requireUpdate();
      throw new Error('An update is required to read this account save. Your save is preserved.');
    }
    if (!read.ok && read.reason !== 'empty' && read.reason !== 'incompatible')
      reportDamagedSlot({
        reason: read.reason,
        ...(read.message ? { message: read.message } : {}),
        ...backupDamagedSlot(storage, gameId, next.playerId),
      });
    const local = read.ok ? read.envelope : null;
    const sc = buildSync(next, local ?? freshEnvelope(next), s);
    bootMachine.rebind({ player: next, sync: sc, slot: s });
    const head = await sc.fetchHead({ withBlob: true });
    const inspected = head.ok ? await sc.inspectRemote(head.head) : null;
    if (inspected && !inspected.ok) {
      if (inspected.reason === 'newer_schema') bootMachine.requireUpdate();
      throw new Error(
        inspected.reason === 'newer_schema'
          ? 'An update is required to read this account save.'
          : `Unable to verify the account save (${inspected.reason}).`,
      );
    }
    const remote = inspected?.ok ? inspected.head : null;
    const decision = reconcile({
      local,
      remote,
      remoteUnreachable: !head.ok,
      returningIdentity: true,
      // Identity switching has its own guest/account conflict prompt below. Equal-progress seq
      // reconciliation is intentionally scoped to BootMachine boot/recheck for now.
    });
    if (decision.action === 'adopt_remote' && remote) {
      if (decision.pushLocalFirst && local) await sc.bootRepush();
      await sc.adoptRemote(remote, 'boot');
      if (sc.halted() === 'update_required') {
        bootMachine.requireUpdate();
        throw new Error('An update is required to read this account save.');
      }
    } else if (decision.action === 'start_new' && decision.reason !== 'erased') {
      sc.startNew(decision.generation, 'boot');
    }
    if (sc === sync) bootMachine.rebind({ player: next, sync: sc, slot: s, decision });
    buildRestore();
    if (leader.isLeader() && sc === sync) sc.start();
    return { sync: sc, hadLocal: local !== null, remoteEmpty: !remote || remote.kind === 'empty' };
  };

  const identitySwitch = createIdentitySwitch<S>({
    identity: platform.identity,
    progressOf: (s) => engine.progressOf(s),
    rebind,
    applyState: (sc, state) => {
      if (sc === sync) replaceState(state);
      sc.markDirty();
    },
    onIntegrity: (d) =>
      integrityQueue.push({ kind: 'identity_switch', at: clock.now(), detail: d, buildVersion }),
  });

  const boot = async (): Promise<BootResult<S>> => {
    if (cfg.requestPersist !== false) void requestPersistentStorage();
    spool = cfg.spool === undefined ? await createSpool() : (cfg.spool ?? memorySpool());
    // leader election FIRST: only the leader writes (slot, boot re-push, adoption persist);
    // followers are read-only with "Play here". Deciding it before the boot machine runs means the
    // leader's boot re-push and adoption persist actually happen, and a follower never writes.
    await leader.request();
    cleanups.push(
      leader.onChange((r) => {
        emit({ type: 'leader', role: r });
        // demoted (another tab took over): stop the loop AND every background mutation path;
        // queued journal entries / integrity events are held until this tab leads again (audit F9)
        if (r === 'follower') {
          loop.stop();
          sync?.stop();
        }
      }),
    );
    const result = await bootMachine.boot();
    const p = result.player;
    if (cfg.sync?.resumeOffline === true) {
      const anchor = result.offlineResumeAnchor;
      const deviceSavedAt = anchor.deviceSavedAt;
      // now() is equal to device time before its first server sample. Requiring an anchor avoids
      // inventing a server elapsed time when the boot head check was unreachable.
      if (
        clock.anchored() &&
        anchor.savedAtServerAnchored === true &&
        typeof deviceSavedAt === 'number' &&
        Number.isFinite(deviceSavedAt) &&
        Number.isFinite(anchor.savedAt)
      ) {
        const resumed = loop.resumeGap({
          deviceSec: (clock.deviceNow() - deviceSavedAt) / 1000,
          serverSec: (clock.now() - anchor.savedAt) / 1000,
        });
        // The gap result includes idempotency ratchets owned by the game. Persist it before boot
        // exposes live UI; autosave's existing writer gate keeps follower tabs read-only.
        if (resumed) await result.sync.autosave();
      }
    }
    booted = true;
    // journal spool for this player (IndexedDB or memory), loaded before the loop starts
    journal.bindSpool(spool, journalSpoolKey(gameId, p.playerId));
    await journal.load();
    buildRestore();
    emit({ type: 'leader', role: leader.role() });
    // the role may have flipped during boot (another tab took over): consult it now
    if (leader.isLeader()) {
      loop.start();
      sync!.start();
    }
    // lifecycle: hidden → autosave + beacon (teardown path); visible after a long hide → head re-check
    cleanups.push(
      platform.lifecycle.onVisibilityChange((visible) => {
        if (!visible) {
          hiddenMark = clock.mark();
          if (sync && leader.isLeader() && bootMachine.state().phase !== 'blocked') {
            // teardown path: the beacon saves first (slot + pending), then sends that snapshot
            sync.beacon();
            void journal.persist();
          }
        } else {
          const hiddenMs = hiddenMark !== null ? clock.sinceMark(hiddenMark) : 0;
          hiddenMark = null;
          void track(bootMachine.onVisible(hiddenMs), 'visible_recheck');
        }
      }),
    );
    cleanups.push(
      platform.lifecycle.onPageHide(() => {
        if (sync && leader.isLeader()) sync.beacon();
      }),
    );
    // sibling tabs / other devices moved to a newer generation
    cleanups.push(
      bus.onGenerationChanged((m) => {
        // bind to the CURRENT player's sync for the whole step (stale after an identity switch)
        const s = sync;
        if (!s || m.playerId !== s.playerId || m.generation <= s.envelope().generation) return;
        void track(
          s.fetchHead({ withBlob: true, timeoutMs: 5_000 }).then((h) => {
            if (h.ok && s === sync) return s.adoptRemote(h.head, 'broadcast');
            return undefined;
          }),
          'broadcast_adopt',
        );
      }),
    );
    // identity switch (guest → account)
    cleanups.push(
      platform.identity.onIdentityChanged((prev, next) => {
        // Jest registration upgrades a guest in place: the playerId and therefore the save slot
        // stay stable. Refresh the observable registration state without retiring/rebinding sync.
        if (prev && prev.playerId === next.playerId) {
          player = next;
          if (sync && slot) bootMachine.rebind({ player: next, sync, slot });
          emit({ type: 'identity_switch', outcome: { kind: 'no_change' } });
          return;
        }
        const guest = sync;
        void track(
          identitySwitch.onIdentityChanged(prev, next, guest).then((outcome) => {
            emit({ type: 'identity_switch', outcome });
          }),
          'identity_switch',
        );
      }),
    );
    // integrity events ride the timer path (bounded, ≤ 20 per call)
    const integrityTimer = (): void => {
      integrityHandle = timers.set(
        () => {
          void flushIntegrity()
            .catch(() => undefined)
            .finally(() => {
              if (booted) integrityTimer();
            });
        },
        cfg.sync?.integrityMs ?? cfg.sync?.pushMs ?? 60_000,
      );
    };
    integrityTimer();
    return cfg.sync?.resumeOffline === true ? { ...result, state: loop.state() } : result;
  };
  let integrityHandle: unknown = null;
  let pendingRestart: LineageRestartBody | null = null;

  const restartJourney = async (opts?: RestartJourneyOpts<S>): Promise<RestartJourneyOutcome> => {
    if (
      !booted ||
      !sync ||
      !leader.isLeader() ||
      gate.isRestoring() ||
      bootMachine.state().phase !== 'live'
    )
      return { ok: false, reason: 'not_live' };
    const previous = loop.state();
    await sync.push('important', { fresh: true });
    if (
      !booted ||
      !sync ||
      !leader.isLeader() ||
      gate.isRestoring() ||
      bootMachine.state().phase !== 'live'
    )
      return { ok: false, reason: 'not_live' };
    const expectedGeneration = sync.envelope().generation;
    if (!pendingRestart || pendingRestart.expectedGeneration !== expectedGeneration) {
      pendingRestart = {
        commandId: mintId(),
        restartId: mintId(),
        expectedGeneration,
      };
    }
    const res = await api.call<GenerationReceipt>('POST', '/v1/lineage/restart', pendingRestart);
    if (!res.ok) {
      if (res.status === 0) return { ok: false, reason: 'unreachable' };
      if (res.status === 401) return { ok: false, reason: 'no_token' };
      if (res.status === 409 && res.error?.error === 'stale_generation') {
        pendingRestart = null;
        const details = res.error.details as { generation?: number } | undefined;
        return {
          ok: false,
          reason: 'stale_generation',
          ...(typeof details?.generation === 'number'
            ? { serverGeneration: details.generation }
            : {}),
        };
      }
      return {
        ok: false,
        reason: 'rejected',
        message: res.error?.error ?? `http ${res.status}`,
      };
    }
    const entitlement = Math.max(0, res.body.entitlement ?? 0);
    const sc = sync;
    await gate.hold(async () => {
      const next = sc.startNew(res.body.generation, 'start_new');
      opts?.seed?.({ previous, next, entitlement });
    });
    pendingRestart = null;
    sc.markDirty();
    await sc.autosave();
    await sc.push('important', { fresh: true });
    return { ok: true, generation: res.body.generation, entitlement };
  };

  return {
    dispatch(action) {
      if (!leader.isLeader()) {
        emit({ type: 'follower_blocked' });
        return;
      }
      if (['prompt', 'blocked'].includes(bootMachine.state().phase)) return;
      loop.dispatch(action);
    },
    state: () => loop.state(),
    rev: () => loop.rev(),
    subscribe: (cb) => loop.subscribe(cb),
    get sync() {
      if (!sync) throw new Error('boot() first');
      return sync;
    },
    effects,
    clock,
    boot,
    saveNow(reason) {
      const s = sync;
      if (!s) return;
      void s.autosave().then(() => (s === sync ? s.push(reason, { fresh: true }) : undefined));
    },
    get booted() {
      return booted;
    },
    bootMachine,
    journal,
    get restore() {
      if (!restore) throw new Error('boot() first');
      return restore;
    },
    restartJourney,
    leader,
    storage,
    platform,
    gate,
    loop,
    get player() {
      return player;
    },
    async playHere() {
      const role = await leader.takeover();
      if (role !== 'leader' || !sync) return;
      // the previous leader may have written the slot: reload it before writing anything
      sync.reloadFromSlot();
      if (sync.halted() || bootMachine.state().phase === 'blocked') return;
      const rs = sync.envelope().rngState;
      if (typeof rs === 'number') rng.restore(rs);
      loop.start();
      sync.start();
    },
    reportError,
    async idle() {
      while (background.size > 0) await Promise.allSettled([...background]);
    },
    onEvent(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    destroy() {
      booted = false;
      loop.stop();
      sync?.stop();
      if (integrityHandle !== null) timers.clear(integrityHandle);
      for (const c of cleanups.splice(0)) c();
      leader.release();
      bus.close();
    },
  };
}
