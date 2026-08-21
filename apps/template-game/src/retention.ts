// Registered-player rolling return plan for the template. Jest delivers notifications on a fuzzy
// schedule and may choose at most one per user/day across games, so copy never promises an exact
// time. The configured asset reference must be uploaded and approved in the Developer Console.
import type {
  LadderItem,
  NotificationsProvider,
  Player,
  ScheduleResult,
  StorageTier,
  TabBus,
  Timers,
} from '@foundation/client';
import { createBroadcastTabBus, createTabLease, realTimers } from '@foundation/client';

export const RETENTION_IDENTIFIERS = [
  'template:return:d1',
  'template:return:d2',
  'template:return:d3',
  'template:return:d4',
  'template:return:d5',
  'template:return:d6',
  'template:return:d7',
] as const;

export const RETENTION_RETURN_MIN_MS = 5 * 60_000;
export const RETENTION_PLAN_VERSION = 'v2';

const COPY = [
  [
    'Your next upgrade is waiting.',
    'A quick visit can move your counter forward.',
    'Your idle workshop is ready for another step.',
    'Come back and choose the next upgrade.',
    'Your progress is safe. Add another boost when ready.',
    'A new run can push your workshop further.',
    'Your week-old workshop is ready for you.',
  ],
  [
    'There is more progress ready to unlock.',
    'Your workshop has another decision waiting.',
    'Return when you are ready for the next boost.',
    'A fresh upgrade can move your run forward.',
    'Your workshop is ready for a quick check-in.',
    'Come back and shape the next stage of your run.',
    'Your workshop still has room to grow.',
  ],
  [
    'Your latest run is ready for its next step.',
    'A new choice is waiting in your workshop.',
    'Your progress can use one more smart upgrade.',
    'Return and set the next workshop priority.',
    'A short visit can unlock your next move.',
    'Your workshop is ready for another push.',
    'Come back and start the next week stronger.',
  ],
] as const;

const VARIANTS = ['a', 'b', 'c'] as const;

function retentionOrdinalKey(gameId: string, playerId: string): string {
  return `foundation:${gameId}:retention:${RETENTION_PLAN_VERSION}:${playerId}`;
}

/**
 * Reserve the next copy variant in origin storage. The versioned, per-player cursor survives cold
 * launches when local storage is available; StorageTier's memory overlay still rotates safely for
 * the lifetime of a storage-blocked session.
 */
export function claimRetentionOrdinal(
  storage: Pick<StorageTier, 'get' | 'set'>,
  gameId: string,
  playerId: string,
): number {
  const key = retentionOrdinalKey(gameId, playerId);
  const raw = storage.get(key);
  const ordinal = raw !== null && /^[0-2]$/.test(raw) ? Number(raw) : 0;
  storage.set(key, String((ordinal + 1) % VARIANTS.length));
  return ordinal;
}

export interface RetentionPlanInput {
  buildVersion: string;
  assetReference: string;
  progress: number;
  returnOrdinal: number;
}

export interface RetentionCoordinatorRequest {
  booted: boolean;
  player: Player | null;
  visible: boolean;
  progress: number;
}

export interface RetentionCoordinatorOptions {
  notifications: NotificationsProvider;
  storage: Pick<StorageTier, 'get' | 'set'>;
  gameId: string;
  buildVersion: string;
  assetReference: string;
  /** Reads the live Web Locks election result; callers must reconcile when it changes. */
  isLeader(): boolean;
  /**
   * When false, every tab already believes it is leader (no Web Locks). Ignore `isLeader()` and
   * elect a single writer over `tabBus`. Default true (trust the existing tab leader).
   */
  leaderAvailable?: boolean;
  /** Injected bus for the no-Web-Locks fallback. `null` disables mutation in that mode. */
  tabBus?: TabBus | null;
  now?: () => number;
  timers?: Timers;
  ownerId?: string;
  /** Serializes notification SDK mutation across same-origin tabs. */
  mutationMutex?: RetentionMutationMutex;
  mark(): number;
  sinceMark(mark: number): number;
  onResult?(result: ScheduleResult): void;
}

export interface RetentionMutationMutex {
  /** False when exclusive ownership cannot be established; the coordinator must not mutate. */
  exclusive?: boolean;
  run<T>(fn: () => Promise<T>): Promise<T>;
}

interface BrowserLocks {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: (lock: unknown) => Promise<T> | T,
  ): Promise<T>;
}

export interface RetentionMutexOptions {
  locks?: BrowserLocks | null;
  tabBus?: TabBus | null;
  now?: () => number;
  timers?: Timers;
  ownerId?: string;
}

/**
 * A second, short-lived exclusive section for external notification mutation. Leadership decides
 * who may request work; this lock makes a stolen leader wait for an old non-cancellable SDK call
 * so the newly elected writer's replacement lands last. Without Web Locks, a BroadcastChannel
 * lease is used; if that is also unavailable, `exclusive` is false and callers must not mutate.
 */
