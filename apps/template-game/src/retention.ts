// Registered-player rolling return plan for the template. Jest delivers notifications on a fuzzy
// schedule and may choose at most one per user/day across games, so copy never promises an exact
// time. The configured asset reference must be uploaded and approved in the Developer Console.
import type {
  LadderItem,
  NotificationsProvider,
  Player,
  ScheduleResult,
  StorageTier,
} from '@foundation/client';

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
): Promise<ScheduleResult> {
  if (!player?.registered) return { scheduled: [], failed: [] };

  const failed: ScheduleResult['failed'] = [];
  for (const id of RETENTION_IDENTIFIERS) {
    try {
      await notifications.unschedule(id);
    } catch (error) {
      failed.push({
        id,
        reason: `unschedule: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

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
