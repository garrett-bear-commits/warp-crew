// SyncClient (§5.2 Sync + Generations, §6 Saves, ADR-005/006/019). Owns the cache envelope for
// one player: local autosave (10 s, dirty only), server push (60 s state-driven timer, important
// events, after restore, hidden → beacon), KV mirror (≤ 1 write per 60 s, newest snapshot trails,
// teardown writes at once), verdict mapping, ratchet, generation adoption and the boot re-push.
// Game changes ask for a save through requestSave: routine ones write the device at most every
// localSaveMs and the cloud at most every routinePushMs (leading + trailing, so the newest state
// always goes); immediate ones save and push at once. A push gives up after pushTimeoutMs; network
// errors, timeouts and 5xx back off exponentially with jitter.
// Every push carries a client-minted commandId minted WITH the encoded snapshot, persisted in the
// envelope BEFORE the first attempt and reused verbatim on every retry — the beacon and the boot
// re-push included. Client state/progress are claims; sync metadata lives in the envelope, never
// in S. Only `synced` is ever shown as "saved to cloud".
import type {
  PendingQuarantine,
  SaveBeaconBody,
  SaveCurrentResponse,
  SaveWriteBody,
  SaveWriteResult,
} from '@foundation/contracts';
import type { SaveReason, SyncVerdict } from '@foundation/contracts/enums';
import { LIMITS } from '@foundation/contracts/enums';
import type { Api, ApiResult, ClientAuth } from '../api.ts';
import type { Clock } from '../clock/index.ts';
import type { Summary } from '../engine/contract.ts';
import { adoptGeneration, type GenerationBus } from '../generations.ts';
import { mintId, type Timers } from '../ids.ts';
import type { Journal } from '../journal/index.ts';
import type { PlatformKV } from '../providers/types.ts';
import type { RestoreGate } from '../restore/gate.ts';
import { decodeFromWire, encodeForWire, utf8Bytes, type SaveCodec } from '../storage/codec.ts';
import type { CacheEnvelope, PendingPush, PendingSnapshotRef, Slot } from '../storage/envelope.ts';
import type { StorageMode, StorageSetResult } from '../storage/tiers.ts';
import { ratchet } from './ratchet.ts';
import type { RemoteHead } from './reconcile.ts';
import {
  ACKED_VERDICTS,
  mapVerdict,
  TERMINAL_VERDICTS,
  type HttpOutcome,
  type MappedVerdict,
} from './verdicts.ts';

export type HaltReason = 'server_behind' | 'update_required' | 'erased' | 'adopt_failed';

/**
 * How soon a committed change must reach the cloud. `routine`: throttled (device at most every
 * localSaveMs, cloud at most every routinePushMs, trailing). `immediate`: saved and pushed now.
 */
export type SavePriority = 'routine' | 'immediate';

/** Push options. `fresh`: wait out an in-flight push so this one carries every earlier change. */
export interface PushOptions {
  auth?: ClientAuth;
  reusePendingOnly?: boolean;
  reassertPending?: boolean;
  fresh?: boolean;
}

export type PushReport =
  | {
      skipped:
        | 'restoring'
        | 'follower'
        | 'halted'
        | 'in_flight'
        | 'awaiting_adopt'
        | 'nothing_to_push'
        | 'retired';
    }
  | ({ skipped?: undefined; commandId: string; reason: SaveReason } & MappedVerdict);

export type GenerationSource = 'stale_generation' | 'boot' | 'broadcast' | 'restore' | 'start_new';

/**
 * Why a snapshot capture minted no pending: the depth ratchet refused it (`shallower`,
 * `older_generation`), this client stopped being the writer while encoding (`not_writer`), or an
 * envelope swap / slot reload replaced the state being encoded (`superseded`).
 */
export type CaptureFailure = 'shallower' | 'older_generation' | 'not_writer' | 'superseded';
/** An autosave that did not reach the local slot: no snapshot, or the slot refused the write. */
export type AutosaveFailure = CaptureFailure | 'quota' | 'blocked';

export type SyncEvent<S> =
  | { type: 'verdict'; report: PushReport }
  | { type: 'generation_changed'; from: number; to: number; state: S; source: GenerationSource }
  | { type: 'alarm'; kind: 'server_behind'; localGeneration: number; serverGeneration: number }
  | { type: 'halted'; reason: HaltReason }
  | { type: 'server_deeper'; serverProgress: number }
  /** `ok`: the snapshot reached the local slot (autosave() itself returns whether one is pending). */
  | { type: 'autosaved'; ok: true }
  | { type: 'autosaved'; ok: false; reason: AutosaveFailure }
  | { type: 'reloaded'; state: S }
  | { type: 'adopt_failed'; reason: string };

export type SyncStatus =
  | { kind: 'saved_to_cloud'; agoMs: number; divergent: boolean }
  | { kind: 'pending_review' }
  | { kind: 'cloud_unavailable_local' }
  | { kind: 'cloud_only' }
  | { kind: 'local_only' }
  | { kind: 'nowhere' }
  | { kind: 'halted'; reason: HaltReason }
  | { kind: 'disabled' };

export interface StateSource<S> {
  state(): S;
  /** Wall-clock hand-offs before a snapshot is taken (engine.settle via the loop). */
  settle?(): S;
  progressOf(state: S): number;
  summary?(state: S): Summary;
  rngState?(): number;
}

export interface SyncClientDeps<S> {
  api: Api;
  gameId: string;
  playerId: string;
  buildVersion: string;
  codec: SaveCodec<S>;
  slot: Slot<S>;
  envelope: CacheEnvelope<S>;
  auth: () => ClientAuth | null;
  clock: Clock;
  timers: Timers;
  gate: RestoreGate;
  source: StateSource<S>;
  /** Fresh state for a newer empty generation (restart/erase from elsewhere). */
  newState: () => S;
  bus?: GenerationBus;
  journal?: Journal;
  kv?: PlatformKV | null;
  kvKey?: string;
  storageMode?: () => StorageMode;
  isLeader?: () => boolean;
  /** navigator.sendBeacon (injectable); null → fetch keepalive fallback only. */
  sendBeacon?: ((url: string, body: string) => boolean) | null;
  /** false = the game runs without cloud sync (verdict `disabled`). */
  enabled?: boolean;
  gzip?: boolean;
  intervals?: {
    autosaveMs?: number;
    pushMs?: number;
    headCheckMs?: number;
    kvMirrorMs?: number;
    /** Routine changes: at most one local snapshot per window (default 5 s). */
    localSaveMs?: number;
    /** Routine changes: at most one push per window (default 12 s). */
    routinePushMs?: number;
    /** A save PUT is abandoned after this long (default 10 s). */
    pushTimeoutMs?: number;
  };
  /** Backoff jitter source (default Math.random). */
  random?: () => number;
  onEvent?: (e: SyncEvent<S>) => void;
}