export function createRetentionMutationMutex(
  name: string,
  options: RetentionMutexOptions = {},
): RetentionMutationMutex {
  const locks =
    options.locks === undefined
      ? ((globalThis as { navigator?: { locks?: BrowserLocks } }).navigator?.locks ?? null)
      : options.locks;
  if (locks)
    return {
      exclusive: true,
      run: <T>(fn: () => Promise<T>): Promise<T> =>
        locks.request(name, { mode: 'exclusive' }, () => fn()),
    };
  if (options.tabBus !== undefined || options.now) {
    if (!options.tabBus || !options.now)
      return {
        exclusive: false,
        run: async <T>(_fn: () => Promise<T>): Promise<T> => {
          throw new Error('retention mutation disabled: exclusive ownership unavailable');
        },
      };
    const lease = createTabLease({
      name,
      bus: options.tabBus,
      now: options.now,
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.ownerId ? { ownerId: `${options.ownerId}:mut` } : {}),
    });
    return {
      exclusive: true,
      async run<T>(fn: () => Promise<T>): Promise<T> {
        const held = await lease.acquire({ wait: true });
        if (!held) throw new Error('retention mutation lease was not acquired');
        try {
          return await fn();
        } finally {
          lease.release();
        }
      },
    };
  }
  return { exclusive: true, run: async <T>(fn: () => Promise<T>): Promise<T> => fn() };
}

export interface RetentionCoordinator {
  /** React Strict Mode may replay effect cleanup/setup with the same memoized coordinator. */
  activate(): void;
  /** Update lifecycle/identity state. Only the elected leader can reserve or mutate a plan. */
  reconcile(request: RetentionCoordinatorRequest): void;
  /** Resolves after all work accepted before this call has settled; useful for deterministic tests. */
  idle(): Promise<void>;
  /** Invalidates queued and future continuations. In-flight SDK calls cannot be cancelled. */
  destroy(): void;
}

/**
 * Serializes rolling-plan replacement for one tab. Each lifecycle, identity, or leader change
 * advances an epoch; after every non-cancellable SDK await, stale epochs stop before the next
 * mutation. The cursor is therefore reserved only by the current leader's accepted request.
 */
export function createRetentionCoordinator(
  options: RetentionCoordinatorOptions,
): RetentionCoordinator {
  let destroyed = false;
  let epoch = 0;
  let scheduled = false;
  let observedPlayer: string | null = null;
  let observedLeader = false;
  let hiddenMark: number | null = null;
  let lastRequest: RetentionCoordinatorRequest | null = null;
  let tail: Promise<void> = Promise.resolve();
  let stopLead: (() => void) | undefined;
  const fallback = options.leaderAvailable === false;
  const fallbackNow = options.now;
  const fallbackTimers = options.timers ?? realTimers();
  const fallbackBus: TabBus | null | undefined = fallback
    ? options.tabBus === undefined
      ? createBroadcastTabBus(`foundation:${options.gameId}:retention`)
      : options.tabBus
    : undefined;
  const makeLead = () =>
    fallback && fallbackBus && fallbackNow
      ? createTabLease({
          name: `foundation:${options.gameId}:retention:lead`,
          bus: fallbackBus,
          now: fallbackNow,
          timers: fallbackTimers,
          ...(options.ownerId ? { ownerId: `${options.ownerId}:lead` } : {}),
        })
      : null;
  let leadLease = makeLead();
  const mutationMutex =
    options.mutationMutex ??
    (fallback
      ? createRetentionMutationMutex(
          `foundation:${options.gameId}:retention:notification-mutation`,
          {
            tabBus: fallbackBus ?? null,
            ...(fallbackNow ? { now: fallbackNow } : {}),
            timers: fallbackTimers,
            ...(options.ownerId ? { ownerId: options.ownerId } : {}),
          },
        )
      : createRetentionMutationMutex(
          `foundation:${options.gameId}:retention:notification-mutation`,
        ));
  const exclusive = mutationMutex.exclusive !== false && (!fallback || leadLease !== null);
  const writer = (): boolean => (leadLease ? leadLease.isHeld() : options.isLeader());

  const attachLead = (): void => {
    stopLead?.();
    if (!leadLease) leadLease = makeLead();
    if (!leadLease) return;
    stopLead = leadLease.onChange(() => {
      if (!destroyed && lastRequest) reconcile(lastRequest);
    });
    void leadLease.acquire({ wait: true }).then(() => {
      if (!destroyed && lastRequest) reconcile(lastRequest);
    });
  };
  attachLead();

  const reset = (): void => {
    scheduled = false;
    observedPlayer = null;
    observedLeader = false;
    hiddenMark = null;
  };

  const reconcile = (request: RetentionCoordinatorRequest): void => {
    lastRequest = request;
    if (destroyed) return;
    const player = request.player;
    if (!request.booted || !player?.registered) {
      ++epoch;
      reset();
      return;
    }
    const leader = exclusive && writer();
    if (observedPlayer !== player.playerId || observedLeader !== leader) {
      ++epoch;
      scheduled = false;
      observedPlayer = player.playerId;
      observedLeader = leader;
      hiddenMark = null;
    }
    // A follower must neither reserve copy nor touch notifications. Resetting its local marker
    // makes a later "Play here" establish the plan under the new writer. Without exclusive
    // ownership (no Web Locks and no BroadcastChannel) every tab stays a follower.
    if (!leader) return;
    if (!request.visible) {
      if (hiddenMark === null) hiddenMark = options.mark();
      return;
    }
    const hiddenMs = hiddenMark === null ? null : options.sinceMark(hiddenMark);
    hiddenMark = null;
    if (!shouldRefreshRetention(scheduled, hiddenMs)) return;

    scheduled = true;
    const requestEpoch = ++epoch;
    const canContinue = (): boolean =>
      !destroyed && epoch === requestEpoch && exclusive && writer();
    const context = { progress: request.progress, playerId: player.playerId };
    const run = async (): Promise<void> => {
      let result: ScheduleResult | undefined;
      await mutationMutex.run(async () => {
        if (!canContinue()) return;
        const returnOrdinal = claimRetentionOrdinal(
          options.storage,
          options.gameId,
          context.playerId,
        );
        if (!canContinue()) return;
        result = await refreshRetentionPlan(
          options.notifications,
          { playerId: context.playerId, registered: true },
          options.buildVersion,
          options.assetReference,
          { progress: context.progress, returnOrdinal },
          canContinue,
        );
      });
      if (result && canContinue()) options.onResult?.(result);
    };
    // Keep the queue usable if an observer/storage implementation rejects unexpectedly.
    tail = tail.then(run, run);
  };

  return {
    activate() {
      if (!destroyed) return;
      destroyed = false;
      ++epoch;
      reset();
      attachLead();
    },
    reconcile,
    async idle() {
      await tail;
    },
    destroy() {
      destroyed = true;
      ++epoch;
      reset();
      stopLead?.();
      stopLead = undefined;
      leadLease?.destroy();
      leadLease = null;
    },
  };
}

