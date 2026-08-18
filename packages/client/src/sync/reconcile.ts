// Boot reconcile (§5.2 State lifecycle + Generations, ADR-005). Pure decision over the local
// envelope and the server head: adopt if the remote is deeper and the local copy is clean; keep
// local if local is deeper/equal, or dirty and the remote is not a newer generation; prompt if
// dirty and the remote is deeper; a newer generation ALWAYS wins (adopt regardless of depth);
// empty cache for a returning identity with the cloud unreachable → cloud_unreachable; both
// empty → start_new. Property-tested (test/unit/reconcile.test.ts).
import type { PendingQuarantine, SnapshotMeta } from '@foundation/contracts';
import type { CacheEnvelope } from '../storage/envelope.ts';

export type RemoteHead =
  | {
      kind: 'empty';
      generation: number;
      erased?: boolean;
      /** A player whose only writes are quarantined: no anchor, but a save awaits review. */
      pendingQuarantine?: PendingQuarantine;
    }
  | {
      kind: 'snapshot';
      generation: number;
      /** Anchor meta (progress/seq are what the decision reads). */
      snapshot: Pick<SnapshotMeta, 'seq' | 'progress' | 'generation' | 'schemaVersion'> &
        Partial<SnapshotMeta>;
      /** Only present when the head was fetched with the blob. */
      blob?: string;
      enc?: 'json' | 'gzip+b64';
      pendingQuarantine?: PendingQuarantine;
    };

export interface ReconcileInput<S> {
  local: CacheEnvelope<S> | null;
  /** null when the head check did not complete (timeout/network). */
  remote: RemoteHead | null;
  remoteUnreachable: boolean;
  /**
   * The identity has evidence of prior play (registered account, or the lastKnownPlayerId marker
   * matched). Drives cloud_unreachable vs start_new when the cache is empty.
   */
  returningIdentity: boolean;
}

export type ReconcileAction =
  'adopt_remote' | 'keep_local' | 'prompt' | 'start_new' | 'cloud_unreachable';

export interface ReconcileDecision {
  action: ReconcileAction;
  reason:
    | 'no_local_remote_snapshot'
    | 'remote_newer_generation'
    | 'remote_deeper_local_clean'
    | 'remote_deeper_local_dirty'
    | 'local_deeper_or_equal'
    | 'local_newer_generation'
    | 'remote_empty_local_present'
    | 'both_empty'
    | 'erased'
    | 'unreachable_local_present'
    | 'unreachable_returning_identity'
    | 'unreachable_new_identity';
  /** Generation the client should be on after acting. */
  generation: number;
  /** A deeper quarantined save awaits review on the server (UI: "pending review"). */
  pendingQuarantine?: PendingQuarantine;
  /** True when the local copy should be pushed once before adopting (stale-generation evidence). */
  pushLocalFirst?: boolean;
}

export function reconcile<S>(input: ReconcileInput<S>): ReconcileDecision {
  const { local, remote, remoteUnreachable, returningIdentity } = input;

  if (remoteUnreachable || !remote) {
    if (local)
      return {
        action: 'keep_local',
        reason: 'unreachable_local_present',
        generation: local.generation,
      };
    if (returningIdentity)
      return {
        action: 'cloud_unreachable',
        reason: 'unreachable_returning_identity',
        generation: 0,
      };
    return { action: 'start_new', reason: 'unreachable_new_identity', generation: 0 };
  }

  // A quarantined save deeper than the anchor (or with no anchor at all) awaits review: carried on
  // every decision so the player learns of it instead of silently starting new / keeping local.
  const pq = remote.pendingQuarantine ? { pendingQuarantine: remote.pendingQuarantine } : {};

  if (remote.kind === 'empty') {
    if (remote.erased)
      return {
        action: 'start_new',
        reason: 'erased',
        generation: Math.max(remote.generation, local?.generation ?? 0),
      };
    if (!local)
      return { action: 'start_new', reason: 'both_empty', generation: remote.generation, ...pq };
    // A newer generation on the server always wins even when it holds no snapshot yet
    // (restart/erase from another device): the client starts fresh in that generation.
    if (remote.generation > local.generation)
      return {
        action: 'start_new',
        reason: 'remote_newer_generation',
        generation: remote.generation,
        pushLocalFirst: local.dirty || local.pending !== undefined,
        ...pq,
      };
    return {
      action: 'keep_local',
      reason: 'remote_empty_local_present',
      generation: local.generation,
      ...pq,
    };
  }

  if (!local)
    return {
      action: 'adopt_remote',
      reason: 'no_local_remote_snapshot',
      generation: remote.generation,
      ...pq,
    };
  if (remote.generation > local.generation)
    return {
      action: 'adopt_remote',
      reason: 'remote_newer_generation',
      generation: remote.generation,
      pushLocalFirst: local.dirty || local.pending !== undefined,
      ...pq,
    };
  if (remote.generation < local.generation)
    return { action: 'keep_local', reason: 'local_newer_generation', generation: local.generation };

  const remoteDeeper = remote.snapshot.progress > local.progress;
  if (!remoteDeeper)
    return {
      action: 'keep_local',
      reason: 'local_deeper_or_equal',
      generation: local.generation,
      ...pq,
    };
  const unacked = local.dirty || local.pending !== undefined;
  if (!unacked)
    return {
      action: 'adopt_remote',
      reason: 'remote_deeper_local_clean',
      generation: remote.generation,
      ...pq,
    };
  return {
    action: 'prompt',
    reason: 'remote_deeper_local_dirty',
    generation: remote.generation,
    ...pq,
  };
}
