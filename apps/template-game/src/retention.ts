// Registered-player rolling return plan for the template. Jest delivers notifications on a fuzzy
// schedule and may choose at most one per user/day across games, so copy never promises an exact
// time. The configured asset reference must be uploaded and approved in the Developer Console.
import type { LadderItem, NotificationsProvider, Player, ScheduleResult } from '@foundation/client';

export const RETENTION_IDENTIFIERS = [
  'template:return:d1',
  'template:return:d2',
  'template:return:d3',
  'template:return:d4',
  'template:return:d5',
  'template:return:d6',
  'template:return:d7',
] as const;

const COPY = [
  'Your next upgrade is waiting.',
  'A quick visit can move your counter forward.',
  'Your idle workshop is ready for another step.',
  'Come back and choose the next upgrade.',
  'Your progress is safe. Add another boost when ready.',
  'A new run can push your workshop further.',
  'Your week-old workshop is ready for you.',
] as const;

export function buildRetentionPlan(buildVersion: string, assetReference: string): LadderItem[] {
  return RETENTION_IDENTIFIERS.map((id, index) => {
    const day = index + 1;
    return {
      id,
      slot: `D${day}`,
      title: 'Template idle',
      body: COPY[index]!,
      ctaText: 'Keep building',
      scheduledInDays: day,
      priority: day === 7 ? 'high' : 'medium',
      assetReference,
      entryPayload: {
        source: 'retention_notification',
        notification_template: `template_return_d${day}_v1`,
        notification_offset: `D${day}`,
        plan_version: 'template_retention_v1',
        build_version: buildVersion,
      },
    };
  });
}

/** Replace every stale D1-D7 slot on entry/return. Failures stay observable and never block play. */
export async function refreshRetentionPlan(
  notifications: NotificationsProvider,
  player: Player | null,
  buildVersion: string,
  assetReference: string,
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
      buildRetentionPlan(buildVersion, assetReference),
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