export function shouldRefreshRetention(
  alreadyScheduled: boolean,
  hiddenMs: number | null,
): boolean {
  return !alreadyScheduled || (hiddenMs !== null && hiddenMs >= RETENTION_RETURN_MIN_MS);
}

export function buildRetentionPlan(input: RetentionPlanInput): LadderItem[] {
  const progressBucket = Math.max(0, Math.floor(input.progress / 25));
  const variantIndex = (progressBucket + Math.max(0, input.returnOrdinal)) % COPY.length;
  const variant = VARIANTS[variantIndex]!;
  return RETENTION_IDENTIFIERS.map((id, index) => {
    const day = index + 1;
    return {
      id,
      slot: `D${day}`,
      title: 'Template idle',
      body: COPY[variantIndex]![index]!,
      ctaText: 'Keep building',
      scheduledInDays: day,
      priority: day === 7 ? 'high' : 'medium',
      assetReference: input.assetReference,
      entryPayload: {
        source: 'retention_notification',
        notification_template: `template_return_d${day}_v2_${variant}`,
        notification_offset: `D${day}`,
        plan_version: 'template_retention_v2',
        build_version: input.buildVersion,
        progress_bucket: String(progressBucket),
        variant,
      },
    };
  });
}

/** Replace every stale D1-D7 slot on entry or a meaningful return. Failures remain observable. */
export async function refreshRetentionPlan(
  notifications: NotificationsProvider,
  player: Player | null,
  buildVersion: string,
  assetReference: string,
  context: Pick<RetentionPlanInput, 'progress' | 'returnOrdinal'>,
  shouldContinue: () => boolean = () => true,
): Promise<ScheduleResult> {
  if (!player?.registered || !shouldContinue()) return { scheduled: [], failed: [] };

  const failed: ScheduleResult['failed'] = [];
  for (const id of RETENTION_IDENTIFIERS) {
    if (!shouldContinue()) return { scheduled: [], failed };
    try {
      await notifications.unschedule(id);
    } catch (error) {
      failed.push({
        id,
        reason: `unschedule: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (!shouldContinue()) return { scheduled: [], failed };
  try {
    const scheduled = await notifications.scheduleLadder(
      buildRetentionPlan({ buildVersion, assetReference, ...context }),
    );
    return { scheduled: scheduled.scheduled, failed: [...failed, ...scheduled.failed] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      scheduled: [],
      failed: [
        ...failed,
        ...RETENTION_IDENTIFIERS.map((id) => ({ id, reason: `schedule: ${reason}` })),
      ],
    };
  }
}