export interface SyncClient<S> {
  readonly playerId: string;
  envelope(): CacheEnvelope<S>;
  /** Live state changed since the last snapshot (called by the adapter on every publish). */
  markDirty(): void;
  /** Persist dirty state to the local slot + refresh the encoded pending snapshot (10 s path). */
  autosave(): Promise<boolean>;
  push(reason: SaveReason, opts?: { auth?: ClientAuth; fresh?: boolean }): Promise<PushReport>;
  /**
   * A committed change wants saving (see SavePriority). Immediate requests coalesce into one
   * running save; its promise settles once the change is written and pushed (or, inside a
   * backoff, handed to the trailing push).
   */
  requestSave(priority: SavePriority): Promise<void>;
  /**
   * Teardown: save first, then sendBeacon (≤ 64 KiB) with the pending commandId; keepalive fallback.
   * The KV mirror gets the newest snapshot now, whether or not a beacon is sent.
   */
  beacon(): boolean;
  /** Boot: re-push the last unacked snapshot verbatim BEFORE offline credit. */
  bootRepush(reassert?: boolean): Promise<PushReport>;
  /** Bounded server head check (GET /v1/saves/current[?meta=1]). */
  fetchHead(opts: {
    withBlob: boolean;
    timeoutMs?: number;
  }): Promise<
    | { ok: true; head: RemoteHead }
    | { ok: false; unreachable: boolean; status: number; verdict?: SyncVerdict }
  >;
  /** Fetch/decode a snapshot blob without adopting it, so a future schema can block local writes. */
  inspectRemote(
    head: RemoteHead,
  ): Promise<{ ok: true; head: RemoteHead; state: S | null } | { ok: false; reason: string }>;
  /** Adopt a server head (newer generation or deeper snapshot per reconcile); replaces the envelope. */
  adoptRemote(
    head: RemoteHead,
    source: GenerationSource,
  ): Promise<{ ok: true; state: S } | { ok: false; reason: string }>;
  /** Start a fresh state in `generation` (both empty / newer empty generation / erased). */
  startNew(generation: number, source: 'boot' | 'start_new'): S;
  /** Ship one journal batch on the timer path (mode on, or errors_only after a game_error). */
  shipJournal(): Promise<boolean>;
  status(): SyncStatus;
  statusText(): string;
  /** A deeper (or only) quarantined save awaiting review, as of the last successful head check. */
  pendingQuarantine(): PendingQuarantine | null;
  onEvent(cb: (e: SyncEvent<S>) => void): () => void;
  onVerdict(cb: (verdict: SyncVerdict, report: PushReport) => void): () => void;
  start(): void;
  stop(): void;
  halted(): HaltReason | null;
  /** Clear a recoverable lineage halt; update-required remains terminal for this client instance. */
  resume(): void;
  /** Called by the game client with the current leader answer; followers never write. */
  needsPush(): boolean;
  /** Re-read the local slot (after "Play here": the previous leader may have written it). */
  reloadFromSlot(): boolean;
  /**
   * Permanently retire this client (identity switch: the previous player's sync must never write
   * its slot, push, beacon or ship again). Unlike stop(), a retired client cannot be started.
   */
  retire(): void;
  retired(): boolean;
}

/** A snapshot capture: its pending and the local slot write it made (null: none). */
type Capture =
  | { pending: PendingPush; slot: StorageSetResult | null }
  | { pending: null; reason: CaptureFailure };

const DEFAULT_AUTOSAVE_MS = 10_000;
const DEFAULT_PUSH_MS = 60_000;
const DEFAULT_HEAD_CHECK_MS = 800;
const DEFAULT_KV_MIRROR_MS = 60_000;
const DEFAULT_LOCAL_SAVE_MS = 5_000;
const DEFAULT_ROUTINE_PUSH_MS = 12_000;
const DEFAULT_PUSH_TIMEOUT_MS = 10_000;
/** Transport backoff: 4 s doubling to 60 s, each wait jittered to 50-100 % of its step. Routine
 * pushes also keep their window, so a retry never comes sooner than routinePushMs after a send. */
const BACKOFF_BASE_MS = 4_000;
const BACKOFF_MAX_MS = 60_000;
const MAX_PENDING_ANCESTORS = 16;

