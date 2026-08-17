// Restore (§1 "Restore = write local → confirm → reload, with one restoring gate", §5.2 Restore,
// ADR-005 break-glass). Player forward-only restore: trial-deserialise, deeper only, push current →
// write local → confirm → reload under the gate. Restore-to-point: POST /v1/lineage/restoreToSeq
// (generation bump) then adopt the seeded head. KV break-glass: `kv.readBreakGlass` ONCE,
// trial-deserialise, forward-only restore — human-initiated only (never called by boot or timers).
// server_behind recovery: lineage.reattach when the operator enables it.
import type {
  GenerationReceipt,
  LineageReattachBody,
  LineageRestoreToSeqBody,
  SaveBlobResponse,
} from '@foundation/contracts';
import type { Api } from '../api.ts';
import type { Clock } from '../clock/index.ts';
import { mintId } from '../ids.ts';
import type { PlatformKV } from '../providers/types.ts';
import { decodeFromWire, type SaveCodec } from '../storage/codec.ts';
import type { CacheEnvelope, Slot } from '../storage/envelope.ts';
import type { SyncClient } from '../sync/client.ts';
import { ratchetForce } from '../sync/ratchet.ts';
import type { RestoreGate } from './gate.ts';

export type RestoreOutcome =
  | {
      ok: true;
      kind: 'forward' | 'restore_to_seq' | 'break_glass' | 'reattach';
      generation: number;
      progress: number;
    }
  | {
      ok: false;
      reason:
        | 'restoring'
        | 'trial_failed'
        | 'not_deeper'
        | 'write_failed'
        | 'confirm_failed'
        | 'stale_generation'
        | 'unreachable'
        | 'rejected'
        | 'kv_empty'
        | 'kv_unavailable'
        | 'no_token'
        | 'blob_unavailable';
      message?: string;
      /** For stale_generation: the server's active generation. */
      serverGeneration?: number;
    };

export interface RestoreDeps<S> {
  api: Api;
  codec: SaveCodec<S>;
  slot: Slot<S>;
  sync: SyncClient<S>;
  gate: RestoreGate;
  clock: Clock;
  progressOf: (s: S) => number;
  buildVersion: string;
  /** window.location.reload, injectable. Called last, after confirm. */
  reload: () => void;
  kv?: PlatformKV | null;
  kvKey?: string;
  onIntegrity?: (
    kind: 'restore_used' | 'kv_break_glass_read',
    detail: Record<string, string | number | boolean>,
  ) => void;
}

export interface Restore {
  /** Player forward-only restore from a blob string (json or gzip+b64 with `enc`). */
  forwardOnly(blob: string, enc?: 'json' | 'gzip+b64'): Promise<RestoreOutcome>;
  /** Restore-to-point: new generation seeded from `seq` (server-side), then adopt the head. */
  restoreToSeq(seq: number): Promise<RestoreOutcome>;
  /** Fetch a historic blob by seq and restore forward-only (deeper only). */
  fromHistory(seq: number): Promise<RestoreOutcome>;
  /** Human-initiated break-glass read of the platform KV mirror; forward-only restore. */
  breakGlassFromKv(): Promise<RestoreOutcome>;
  /** server_behind recovery (operator-enabled): reattach the client generation on the server. */
  reattach(): Promise<RestoreOutcome>;
}

