// Cache envelope + slot naming (§5.2). Sync metadata lives HERE, never in S: the state is a
// claim, the envelope is the local operational record. Slots are origin-scoped:
//   foundation:<gameId>:slot:<playerId>   and   foundation:<gameId>:lastKnownPlayerId
import type { SaveEncoding, SaveReason, SyncVerdict } from '@foundation/contracts/enums';
import type { Summary } from '../engine/contract.ts';
import type { SaveCodec } from './codec.ts';
import type { StorageSetResult, StorageTier } from './tiers.ts';

export const ENVELOPE_FORMAT = 1 as const;

/** Identity of a locally superseded immutable snapshot command. */
export interface PendingSnapshotRef {
  commandId: string;
  progress: number;
  savedAt: number;
  clientSeq: number;
  generation: number;
  schemaVersion: number;
}

/** The encoded snapshot awaiting acknowledgement. Its commandId is minted once and reused verbatim. */
export interface PendingPush {
  commandId: string;
  encodedBlob: string;
  enc: SaveEncoding;
  progress: number;
  savedAt: number;
  reason: SaveReason;
  clientSeq: number;
  generation: number;
  schemaVersion: number;
  summary?: Summary;
  /** Bounded local lineage used to recognize an older own command that reached the server later. */
  ancestors?: PendingSnapshotRef[];
}

/** Depth ratchet floor keyed by playerId + generation (§5.2 Generations). */
export interface RatchetFloor {
  playerId: string;
  generation: number;
  progress: number;
}

export interface CacheEnvelope<S> {
  format: typeof ENVELOPE_FORMAT;
  gameId: string;
  playerId: string;
  schemaVersion: number;
  generation: number;
  state: S;
  progress: number;
  /** Device wall-clock time at the snapshot; optional for backward-compatible offline resume. */
  deviceSavedAt?: number;
  /** True only when `savedAt` was written while the client clock had a server sample. */
  savedAtServerAnchored?: boolean;
  savedAt: number;
  /** Local state newer than the last persisted push. */
  dirty: boolean;
  /** Last server-acknowledged seq (= baseSeq on the next write). */
  lastAckedSeq: number;
  sessionId: string;
  /** Diagnostic client counter (the server assigns seq). */
  clientSeq: number;
  pending?: PendingPush;
  ratchetFloor: RatchetFloor | null;
  lastVerdict: SyncVerdict | null;
  lastSyncedAt: number | null;
  /** Sim rng state captured with the snapshot so a resume continues the stream. */
  rngState?: number;
}

/** Persisted shape: state stored via codec.toJSON at `schemaVersion`. */
interface StoredEnvelope extends Omit<CacheEnvelope<unknown>, 'state'> {
  state: unknown;
}

export function slotKey(gameId: string, playerId: string): string {
  return `foundation:${gameId}:slot:${playerId}`;
}
export function lastKnownPlayerKey(gameId: string): string {
  return `foundation:${gameId}:lastKnownPlayerId`;
}
export function journalSpoolKey(gameId: string, playerId: string): string {
  return `foundation:${gameId}:journal:${playerId}`;
}
/** The one backup of a player's unreadable slot (see backupDamagedSlot). */
export function damagedSlotKey(gameId: string, playerId: string): string {
  return `foundation:${gameId}:damaged:${playerId}`;
}

/**
 * `incompatible` is only a slot written by a NEWER build (envelope format or save schema above
 * this one): it is preserved untouched until a capable client loads. Every other unreadable slot
 * (not JSON, missing fields, a failed or missing migration, an invalid state) is `corrupt`.
 */
export type SlotReadFailure = 'empty' | 'corrupt' | 'incompatible' | 'wrong_owner';

export type SlotReadResult<S> =
  | { ok: true; envelope: CacheEnvelope<S>; migrated: boolean }
  | { ok: false; reason: SlotReadFailure; message?: string };

/** Largest unreadable slot copied to the backup key (UTF-16 code units). */
export const DAMAGED_SLOT_BACKUP_MAX = 512 * 1024;

/**
 * Keep one raw copy of an unreadable slot under its own key before boot treats it as absent (the
 * server copy, or a fresh save, then overwrites the slot). One per player: a later damage replaces
 * it. A slot larger than DAMAGED_SLOT_BACKUP_MAX is not copied.
 */
