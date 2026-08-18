// SyncClient (§5.2 Sync + Generations, §6 Saves, ADR-005/006/019). Owns the cache envelope for
// one player: local autosave (10 s, dirty only), server push (60 s state-driven timer, important
// events, after restore, hidden → beacon), verdict mapping, ratchet, generation adoption and the
// boot re-push. Every push carries a client-minted commandId minted WITH the encoded snapshot,
// persisted in the envelope BEFORE the first attempt and reused verbatim on every retry — the
// beacon and the boot re-push included. Client state/progress are claims; sync metadata lives
// in the envelope, never in S. Only `synced` is ever shown as "saved to cloud".
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
import type { CacheEnvelope, PendingPush, Slot } from '../storage/envelope.ts';
import type { StorageMode } from '../storage/tiers.ts';
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

export type SyncEvent<S> =
  | { type: 'verdict'; report: PushReport }
  | { type: 'generation_changed'; from: number; to: number; state: S; source: GenerationSource }
  | { type: 'alarm'; kind: 'server_behind'; localGeneration: number; serverGeneration: number }
  | { type: 'halted'; reason: HaltReason }
  | { type: 'server_deeper'; serverProgress: number }
  | { type: 'autosaved'; ok: boolean }
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
  intervals?: { autosaveMs?: number; pushMs?: number; headCheckMs?: number };
  onEvent?: (e: SyncEvent<S>) => void;
}

