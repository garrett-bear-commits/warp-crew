// Identity switch (§5.2 "Identity switch (guest → older account)"): the provider retains the
// previous token for ONE use; onIdentityChanged(prev, next) pushes the guest's final snapshot
// under prev, then either adopts trivially (the target never played) or asks "keep which?".
// Keeping the guest over a deeper account cannot be forced (the server refuses regressions) —
// that is the admin path with proof, surfaced as `needs_admin`.
import type { Player } from '../providers/types.ts';
import type { IdentityClient } from '../providers/types.ts';
import type { PushReport, SyncClient } from '../sync/client.ts';

export interface IdentitySwitchDeps<S> {
  identity: IdentityClient;
  progressOf: (s: S) => number;
  /** Rebind the adapter to `next`: new slot + sync client, reconciled against the server head. */
  rebind: (
    next: Player,
  ) => Promise<{ sync: SyncClient<S>; hadLocal: boolean; remoteEmpty: boolean }>;
  /** Replace the live state (loop + envelope) under `sync`. */
  applyState: (sync: SyncClient<S>, state: S) => void;
  onIntegrity?: (detail: Record<string, string | number | boolean>) => void;
}

export type IdentitySwitchOutcome<S> =
  | { kind: 'no_change' }
  | { kind: 'kept_target'; sync: SyncClient<S>; guestPush: PushReport | null }
  | { kind: 'adopted_guest'; sync: SyncClient<S>; guestPush: PushReport | null; push: PushReport }
  | {
      kind: 'prompt';
      sync: SyncClient<S>;
      guest: { progress: number };
      account: { progress: number };
      guestPush: PushReport | null;
      choose(
        which: 'guest' | 'account',
      ): Promise<{ kind: 'switched' } | { kind: 'needs_admin'; push: PushReport | null }>;
    };

export interface IdentitySwitch<S> {
  onIdentityChanged(
    prev: Player | null,
    next: Player,
    guestSync: SyncClient<S> | null,
  ): Promise<IdentitySwitchOutcome<S>>;
}

export function createIdentitySwitch<S>(deps: IdentitySwitchDeps<S>): IdentitySwitch<S> {
  return {
    async onIdentityChanged(prev, next, guestSync) {
      if (prev && prev.playerId === next.playerId) return { kind: 'no_change' };

      // 1. snapshot the guest's live state into its slot, then push it under the previous token (one use)
      let guestPush: PushReport | null = null;
      if (guestSync) await guestSync.autosave();
      const guestEnv = guestSync?.envelope() ?? null;
      const guestHasPlay = !!guestEnv && guestEnv.progress > 0;
      if (prev && guestSync && guestHasPlay) {
        const pt = deps.identity.previousToken();
        if (pt && pt.playerId === prev.playerId) {
          guestPush = await guestSync.push('important', {
            auth: { playerKey: pt.playerId, token: pt.token },
          });
        }
      }
      deps.onIntegrity?.({
        from: prev?.playerId ?? '',
        to: next.playerId,
        guestProgress: guestEnv?.progress ?? 0,
        guestPushed: guestPush !== null && !guestPush.skipped,
      });

      // 2. rebind to the target identity (its slot + a bounded head check)
      const target = await deps.rebind(next);
      const targetEnv = target.sync.envelope();
      if (!guestHasPlay || !guestEnv) return { kind: 'kept_target', sync: target.sync, guestPush };

      const targetTrivial =
        !target.hadLocal &&
        target.remoteEmpty &&
        targetEnv.progress === 0 &&
        targetEnv.lastAckedSeq === 0;
      const carryGuest = async (): Promise<PushReport> => {
        deps.applyState(target.sync, guestEnv.state);
        target.sync.markDirty();
        return target.sync.push('important');
      };
      if (targetTrivial) {
        const push = await carryGuest();
        return { kind: 'adopted_guest', sync: target.sync, guestPush, push };
      }

      // 3. both have play: "keep which?"
      return {
        kind: 'prompt',
        sync: target.sync,
        guest: { progress: guestEnv.progress },
        account: { progress: targetEnv.progress },
        guestPush,
        async choose(which) {
          if (which === 'account') return { kind: 'switched' };
          // a shallower guest can never overwrite a deeper account (ratchet + server refusal): admin path
          if (guestEnv.progress < targetEnv.progress) return { kind: 'needs_admin', push: null };
          const push = await carryGuest();
          if (!push.skipped && push.verdict === 'refused_regression')
            return { kind: 'needs_admin', push };
          return { kind: 'switched' };
        },
      };
    },
  };
}