export function createSyncClient<S>(deps: SyncClientDeps<S>): SyncClient<S> {
  const { api, codec, slot, clock, timers, gate, source } = deps;
  const enabled = deps.enabled !== false;
  const autosaveMs = deps.intervals?.autosaveMs ?? DEFAULT_AUTOSAVE_MS;
  const pushMs = deps.intervals?.pushMs ?? DEFAULT_PUSH_MS;
  const headCheckMs = deps.intervals?.headCheckMs ?? DEFAULT_HEAD_CHECK_MS;
  const kvMirrorMs = deps.intervals?.kvMirrorMs ?? DEFAULT_KV_MIRROR_MS;
  const localSaveMs = deps.intervals?.localSaveMs ?? DEFAULT_LOCAL_SAVE_MS;
  const routinePushMs = deps.intervals?.routinePushMs ?? DEFAULT_ROUTINE_PUSH_MS;
  const pushTimeoutMs = deps.intervals?.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS;
  const random = deps.random ?? Math.random;

  let env: CacheEnvelope<S> = deps.envelope;
  /** Canonical JSON of the state the current pending snapshot encodes (memory only). */
  let pendingCanonical: string | null = env.pending ? codec.encode(env.state) : null;
  /**
   * Live state changed since the pending snapshot was taken. A slot's `dirty` means "not acked
   * yet"; when it holds a pending, the envelope state IS that snapshot's state (the loop runs it
   * from boot), so nothing changed since — the boot re-push ack leaves the envelope clean.
   */
  const dirtySinceFor = (e: CacheEnvelope<S>): boolean => (e.pending ? false : e.dirty);
  let dirtySincePending = dirtySinceFor(env);
  /** Monotonic gameplay revision, used to keep changes made during async encoding dirty. */
  let dirtyRevision = 0;
  /** Newer snapshot attempts (including synchronous teardown) supersede older async encodes. */
  let snapshotEpoch = 0;
  /** The newest asynchronous capture: an older capture it superseded resolves to its result. */
  let latestCapture: { epoch: number; done: Promise<Capture> } | null = null;
  let halted: HaltReason | null = null;
  let awaitingAdopt: number | null = null;
  let inFlight: Promise<PushReport> | null = null;
  let inPush = false;
  let autosaveHandle: unknown = null;
  let pushHandle: unknown = null;
  /** Monotonic mark of the last KV mirror write; null until the first one. */
  let kvMirrorMark: number | null = null;
  /** The newest blob held back by the KV throttle, waiting for its trailing write. */
  let kvTrailing: string | null = null;
  let kvHandle: unknown = null;
  let backoffUntil = 0;
  /** Consecutive pushes lost to the network, a timeout or a 5xx (drives the backoff step). */
  let transportFailures = 0;
  /** Monotonic mark of the last snapshot encode (local save or push capture); null before any. */
  let lastSnapshotMark: number | null = null;
  /** Monotonic mark of the last push sent (PUT or beacon); null before any. */
  let lastPushMark: number | null = null;
  let routineLocalHandle: unknown = null;
  let routinePushHandle: unknown = null;
  let immediateRun: Promise<void> | null = null;
  let immediateAgain = false;
  let journalShip: { commandId: string; batch: ReturnType<Journal['takeForShip']> } | null = null;
  let running = false;
  let retired = false;
  let lastPendingQuarantine: PendingQuarantine | null = null;
  const subs = new Set<(e: SyncEvent<S>) => void>();

  const emit = (e: SyncEvent<S>): void => {
    deps.onEvent?.(e);
    for (const s of subs) s(e);
  };

  /** Followers and retired clients never write the (shared / previous player's) slot. */
  const mayWrite = (): boolean =>
    !retired && halted === null && !(deps.isLeader && !deps.isLeader());

  /** Write the envelope to the local slot; null when this client may not write it now. */
  const persist = (): StorageSetResult | null => {
    if (gate.isRestoring()) return null;
    if (!mayWrite()) return null;
    return slot.write(env);
  };

  const clearKvTrailing = (): void => {
    if (kvHandle !== null) timers.clear(kvHandle);
    kvHandle = null;
    kvTrailing = null;
  };

  const writeKvMirror = (blob: string): void => {
    clearKvTrailing();
    if (!deps.kv || !deps.kvKey || gate.isRestoring() || !mayWrite()) return;
    kvMirrorMark = clock.mark();
    try {
      deps.kv.set(deps.kvKey, blob);
      void deps.kv.flush().catch(() => undefined);
    } catch {
      /* the mirror is best-effort */
    }
  };

  /**
   * Every KV write is a host-side network write: at most one per kvMirrorMs. A snapshot inside the
   * window is held and ONE trailing write at the window's end carries the newest of them.
   */
  const kvMirror = (blob: string): void => {
    if (!deps.kv || !deps.kvKey || gate.isRestoring() || !mayWrite()) return;
    const waitMs = kvMirrorMark === null ? 0 : kvMirrorMs - clock.sinceMark(kvMirrorMark);
    if (waitMs <= 0) {
      writeKvMirror(blob);
      return;
    }
    kvTrailing = blob;
    if (kvHandle !== null) return;
    kvHandle = timers.set(() => {
      kvHandle = null;
      if (kvTrailing !== null) writeKvMirror(kvTrailing);
    }, waitMs);
  };

  /** Teardown is the mirror's last chance: a held snapshot is written now. */
  const flushKvMirror = (): void => {
    if (kvTrailing !== null) writeKvMirror(kvTrailing);
  };

  const takeSnapshot = (): { state: S; progress: number; json: string; summary?: Summary } => {
    lastSnapshotMark = clock.mark();
    const state = source.settle ? source.settle() : source.state();
    const progress = source.progressOf(state);
    const json = codec.encode(state);
    const summary = source.summary?.(state);
    return summary ? { state, progress, json, summary } : { state, progress, json };
  };

  const pendingRef = (pending: PendingPush): PendingSnapshotRef => ({
    commandId: pending.commandId,
    progress: pending.progress,
    savedAt: pending.savedAt,
    clientSeq: pending.clientSeq,
    generation: pending.generation,
    schemaVersion: pending.schemaVersion,
  });

  const pendingAncestors = (): PendingSnapshotRef[] => {
    const current = env.pending;
    if (!current) return [];
    return [...(current.ancestors ?? []), pendingRef(current)].slice(-MAX_PENDING_ANCESTORS);
  };

  /**
   * Encode + mint a pending snapshot unless the current one already encodes this exact state.
   * Compression yields, so captures overlap (the 10 s autosave, an intent's important save, a
   * purchase's persist, a push). The newest capture owns the commit; an older one that finishes
   * first resolves to the newer one's result, which encodes a later state, instead of failing.
   */
  const capture = (
    reason: SaveReason,
    forceJson = false,
    replaceMatching = false,
  ): Promise<Capture> => {
    const snap = takeSnapshot();
    if (!replaceMatching && env.pending && pendingCanonical === snap.json)
      return Promise.resolve({ pending: env.pending, slot: null });
    // ratchet: the local slot never accepts a shallower state within a generation
    const r = ratchet(env.ratchetFloor, {
      playerId: env.playerId,
      generation: env.generation,
      progress: snap.progress,
    });
    if (!r.accept)
      return Promise.resolve({
        pending: null,
        reason: r.reason === 'older_generation' ? 'older_generation' : 'shallower',
      });
    const epoch = ++snapshotEpoch;
    const dirtyRevisionAtCapture = dirtyRevision;
    const done = (async (): Promise<Capture> => {
      const wire =
        deps.gzip && !forceJson
          ? await encodeForWire(snap.json, { gzip: true })
          : { enc: 'json' as const, blob: snap.json };
      // Leadership/restore state may have changed while compression yielded.
      if (gate.isRestoring() || !mayWrite()) return { pending: null, reason: 'not_writer' };
      // Compression can finish out of order. A newer async capture, synchronous teardown snapshot,
      // envelope swap, or reload owns the commit; an older encoder must never overwrite it.
      if (epoch !== snapshotEpoch) {
        const newer = latestCapture;
        if (newer && newer.epoch === snapshotEpoch) return newer.done;
        return env.pending
          ? { pending: env.pending, slot: null }
          : { pending: null, reason: 'superseded' };
      }
      const ancestors = pendingAncestors();
      const pending: PendingPush = {
        commandId: mintId(),
        encodedBlob: wire.blob,
        enc: wire.enc,
        progress: snap.progress,
        savedAt: clock.now(),
        reason,
        clientSeq: env.clientSeq + 1,
        generation: env.generation,
        schemaVersion: codec.schemaVersion,
        ...(snap.summary ? { summary: snap.summary } : {}),
        ...(ancestors.length ? { ancestors } : {}),
      };
      env = {
        ...env,
        state: snap.state,
        progress: snap.progress,
        savedAt: pending.savedAt,
        deviceSavedAt: clock.deviceNow(),
        savedAtServerAnchored: clock.anchored(),
        clientSeq: pending.clientSeq,
        pending,
        ratchetFloor: r.floor,
        dirty: true,
      };
      if (source.rngState) env.rngState = source.rngState();
      pendingCanonical = snap.json;
      dirtySincePending = dirtyRevision !== dirtyRevisionAtCapture;
      const slotWrite = persist();
      kvMirror(pending.encodedBlob);
      return { pending, slot: slotWrite };
    })();
    latestCapture = { epoch, done };
    return done;
  };

  const ensurePendingSync = (reason: SaveReason): PendingPush | null => {
    const snap = takeSnapshot();
    if (env.pending && pendingCanonical === snap.json) {
      dirtySincePending = false;
      return env.pending;
    }
    const r = ratchet(env.ratchetFloor, {
      playerId: env.playerId,
      generation: env.generation,
      progress: snap.progress,
    });
    if (!r.accept) return null;
    ++snapshotEpoch;
    const ancestors = pendingAncestors();
    const pending: PendingPush = {
      commandId: mintId(),
      encodedBlob: snap.json,
      enc: 'json',
      progress: snap.progress,
      savedAt: clock.now(),
      reason,
      clientSeq: env.clientSeq + 1,
      generation: env.generation,
      schemaVersion: codec.schemaVersion,
      ...(snap.summary ? { summary: snap.summary } : {}),
      ...(ancestors.length ? { ancestors } : {}),
    };
    env = {
      ...env,
      state: snap.state,
      progress: snap.progress,
      savedAt: pending.savedAt,
      deviceSavedAt: clock.deviceNow(),
      savedAtServerAnchored: clock.anchored(),
      clientSeq: pending.clientSeq,
      pending,
      ratchetFloor: r.floor,
      dirty: true,
    };
    if (source.rngState) env.rngState = source.rngState();
    pendingCanonical = snap.json;
    dirtySincePending = false;
    persist();
    // teardown snapshots skip the KV throttle: the page may not live to a trailing write
    writeKvMirror(pending.encodedBlob);
    return pending;
  };

  const bodyFor = (p: PendingPush): SaveWriteBody => ({
    commandId: p.commandId,
    generation: p.generation,
    clientSeq: p.clientSeq,
    baseSeq: env.lastAckedSeq,
    sessionId: env.sessionId,
    progress: p.progress,
    savedAt: p.savedAt,
    schemaVersion: p.schemaVersion,
    buildVersion: deps.buildVersion,
    enc: p.enc,
    reason: p.reason,
    blob: p.encodedBlob,
    ...(p.summary ? { summary: p.summary } : {}),
  });

  const observeServerNow = (sentAt: number, body: unknown): void => {
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as { serverNow?: unknown }).serverNow === 'number'
    ) {
      clock.observe(sentAt, clock.deviceNow(), (body as { serverNow: number }).serverNow);
    }
  };

  const toOutcome = <T>(r: ApiResult<T>): HttpOutcome => {
    if (r.ok) return { kind: 'response', status: r.status, body: r.body };
    if (r.status === 0) return { kind: 'network', error: r.networkError ?? 'network' };
    return { kind: 'response', status: r.status, body: r.error };
  };

  const applyVerdict = async (mapped: MappedVerdict, sentCommandId: string): Promise<void> => {
    const v = mapped.verdict;
    env = { ...env, lastVerdict: v };
    // The verdict belongs to the snapshot that was SENT. A teardown beacon may have minted a newer
    // pending while this request was in flight: that newer pending stays unacked.
    const acksCurrentPending = env.pending?.commandId === sentCommandId;
    if (ACKED_VERDICTS.has(v) && mapped.result) {
      const next: CacheEnvelope<S> = { ...env, lastAckedSeq: mapped.result.seq };
      if (acksCurrentPending) {
        delete next.pending;
        next.dirty = dirtySincePending;
      }
      // `duplicate` is only ever mapped for an anchored original (a replayed refusal/quarantine maps
      // to its original verdict), so it counts as "saved to cloud" too
      if (v === 'synced' || v === 'synced_divergent' || v === 'duplicate')
        next.lastSyncedAt = clock.now();
      env = next;
      if (acksCurrentPending) pendingCanonical = null;
      persist();
      return;
    }
    if (TERMINAL_VERDICTS.has(v) && acksCurrentPending) {
      const next: CacheEnvelope<S> = { ...env };
      delete next.pending;
      env = next;
      pendingCanonical = null;
      dirtySincePending = true;
    }
    if (v === 'refused_regression' && mapped.result)
      emit({ type: 'server_deeper', serverProgress: mapped.result.currentProgress });
    if (v === 'server_behind') {
      halted = 'server_behind';
      emit({
        type: 'alarm',
        kind: 'server_behind',
        localGeneration: env.generation,
        serverGeneration: mapped.serverGeneration ?? -1,
      });
      emit({ type: 'halted', reason: 'server_behind' });
    } else if (v === 'update_required') {
      halted = 'update_required';
      emit({ type: 'halted', reason: 'update_required' });
    } else if (v === 'erased') {
      halted = 'erased';
      emit({ type: 'halted', reason: 'erased' });
    } else if (v === 'throttled') {
      backoffUntil = clock.deviceNow() + (mapped.retryAfterMs ?? 15_000);
    }
    persist();
    if (v === 'refused_stale_generation') {
      // §5.2 Generations: pushed once (stored, refused → reversible); now adopt the server head.
      awaitingAdopt = mapped.serverGeneration ?? env.generation + 1;
      const head = await api_fetchHead({ withBlob: true, timeoutMs: 5_000 });
      if (head.ok) {
        const r = await api_adoptRemote(head.head, 'stale_generation');
        if (r.ok) awaitingAdopt = null;
      }
    }
  };

  /**
   * A push lost to the network, a timeout or a 5xx backs off exponentially with jitter (a 503's
   * retry hint is a floor); any other server answer resets the step. Routine pushes and the timer
   * wait the backoff out; explicit pushes and the teardown beacon do not.
   */
  const noteTransport = (status: number, mapped: MappedVerdict): void => {
    if (status !== 0 && status < 500) {
      transportFailures = 0;
      return;
    }
    transportFailures++;
    const step = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_BASE_MS * 2 ** Math.min(transportFailures - 1, 16),
    );
    const wait = Math.max(step / 2 + (random() * step) / 2, mapped.retryAfterMs ?? 0);
    backoffUntil = clock.deviceNow() + wait;
  };

  const doPush = async (reason: SaveReason, opts: PushOptions = {}): Promise<PushReport> => {
    if (retired) return { skipped: 'retired' };
    if (!enabled) {
      const mapped = mapVerdict({ kind: 'disabled' }, { localGeneration: env.generation });
      env = { ...env, lastVerdict: mapped.verdict };
      const report: PushReport = { commandId: env.pending?.commandId ?? '', reason, ...mapped };
      emit({ type: 'verdict', report });
      return report;
    }
    if (gate.isRestoring()) return { skipped: 'restoring' };
    if (halted) return { skipped: 'halted' };
    if (deps.isLeader && !deps.isLeader()) return { skipped: 'follower' };
    if (awaitingAdopt !== null) {
      // do not create more stored_refused rows: retry the adoption instead
      const head = await api_fetchHead({ withBlob: true, timeoutMs: 5_000 });
      if (head.ok) {
        const r = await api_adoptRemote(head.head, 'stale_generation');
        if (r.ok) awaitingAdopt = null;
      }
      if (awaitingAdopt !== null) return { skipped: 'awaiting_adopt' };
    }
    const auth = opts.auth ?? deps.auth();
    const pending = opts.reusePendingOnly
      ? (env.pending ?? null)
      : (await capture(reason, false, opts.reassertPending === true)).pending;
    if (!pending) return { skipped: 'nothing_to_push' };
    if (!auth) {
      const mapped = mapVerdict({ kind: 'no_token' }, { localGeneration: env.generation });
      env = { ...env, lastVerdict: mapped.verdict };
      persist();
      const report: PushReport = {
        commandId: pending.commandId,
        reason: pending.reason,
        ...mapped,
      };
      emit({ type: 'verdict', report });
      return report;
    }
    lastPushMark = clock.mark();
    const sentAt = clock.deviceNow();
    // A hung request must not hold the push queue: abandon it after pushTimeoutMs (the same
    // commandId retries later, so a request that did land replays as a duplicate).
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = ac ? timers.set(() => ac.abort(), pushTimeoutMs) : null;
    const res = await api.call<SaveWriteResult>('PUT', '/v1/saves', bodyFor(pending), {
      authOverride: auth,
      ...(ac ? { signal: ac.signal } : {}),
    });
    if (timeout !== null) timers.clear(timeout);
    if (res.ok) observeServerNow(sentAt, res.body);
    const mapped = mapVerdict(toOutcome(res), { localGeneration: env.generation });
    noteTransport(res.status, mapped);
    await applyVerdict(mapped, pending.commandId);
    const report: PushReport = { commandId: pending.commandId, reason: pending.reason, ...mapped };
    emit({ type: 'verdict', report });
    return report;
  };

  const push = (reason: SaveReason, opts: PushOptions = {}): Promise<PushReport> => {
    // An in-flight push sent an older snapshot: a fresh push waits for it, then pushes (or joins a
    // push started after this call, which already carries this call's changes).
    if (opts.fresh && inFlight) {
      const rest: PushOptions = { ...opts, fresh: false };
      return inFlight.catch(() => undefined).then(() => push(reason, rest));
    }
    if (inFlight) return inFlight;
    inPush = true;
    const p = doPush(reason, opts).finally(() => {
      inFlight = null;
      inPush = false;
    });
    inFlight = p;
    return p;
  };

  async function api_fetchHead(opts: {
    withBlob: boolean;
    timeoutMs?: number;
  }): Promise<
    | { ok: true; head: RemoteHead }
    | { ok: false; unreachable: boolean; status: number; verdict?: SyncVerdict }
  > {
    if (!enabled) return { ok: false, unreachable: true, status: 0, verdict: 'disabled' };
    const auth = deps.auth();
    if (!auth) return { ok: false, unreachable: true, status: 0, verdict: 'no_token' };
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const ms = opts.timeoutMs ?? headCheckMs;
    const t = ac ? timers.set(() => ac.abort(), ms) : null;
    const sentAt = clock.deviceNow();
    const res = await api.call<SaveCurrentResponse>(
      'GET',
      `/v1/saves/current${opts.withBlob ? '' : '?meta=1'}`,
      undefined,
      ac ? { signal: ac.signal, authOverride: auth } : { authOverride: auth },
    );
    if (t !== null) timers.clear(t);
    if (!res.ok) {
      const unreachable = res.status === 0;
      const mapped = mapVerdict(toOutcome(res), { localGeneration: env.generation });
      return { ok: false, unreachable, status: res.status, verdict: mapped.verdict };
    }
    observeServerNow(sentAt, res.body);
    const b = res.body;
    if (!b || typeof b !== 'object' || typeof b.generation !== 'number')
      return { ok: false, unreachable: false, status: res.status };
    lastPendingQuarantine = b.pendingQuarantine ?? null;
    if (b.empty || !b.snapshot) {
      return {
        ok: true,
        head: {
          kind: 'empty',
          generation: b.generation,
          ...(b.erased ? { erased: true } : {}),
          ...(b.pendingQuarantine ? { pendingQuarantine: b.pendingQuarantine } : {}),
        },
      };
    }
    const head: RemoteHead = { kind: 'snapshot', generation: b.generation, snapshot: b.snapshot };
    if (typeof b.blob === 'string') {
      head.blob = b.blob;
      head.enc = b.enc ?? 'json';
    }
    if (b.pendingQuarantine) head.pendingQuarantine = b.pendingQuarantine;
    return { ok: true, head };
  }

  /** Replace the envelope (adoption / start_new), broadcast a generation change, notify the adapter. */
  const swapEnvelope = (
    next: CacheEnvelope<S>,
    from: number,
    sourceKind: GenerationSource,
  ): void => {
    ++snapshotEpoch;
    clearKvTrailing();
    env = next;
    pendingCanonical = null;
    dirtySincePending = false;
    persist();
    if (next.generation !== from && !retired)
      deps.bus?.announce(env.playerId, env.generation, clock.now());
    emit({
      type: 'generation_changed',
      from,
      to: env.generation,
      state: env.state,
      source: sourceKind,
    });
  };

  async function api_inspectRemote(
    head: RemoteHead,
  ): Promise<{ ok: true; head: RemoteHead; state: S | null } | { ok: false; reason: string }> {
    if (retired) return { ok: false, reason: 'retired' };
    if (head.kind === 'empty') return { ok: true, head, state: null };
    let blob = head.blob;
    let enc = head.enc ?? 'json';
    if (blob === undefined) {
      const full = await api_fetchHead({ withBlob: true, timeoutMs: 5_000 });
      if (!full.ok || full.head.kind !== 'snapshot' || full.head.blob === undefined) {
        return { ok: false, reason: 'blob_unavailable' };
      }
      blob = full.head.blob;
      enc = full.head.enc ?? 'json';
      head = full.head;
    }
    let json: string;
    try {
      json = await decodeFromWire(enc, blob);
    } catch (e) {
      const reason = `decode: ${e instanceof Error ? e.message : String(e)}`;
      return { ok: false, reason };
    }
    const trial = codec.trialDeserialize(json);
    if (!trial.ok) {
      if (trial.reason === 'newer_schema') {
        halted = 'update_required';
        stop();
        emit({ type: 'halted', reason: 'update_required' });
      }
      return { ok: false, reason: trial.reason };
    }
    return { ok: true, head, state: trial.state };
  }

  async function api_adoptRemote(
    head: RemoteHead,
    sourceKind: GenerationSource,
  ): Promise<{ ok: true; state: S } | { ok: false; reason: string }> {
    if (retired) return { ok: false, reason: 'retired' };
    // never swap the envelope under an in-flight push (its pending would be dropped mid-request);
    // when the adoption is triggered from inside the push itself there is nothing to wait for
    if (inFlight && !inPush) await inFlight.catch(() => undefined);
    if (head.kind === 'empty') {
      if (head.erased) {
        halted = 'erased';
        emit({ type: 'halted', reason: 'erased' });
        return { ok: false, reason: 'erased' };
      }
      const state = api_startNew(head.generation, 'start_new');
      return { ok: true, state };
    }
    const inspected = await api_inspectRemote(head);
    if (!inspected.ok) {
      emit({ type: 'adopt_failed', reason: inspected.reason });
      return inspected;
    }
    if (inspected.head.kind !== 'snapshot') {
      emit({ type: 'adopt_failed', reason: 'blob_unavailable' });
      return { ok: false, reason: 'blob_unavailable' };
    }
    const remoteHead = inspected.head;
    const state = inspected.state!;
    const from = env.generation;
    const next = adoptGeneration(env, {
      generation: remoteHead.generation,
      state,
      progress: remoteHead.snapshot.progress,
      seq: remoteHead.snapshot.seq,
      savedAt: remoteHead.snapshot.savedAt ?? clock.now(),
      deviceSavedAt: clock.deviceNow(),
      savedAtServerAnchored: clock.anchored(),
    });
    // same generation, deeper snapshot (reconcile adopt_remote): adoptGeneration keeps the generation
    // and replaces state; the floor moves to the adopted depth.
    if (remoteHead.generation === from) {
      const same: CacheEnvelope<S> = {
        ...env,
        state,
        progress: remoteHead.snapshot.progress,
        savedAt: remoteHead.snapshot.savedAt ?? clock.now(),
        deviceSavedAt: clock.deviceNow(),
        savedAtServerAnchored: clock.anchored(),
        dirty: false,
        lastAckedSeq: remoteHead.snapshot.seq,
        ratchetFloor: {
          playerId: env.playerId,
          generation: from,
          progress: remoteHead.snapshot.progress,
        },
        lastVerdict: null,
      };
      delete same.pending;
      delete same.rngState;
      swapEnvelope(same, from, sourceKind);
    } else {
      swapEnvelope(next, from, sourceKind);
    }
    if (halted === 'server_behind' || halted === 'adopt_failed') halted = null;
    return { ok: true, state: env.state };
  }

  function api_startNew(generation: number, sourceKind: 'boot' | 'start_new'): S {
    const state = deps.newState();
    const from = env.generation;
    const next: CacheEnvelope<S> = {
      ...env,
      generation: Math.max(generation, env.generation),
      state,
      progress: source.progressOf(state),
      savedAt: clock.now(),
      deviceSavedAt: clock.deviceNow(),
      savedAtServerAnchored: clock.anchored(),
      dirty: false,
      lastAckedSeq: 0,
      clientSeq: 0,
      ratchetFloor: {
        playerId: env.playerId,
        generation: Math.max(generation, env.generation),
        progress: source.progressOf(state),
      },
      lastVerdict: null,
    };
    delete next.pending;
    delete next.rngState;
    swapEnvelope(next, from, sourceKind);
    return state;
  }

  const saveLocal = async (reason: SaveReason): Promise<boolean> => {
    if (gate.isRestoring()) return false;
    if (!mayWrite()) return false;
    if (!env.dirty && !dirtySincePending) return true; // clean: nothing to snapshot
    const c = await capture(reason);
    if (deps.journal) await deps.journal.persist();
    if (c.pending === null) emit({ type: 'autosaved', ok: false, reason: c.reason });
    // pending (it still pushes) but not on the device: a full or blocked local slot
    else if (c.slot && !c.slot.ok) emit({ type: 'autosaved', ok: false, reason: c.slot.reason });
    else emit({ type: 'autosaved', ok: true });
    return c.pending !== null;
  };
  const autosave = (): Promise<boolean> => saveLocal('autosave');

  // ── save cadence: routine changes throttle, immediate ones go now ──
  const unpushed = (): boolean => env.dirty || env.pending !== undefined || dirtySincePending;
  const waitAfter = (mark: number | null, windowMs: number): number =>
    mark === null ? 0 : Math.max(0, windowMs - clock.sinceMark(mark));
  const backoffLeft = (): number => Math.max(0, backoffUntil - clock.deviceNow());

  const clearRoutine = (): void => {
    if (routineLocalHandle !== null) timers.clear(routineLocalHandle);
    if (routinePushHandle !== null) timers.clear(routinePushHandle);
    routineLocalHandle = null;
    routinePushHandle = null;
  };

  /** One local snapshot per localSaveMs window: at once after a quiet spell, else at its end. */
  const scheduleRoutineLocal = (): void => {
    if (routineLocalHandle !== null) return;
    routineLocalHandle = timers.set(
      () => {
        routineLocalHandle = null;
        void saveLocal('autosave');
      },
      waitAfter(lastSnapshotMark, localSaveMs),
    );
  };

  /** A push that failed into a backoff retries when it ends; other outcomes wait for news. */
  const retryAfterBackoff = (report: PushReport): void => {
    if (!report.skipped && backoffLeft() > 0 && unpushed()) scheduleRoutinePush();
  };

  /** One push per routinePushMs window, never inside a backoff; it carries the newest state. */
  function scheduleRoutinePush(): void {
    if (routinePushHandle !== null || !enabled) return;
    routinePushHandle = timers.set(
      () => {
        routinePushHandle = null;
        if (retired || gate.isRestoring() || !mayWrite() || !unpushed()) return;
        if (backoffLeft() > 0) {
          scheduleRoutinePush();
          return;
        }
        void push('timer', { fresh: true })
          .then(retryAfterBackoff)
          .catch(() => undefined);
      },
      Math.max(waitAfter(lastPushMark, routinePushMs), backoffLeft()),
    );
  }

  const saveImmediately = (): Promise<void> => {
    immediateAgain = true;
    if (immediateRun) return immediateRun;
    immediateRun = (async () => {
      while (immediateAgain) {
        immediateAgain = false;
        if (retired || gate.isRestoring() || !mayWrite()) return;
        // this save carries every change the routine timers were holding
        clearRoutine();
        await saveLocal('important');
        if (!enabled) continue;
        // the server is known to be failing: the trailing push goes when the backoff ends
        if (backoffLeft() > 0) {
          scheduleRoutinePush();
          continue;
        }
        retryAfterBackoff(await push('important', { fresh: true }));
      }
    })().finally(() => {
      immediateRun = null;
    });
    return immediateRun;
  };

  const requestSave = (priority: SavePriority): Promise<void> => {
    if (retired || gate.isRestoring() || !mayWrite()) return Promise.resolve();
    if (priority === 'immediate') return saveImmediately();
    scheduleRoutineLocal();
    scheduleRoutinePush();
    return Promise.resolve();
  };

  const sendTeardownBeacon = (): boolean => {
    if (!enabled || halted || gate.isRestoring()) return false;
    if (!mayWrite()) return false;
    const auth = deps.auth();
    if (!auth) return false;
    // nothing new since the last acknowledged snapshot: no teardown write
    if (!env.pending && !env.dirty && !dirtySincePending) return false;
    // save first (local slot + pending with its commandId), then send that exact snapshot
    const pending = ensurePendingSync('teardown');
    if (!pending) return false;
    const body: SaveBeaconBody = {
      ...bodyFor(pending),
      playerKey: auth.playerKey,
      token: auth.token,
      requestId: mintId(),
    };
    const text = JSON.stringify(body);
    if (utf8Bytes(text) > LIMITS.beaconMaxBytes) return false;
    const url = `${api.baseUrl}/v1/saves/beacon`;
    lastPushMark = clock.mark();
    if (deps.sendBeacon) {
      try {
        if (deps.sendBeacon(url, text)) return true;
      } catch {
        /* fall through to keepalive */
      }
    }
    void api
      .call<SaveWriteResult>('POST', '/v1/saves/beacon', text, {
        auth: false,
        text: true,
        keepalive: true,
      })
      .then((res) => {
        if (res.ok) {
          const mapped = mapVerdict(toOutcome(res), { localGeneration: env.generation });
          if (
            ACKED_VERDICTS.has(mapped.verdict) &&
            mapped.result &&
            env.pending?.commandId === pending.commandId
          ) {
            const next: CacheEnvelope<S> = {
              ...env,
              lastAckedSeq: mapped.result.seq,
              lastVerdict: mapped.verdict,
              dirty: dirtySincePending,
            };
            delete next.pending;
            if (
              mapped.verdict === 'synced' ||
              mapped.verdict === 'synced_divergent' ||
              mapped.verdict === 'duplicate'
            )
              next.lastSyncedAt = clock.now();
            env = next;
            pendingCanonical = null;
            persist();
          }
        }
      })
      .catch(() => undefined);
    return true;
  };

  const beacon = (): boolean => {
    const sent = sendTeardownBeacon();
    flushKvMirror();
    return sent;
  };

  const shipJournal = async (): Promise<boolean> => {
    const j = deps.journal;
    if (!j || !enabled || halted || gate.isRestoring()) return false;
    // followers hold their entries (never lost) and ship only once they lead; retired never ships
    if (!mayWrite()) return false;
    const auth = deps.auth();
    if (!auth) return false;
    if (!journalShip) {
      const batch = j.takeForShip();
      if (!batch) return false;
      journalShip = { commandId: mintId(), batch };
    }
    const { commandId, batch } = journalShip;
    if (!batch) return false;
    const body = j.shipBody(batch, commandId, env.generation, deps.buildVersion);
    const res = await api.call<{ outcome: string }>('POST', '/v1/journal', body, {
      authOverride: auth,
    });
    if (res.ok) {
      batch.ack();
      journalShip = null;
      return true;
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 401) {
      // contract/precondition failure: drop this batch (non-monotonic seq etc.), never block
      batch.ack();
      journalShip = null;
    }
    return false;
  };

  const needsPush = (): boolean => {
    if (!enabled || halted) return false;
    if (!mayWrite()) return false;
    if (clock.deviceNow() < backoffUntil) return false;
    return env.dirty || env.pending !== undefined || dirtySincePending;
  };

  const status = (): SyncStatus => {
    if (!enabled) return { kind: 'disabled' };
    if (halted) return { kind: 'halted', reason: halted };
    const mode = deps.storageMode?.() ?? 'local';
    const v = env.lastVerdict;
    if (v === 'synced_quarantined') return { kind: 'pending_review' };
    // Only an anchored write shows "saved to cloud"; a divergent anchor adds a note (another writer).
    if (
      (v === 'synced' || v === 'synced_divergent' || v === 'duplicate') &&
      env.lastSyncedAt !== null
    )
      return {
        kind: 'saved_to_cloud',
        agoMs: Math.max(0, clock.now() - env.lastSyncedAt),
        divergent: v === 'synced_divergent',
      };
    if (v === null || v === 'no_token')
      return mode === 'memory' ? { kind: 'cloud_only' } : { kind: 'local_only' };
    if (
      v === 'unreachable' ||
      v === 'rejected_transport' ||
      v === 'throttled' ||
      v === 'unauthorized'
    )
      return mode === 'memory' ? { kind: 'nowhere' } : { kind: 'cloud_unavailable_local' };
    return mode === 'memory' ? { kind: 'cloud_only' } : { kind: 'local_only' };
  };

  const statusText = (): string => {
    const s = status();
    switch (s.kind) {
      case 'saved_to_cloud':
        return `Saved to cloud ${Math.round(s.agoMs / 1000)} s ago${s.divergent ? ' (another device also saved)' : ''}`;
      case 'pending_review':
        return 'Saved, pending review';
      case 'cloud_unavailable_local':
        return 'Cloud unavailable — saving on this device';
      case 'cloud_only':
        return 'Not saving on this device — cloud only';
      case 'local_only':
        return 'Saved on this device';
      case 'nowhere':
        return 'Cloud unavailable — not saving on this device';
      case 'halted':
        return s.reason === 'update_required'
          ? 'Update required to keep saving to cloud'
          : s.reason === 'erased'
            ? 'This account was erased'
            : 'Cloud sync paused — contact support';
      case 'disabled':
        return 'Cloud sync off';
    }
  };

  const stop = (): void => {
    running = false;
    if (autosaveHandle !== null) timers.clear(autosaveHandle);
    if (pushHandle !== null) timers.clear(pushHandle);
    autosaveHandle = null;
    pushHandle = null;
    clearRoutine();
    clearKvTrailing();
  };

  const scheduleAutosave = (delayMs = autosaveMs): void => {
    autosaveHandle = timers.set(() => {
      autosaveHandle = null;
      // a routine save or push took a snapshot inside this window: the next one is due later
      const wait = waitAfter(lastSnapshotMark, autosaveMs);
      if (wait > 0) {
        if (running) scheduleAutosave(wait);
        return;
      }
      void autosave().finally(() => {
        if (autosaveHandle === null && running) scheduleAutosave();
      });
    }, delayMs);
  };
  const schedulePush = (): void => {
    pushHandle = timers.set(() => {
      pushHandle = null;
      let work: Promise<unknown> = Promise.resolve();
      if (needsPush()) {
        // the routine window owns the cadence: a push inside it trails at the window's end
        if (waitAfter(lastPushMark, routinePushMs) > 0) scheduleRoutinePush();
        else work = push('timer');
      }
      void work
        .then(() => shipJournal())
        .catch(() => undefined)
        .finally(() => {
          if (pushHandle === null && running) schedulePush();
        });
    }, pushMs);
  };

  return {
    playerId: deps.playerId,
    envelope: () => env,
    markDirty() {
      dirtyRevision++;
      dirtySincePending = true;
      if (!env.dirty) env = { ...env, dirty: true };
    },
    autosave,
    push: (reason, opts) => push(reason, opts ?? {}),
    requestSave,
    beacon,
    bootRepush(reassert = false) {
      if (retired) return Promise.resolve({ skipped: 'retired' });
      const sent = env.pending
        ? reassert
          ? push(env.pending.reason, { reassertPending: true })
          : push(env.pending.reason, { reusePendingOnly: true })
        : env.dirty
          ? push('boot-retry')
          : null;
      if (!sent) return Promise.resolve({ skipped: 'nothing_to_push' });
      // boot does not wait long for it: one lost to the network retries when its backoff ends
      void sent.then(retryAfterBackoff, () => undefined);
      return sent;
    },
    fetchHead: api_fetchHead,
    inspectRemote: api_inspectRemote,
    adoptRemote: api_adoptRemote,
    startNew: api_startNew,
    shipJournal,
    status,
    statusText,
    pendingQuarantine: () => lastPendingQuarantine,
    onEvent(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    onVerdict(cb) {
      const h = (e: SyncEvent<S>): void => {
        if (e.type === 'verdict' && !e.report.skipped) cb(e.report.verdict, e.report);
      };
      subs.add(h);
      return () => {
        subs.delete(h);
      };
    },
    start() {
      if (running || retired) return;
      running = true;
      scheduleAutosave();
      schedulePush();
    },
    stop,
    reloadFromSlot() {
      const r = slot.read();
      if (!r.ok) {
        if (r.reason === 'incompatible') {
          halted = 'update_required';
          stop();
          emit({ type: 'halted', reason: 'update_required' });
        }
        return false;
      }
      ++snapshotEpoch;
      clearKvTrailing();
      env = { ...r.envelope, sessionId: env.sessionId };
      pendingCanonical = env.pending ? codec.encode(env.state) : null;
      dirtySincePending = dirtySinceFor(env);
      emit({ type: 'reloaded', state: env.state });
      return true;
    },
    halted: () => halted,
    resume() {
      if (halted === 'update_required') return;
      halted = null;
      awaitingAdopt = null;
    },
    needsPush,
    retire() {
      retired = true;
      ++snapshotEpoch;
      stop();
    },
    retired: () => retired,
  };
}