export interface SyncClient<S> {
  readonly playerId: string;
  envelope(): CacheEnvelope<S>;
  /** Live state changed since the last snapshot (called by the adapter on every publish). */
  markDirty(): void;
  /** Persist dirty state to the local slot + refresh the encoded pending snapshot (10 s path). */
  autosave(): Promise<boolean>;
  push(reason: SaveReason, opts?: { auth?: ClientAuth }): Promise<PushReport>;
  /** Teardown: save first, then sendBeacon (≤ 64 KiB) with the pending commandId; keepalive fallback. */
  beacon(): boolean;
  /** Boot: re-push the last unacked snapshot verbatim BEFORE offline credit. */
  bootRepush(): Promise<PushReport>;
  /** Bounded server head check (GET /v1/saves/current[?meta=1]). */
  fetchHead(opts: {
    withBlob: boolean;
    timeoutMs?: number;
  }): Promise<
    | { ok: true; head: RemoteHead }
    | { ok: false; unreachable: boolean; status: number; verdict?: SyncVerdict }
  >;
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
  /** Operator-enabled: clear a halt after lineage.reattach or a build update. */
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

const DEFAULT_AUTOSAVE_MS = 10_000;
const DEFAULT_PUSH_MS = 60_000;
const DEFAULT_HEAD_CHECK_MS = 800;

export function createSyncClient<S>(deps: SyncClientDeps<S>): SyncClient<S> {
  const { api, codec, slot, clock, timers, gate, source } = deps;
  const enabled = deps.enabled !== false;
  const autosaveMs = deps.intervals?.autosaveMs ?? DEFAULT_AUTOSAVE_MS;
  const pushMs = deps.intervals?.pushMs ?? DEFAULT_PUSH_MS;
  const headCheckMs = deps.intervals?.headCheckMs ?? DEFAULT_HEAD_CHECK_MS;

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
  let halted: HaltReason | null = null;
  let awaitingAdopt: number | null = null;
  let inFlight: Promise<PushReport> | null = null;
  let inPush = false;
  let autosaveHandle: unknown = null;
  let pushHandle: unknown = null;
  let backoffUntil = 0;
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
  const mayWrite = (): boolean => !retired && !(deps.isLeader && !deps.isLeader());

  const persist = (): boolean => {
    if (gate.isRestoring()) return false;
    if (!mayWrite()) return false;
    const r = slot.write(env);
    return r.ok;
  };

  const kvMirror = (blob: string): void => {
    if (!deps.kv || !deps.kvKey || gate.isRestoring() || !mayWrite()) return;
    try {
      deps.kv.set(deps.kvKey, blob);
      void deps.kv.flush().catch(() => undefined);
    } catch {
      /* the mirror is best-effort */
    }
  };

  const takeSnapshot = (): { state: S; progress: number; json: string; summary?: Summary } => {
    const state = source.settle ? source.settle() : source.state();
    const progress = source.progressOf(state);
    const json = codec.encode(state);
    const summary = source.summary?.(state);
    return summary ? { state, progress, json, summary } : { state, progress, json };
  };

  /** Encode + mint a pending snapshot unless the current one already encodes this exact state. */
  const ensurePending = async (
    reason: SaveReason,
    forceJson = false,
  ): Promise<PendingPush | null> => {
    const snap = takeSnapshot();
    if (env.pending && pendingCanonical === snap.json) return env.pending;
    // ratchet: the local slot never accepts a shallower state within a generation
    const r = ratchet(env.ratchetFloor, {
      playerId: env.playerId,
      generation: env.generation,
      progress: snap.progress,
    });
    if (!r.accept) return null;
    const wire =
      deps.gzip && !forceJson
        ? await encodeForWire(snap.json, { gzip: true })
        : { enc: 'json' as const, blob: snap.json };
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
    };
    env = {
      ...env,
      state: snap.state,
      progress: snap.progress,
      savedAt: pending.savedAt,
      clientSeq: pending.clientSeq,
      pending,
      ratchetFloor: r.floor,
      dirty: true,
    };
    if (source.rngState) env.rngState = source.rngState();
    pendingCanonical = snap.json;
    dirtySincePending = false;
    persist();
    kvMirror(pending.encodedBlob);
    return pending;
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
    };
    env = {
      ...env,
      state: snap.state,
      progress: snap.progress,
      savedAt: pending.savedAt,
      clientSeq: pending.clientSeq,
      pending,
      ratchetFloor: r.floor,
      dirty: true,
    };
    if (source.rngState) env.rngState = source.rngState();
    pendingCanonical = snap.json;
    dirtySincePending = false;
    persist();
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
    } else if (v === 'throttled' || (v === 'rejected_transport' && mapped.retryAfterMs)) {
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

  const doPush = async (
    reason: SaveReason,
    opts: { auth?: ClientAuth; reusePendingOnly?: boolean } = {},
  ): Promise<PushReport> => {
    if (retired) return { skipped: 'retired' };
    if (!enabled) {
      const mapped = mapVerdict({ kind: 'disabled' }, { localGeneration: env.generation });
      env = { ...env, lastVerdict: mapped.verdict };
      const report: PushReport = { commandId: env.pending?.commandId ?? '', reason, ...mapped };
      emit({ type: 'verdict', report });
      return report;
    }
    if (gate.isRestoring()) return { skipped: 'restoring' };
    if (deps.isLeader && !deps.isLeader()) return { skipped: 'follower' };
    if (halted) return { skipped: 'halted' };
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
    const pending = opts.reusePendingOnly ? (env.pending ?? null) : await ensurePending(reason);
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
    const sentAt = clock.deviceNow();
    const res = await api.call<SaveWriteResult>('PUT', '/v1/saves', bodyFor(pending), {
      authOverride: auth,
    });
    if (res.ok) observeServerNow(sentAt, res.body);
    const mapped = mapVerdict(toOutcome(res), { localGeneration: env.generation });
    await applyVerdict(mapped, pending.commandId);
    const report: PushReport = { commandId: pending.commandId, reason: pending.reason, ...mapped };
    emit({ type: 'verdict', report });
    return report;
  };

  const push = (
    reason: SaveReason,
    opts: { auth?: ClientAuth; reusePendingOnly?: boolean } = {},
  ): Promise<PushReport> => {
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
    let blob = head.blob;
    let enc = head.enc ?? 'json';
    if (blob === undefined) {
      const full = await api_fetchHead({ withBlob: true, timeoutMs: 5_000 });
      if (!full.ok || full.head.kind !== 'snapshot' || full.head.blob === undefined) {
        emit({ type: 'adopt_failed', reason: 'blob_unavailable' });
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
      emit({ type: 'adopt_failed', reason });
      return { ok: false, reason };
    }
    const trial = codec.trialDeserialize(json);
    if (!trial.ok) {
      if (trial.reason === 'newer_schema') {
        halted = 'update_required';
        emit({ type: 'halted', reason: 'update_required' });
      }
      emit({ type: 'adopt_failed', reason: trial.reason });
      return { ok: false, reason: trial.reason };
    }
    const from = env.generation;
    const next = adoptGeneration(env, {
      generation: head.generation,
      state: trial.state,
      progress: head.snapshot.progress,
      seq: head.snapshot.seq,
      savedAt: head.snapshot.savedAt ?? clock.now(),
    });
    // same generation, deeper snapshot (reconcile adopt_remote): adoptGeneration keeps the generation
    // and replaces state; the floor moves to the adopted depth.
    if (head.generation === from) {
      const same: CacheEnvelope<S> = {
        ...env,
        state: trial.state,
        progress: head.snapshot.progress,
        savedAt: head.snapshot.savedAt ?? clock.now(),
        dirty: false,
        lastAckedSeq: head.snapshot.seq,
        ratchetFloor: {
          playerId: env.playerId,
          generation: from,
          progress: head.snapshot.progress,
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

  const autosave = async (): Promise<boolean> => {
    if (gate.isRestoring()) return false;
    if (!mayWrite()) return false;
    if (!env.dirty && !dirtySincePending) return true; // clean: nothing to snapshot
    const p = await ensurePending('autosave');
    const ok = p !== null;
    if (deps.journal) await deps.journal.persist();
    emit({ type: 'autosaved', ok });
    return ok;
  };

  const beacon = (): boolean => {
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
  };

  const scheduleAutosave = (): void => {
    autosaveHandle = timers.set(() => {
      autosaveHandle = null;
      void autosave().finally(() => {
        if (autosaveHandle === null && running) scheduleAutosave();
      });
    }, autosaveMs);
  };
  const schedulePush = (): void => {
    pushHandle = timers.set(() => {
      pushHandle = null;
      const work = needsPush()
        ? push('timer')
        : Promise.resolve<PushReport>({ skipped: 'nothing_to_push' });
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
      dirtySincePending = true;
      if (!env.dirty) env = { ...env, dirty: true };
    },
    autosave,
    push: (reason, opts) => push(reason, opts ?? {}),
    beacon,
    bootRepush() {
      if (retired) return Promise.resolve({ skipped: 'retired' });
      if (env.pending) return push(env.pending.reason, { reusePendingOnly: true });
      if (env.dirty) return push('boot-retry');
      return Promise.resolve({ skipped: 'nothing_to_push' });
    },
    fetchHead: api_fetchHead,
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
      if (!r.ok) return false;
      env = { ...r.envelope, sessionId: env.sessionId };
      pendingCanonical = env.pending ? codec.encode(env.state) : null;
      dirtySincePending = dirtySinceFor(env);
      emit({ type: 'reloaded', state: env.state });
      return true;
    },
    halted: () => halted,
    resume() {
      halted = null;
      awaitingAdopt = null;
    },
    needsPush,
    retire() {
      retired = true;
      stop();
    },
    retired: () => retired,
  };
}