export function createRestore<S>(deps: RestoreDeps<S>): Restore {
  const { api, codec, slot, sync, gate, clock } = deps;

  const forwardOnly = async (
    blob: string,
    enc: 'json' | 'gzip+b64' = 'json',
    kind: 'forward' | 'break_glass' = 'forward',
  ): Promise<RestoreOutcome> => {
    if (gate.isRestoring()) return { ok: false, reason: 'restoring' };
    let json: string;
    try {
      json = await decodeFromWire(enc, blob);
    } catch (e) {
      return {
        ok: false,
        reason: 'trial_failed',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    const trial = codec.trialDeserialize(json);
    if (!trial.ok) return { ok: false, reason: 'trial_failed', message: trial.reason };
    const restoredProgress = deps.progressOf(trial.state);
    if (!(restoredProgress > sync.envelope().progress)) return { ok: false, reason: 'not_deeper' };

    // 1. push current — the pre-restore state reaches the server as evidence/fallback. This
    //    happens BEFORE the gate is held because every writer (this push included) refuses to
    //    run while the gate is closed.
    await sync.push('restore');

    return gate.hold(async (): Promise<RestoreOutcome> => {
      // 2. write local: the restored state replaces the slot, floor forced to the restored depth
      const cur = sync.envelope();
      const next: CacheEnvelope<S> = {
        ...cur,
        state: trial.state,
        progress: restoredProgress,
        savedAt: clock.now(),
        dirty: true,
        ratchetFloor: ratchetForce({
          playerId: cur.playerId,
          generation: cur.generation,
          progress: restoredProgress,
        }),
        lastVerdict: null,
      };
      delete next.pending;
      delete next.rngState;
      const w = slot.write(next);
      if (!w.ok) return { ok: false, reason: 'write_failed', message: w.reason };
      // 3. confirm: read back and compare depth + generation
      const back = slot.read();
      if (
        !back.ok ||
        back.envelope.progress !== restoredProgress ||
        back.envelope.generation !== cur.generation
      )
        return { ok: false, reason: 'confirm_failed' };
      deps.onIntegrity?.('restore_used', {
        kind,
        progress: restoredProgress,
        generation: cur.generation,
      });
      // 4. reload — boot adopts the restored slot; the sync client pushes it with reason 'restore'.
      //    The in-memory envelope is refreshed first so a delayed/no-op reload never plays a stale state.
      sync.reloadFromSlot();
      deps.reload();
      return { ok: true, kind, generation: cur.generation, progress: restoredProgress };
    });
  };

  const restoreToSeq = async (seq: number): Promise<RestoreOutcome> => {
    if (gate.isRestoring()) return { ok: false, reason: 'restoring' };
    const env = sync.envelope();
    const body: LineageRestoreToSeqBody = {
      commandId: mintId(),
      seq,
      expectedGeneration: env.generation,
    };
    const res = await api.call<GenerationReceipt>('POST', '/v1/lineage/restoreToSeq', body);
    if (!res.ok) {
      if (res.status === 0) return { ok: false, reason: 'unreachable' };
      if (res.status === 409 && res.error?.error === 'stale_generation') {
        const d = res.error.details as { generation?: number } | undefined;
        return {
          ok: false,
          reason: 'stale_generation',
          ...(typeof d?.generation === 'number' ? { serverGeneration: d.generation } : {}),
        };
      }
      if (res.status === 401) return { ok: false, reason: 'no_token' };
      return { ok: false, reason: 'rejected', message: res.error?.error ?? `http ${res.status}` };
    }
    return gate.hold(async (): Promise<RestoreOutcome> => {
      const head = await sync.fetchHead({ withBlob: true, timeoutMs: 5_000 });
      if (!head.ok) return { ok: false, reason: 'unreachable' };
      // adopt in memory (+ broadcast); the sync client's own persist is gated, so write + confirm here
      const r = await sync.adoptRemote(head.head, 'restore');
      if (!r.ok) return { ok: false, reason: 'blob_unavailable', message: r.reason };
      const w = slot.write(sync.envelope());
      if (!w.ok) return { ok: false, reason: 'write_failed', message: w.reason };
      const back = slot.read();
      if (!back.ok || back.envelope.generation !== res.body.generation)
        return { ok: false, reason: 'confirm_failed' };
      deps.onIntegrity?.('restore_used', {
        kind: 'restore_to_seq',
        seq,
        generation: res.body.generation,
      });
      deps.reload();
      return {
        ok: true,
        kind: 'restore_to_seq',
        generation: res.body.generation,
        progress: sync.envelope().progress,
      };
    });
  };

  const fromHistory = async (seq: number): Promise<RestoreOutcome> => {
    const res = await api.call<SaveBlobResponse>('GET', `/v1/saves/history/${seq}/blob`);
    if (!res.ok)
      return res.status === 0
        ? { ok: false, reason: 'unreachable' }
        : { ok: false, reason: 'blob_unavailable' };
    return forwardOnly(res.body.blob, res.body.enc);
  };

  const breakGlassFromKv = async (): Promise<RestoreOutcome> => {
    if (!deps.kv || !deps.kvKey) return { ok: false, reason: 'kv_unavailable' };
    let value: string | null;
    try {
      value = await deps.kv.readBreakGlass(deps.kvKey);
    } catch (e) {
      return {
        ok: false,
        reason: 'kv_unavailable',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    deps.onIntegrity?.('kv_break_glass_read', { found: value !== null });
    if (value === null) return { ok: false, reason: 'kv_empty' };
    // the mirror stores the wire blob; json unless it does not parse as json (then gzip+b64)
    const enc: 'json' | 'gzip+b64' = value.startsWith('{') ? 'json' : 'gzip+b64';
    return forwardOnly(value, enc, 'break_glass');
  };

  const reattach = async (): Promise<RestoreOutcome> => {
    if (gate.isRestoring()) return { ok: false, reason: 'restoring' };
    const env = sync.envelope();
    const head = await sync.fetchHead({ withBlob: false, timeoutMs: 5_000 });
    if (!head.ok) return { ok: false, reason: 'unreachable' };
    const state = env.state;
    const body: LineageReattachBody = {
      commandId: mintId(),
      clientGeneration: env.generation,
      expectedServerGeneration: head.head.generation,
      snapshot: {
        progress: env.progress,
        schemaVersion: codec.schemaVersion,
        buildVersion: deps.buildVersion,
        enc: 'json',
        blob: codec.encode(state),
        savedAt: env.savedAt || clock.now(),
      },
    };
    const res = await api.call<GenerationReceipt>('POST', '/v1/lineage/reattach', body);
    if (!res.ok) {
      if (res.status === 0) return { ok: false, reason: 'unreachable' };
      if (res.status === 409) return { ok: false, reason: 'stale_generation' };
      return { ok: false, reason: 'rejected', message: res.error?.error ?? `http ${res.status}` };
    }
    sync.resume();
    const h2 = await sync.fetchHead({ withBlob: true, timeoutMs: 5_000 });
    if (h2.ok) await sync.adoptRemote(h2.head, 'restore');
    return {
      ok: true,
      kind: 'reattach',
      generation: res.body.generation,
      progress: sync.envelope().progress,
    };
  };

  return {
    forwardOnly: (b, e) => forwardOnly(b, e ?? 'json'),
    restoreToSeq,
    fromHistory,
    breakGlassFromKv,
    reattach,
  };
}