export function backupDamagedSlot(
  tier: StorageTier,
  gameId: string,
  playerId: string,
): { chars: number; backedUp: boolean } {
  const raw = tier.get(slotKey(gameId, playerId));
  if (raw === null) return { chars: 0, backedUp: false };
  if (raw.length > DAMAGED_SLOT_BACKUP_MAX) return { chars: raw.length, backedUp: false };
  return { chars: raw.length, backedUp: tier.set(damagedSlotKey(gameId, playerId), raw).ok };
}

export interface Slot<S> {
  readonly key: string;
  read(): SlotReadResult<S>;
  write(envelope: CacheEnvelope<S>): StorageSetResult;
  clear(): void;
}

/**
 * A typed slot: read migrates older schema versions forward through the codec (never throws);
 * write persists codec.toJSON(state). The slot refuses an envelope owned by another player/game.
 */
export function createSlot<S>(
  tier: StorageTier,
  key: string,
  codec: SaveCodec<S>,
  owner: { gameId: string; playerId: string },
): Slot<S> {
  return {
    key,
    read() {
      const raw = tier.get(key);
      if (raw === null) return { ok: false, reason: 'empty' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, reason: 'corrupt', message: 'not json' };
      }
      if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'corrupt' };
      const e = parsed as Partial<StoredEnvelope>;
      if (e.format !== ENVELOPE_FORMAT)
        return typeof e.format === 'number' && e.format > ENVELOPE_FORMAT
          ? { ok: false, reason: 'incompatible', message: `envelope format ${e.format}` }
          : { ok: false, reason: 'corrupt', message: 'bad envelope format' };
      if (e.gameId !== owner.gameId || e.playerId !== owner.playerId)
        return { ok: false, reason: 'wrong_owner' };
      if (typeof e.schemaVersion !== 'number' || typeof e.generation !== 'number')
        return { ok: false, reason: 'corrupt', message: 'missing versions' };
      const m = codec.migrate(e.state, e.schemaVersion);
      if (!m.ok)
        return {
          ok: false,
          reason: m.reason === 'newer_schema' ? 'incompatible' : 'corrupt',
          message: m.message ? `${m.reason}: ${m.message}` : m.reason,
        };
      const envelope: CacheEnvelope<S> = {
        format: ENVELOPE_FORMAT,
        gameId: e.gameId,
        playerId: e.playerId,
        schemaVersion: codec.schemaVersion,
        generation: e.generation,
        state: m.state,
        progress: typeof e.progress === 'number' ? e.progress : 0,
        savedAt: typeof e.savedAt === 'number' ? e.savedAt : 0,
        dirty: e.dirty === true || m.migrated,
        lastAckedSeq: typeof e.lastAckedSeq === 'number' ? e.lastAckedSeq : 0,
        sessionId: typeof e.sessionId === 'string' ? e.sessionId : '',
        clientSeq: typeof e.clientSeq === 'number' ? e.clientSeq : 0,
        ratchetFloor: e.ratchetFloor ?? null,
        lastVerdict: e.lastVerdict ?? null,
        lastSyncedAt: typeof e.lastSyncedAt === 'number' ? e.lastSyncedAt : null,
      };
      if (typeof e.deviceSavedAt === 'number' && Number.isFinite(e.deviceSavedAt))
        envelope.deviceSavedAt = e.deviceSavedAt;
      if (e.savedAtServerAnchored === true) envelope.savedAtServerAnchored = true;
      // a pending push encoded under an older schema is dropped (its blob would fail server policy)
      if (e.pending && e.pending.schemaVersion === codec.schemaVersion)
        envelope.pending = e.pending;
      if (typeof e.rngState === 'number') envelope.rngState = e.rngState;
      return { ok: true, envelope, migrated: m.migrated };
    },
    write(envelope) {
      let raw: string;
      try {
        const stored: StoredEnvelope = { ...envelope, state: codec.toJSON(envelope.state) };
        raw = JSON.stringify(stored);
      } catch (e) {
        // a state that cannot be serialised (cycles, BigInt) must not crash a writer mid-flight
        return {
          ok: false,
          reason: 'blocked',
          message: e instanceof Error ? e.message : String(e),
        };
      }
      return tier.set(key, raw);
    },
    clear() {
      tier.remove(key);
    },
  };
}

/** Read the lastKnownPlayerId marker (instant paint before identity confirms). */
export function readLastKnownPlayerId(tier: StorageTier, gameId: string): string | null {
  return tier.get(lastKnownPlayerKey(gameId));
}
export function writeLastKnownPlayerId(tier: StorageTier, gameId: string, playerId: string): void {
  tier.set(lastKnownPlayerKey(gameId), playerId);
}
