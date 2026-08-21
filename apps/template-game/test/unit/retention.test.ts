import { describe, expect, it, vi } from 'vitest';
import type { LadderItem, NotificationsProvider, Player, ScheduleResult } from '@foundation/client';
import {
  buildRetentionPlan,
  refreshRetentionPlan,
  RETENTION_IDENTIFIERS,
} from '../../src/retention.ts';

const registered: Player = { playerId: 'p1', registered: true };

describe('template Jest retention plan', () => {
  it('builds one attributed, ASCII-safe notification for every day D1-D7', () => {
    const plan = buildRetentionPlan('build-7', 'approved-return-asset');

    expect(plan).toHaveLength(7);
    expect(plan.map((item) => item.scheduledInDays)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan.map((item) => item.id)).toEqual(RETENTION_IDENTIFIERS);
    for (const item of plan) {
      expect(item.ctaText).toBeTruthy();
      expect(item.assetReference).toBe('approved-return-asset');
      expect(item.body.length).toBeLessThanOrEqual(100);
      expect(item.body).toMatch(/^[\x20-\x7E]+$/);
      expect(item.entryPayload).toMatchObject({
        source: 'retention_notification',
        build_version: 'build-7',
        plan_version: 'template_retention_v1',
      });
    }
  });

  it('schedules nothing for guests', async () => {
    const notifications = fakeNotifications();
    const result = await refreshRetentionPlan(
      notifications.provider,
      { playerId: 'guest', registered: false },
      'build-7',
      'asset',
    );

    expect(result).toEqual({ scheduled: [], failed: [] });
    expect(notifications.unschedule).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it('deterministically removes stale slots before scheduling the current registered plan', async () => {
    const notifications = fakeNotifications();
    const result = await refreshRetentionPlan(
      notifications.provider,
      registered,
      'build-7',
      'asset',
    );

    expect(notifications.unschedule.mock.calls.map(([id]) => id)).toEqual(RETENTION_IDENTIFIERS);
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
    expect(notifications.order.slice(0, 7)).toEqual(
      RETENTION_IDENTIFIERS.map((id) => `remove:${id}`),
    );
    expect(notifications.order[7]).toBe('schedule');
    expect(result.scheduled).toEqual(RETENTION_IDENTIFIERS);
  });

  it('keeps unschedule and schedule failures observable without crashing play', async () => {
    const notifications = fakeNotifications({ failUnschedule: RETENTION_IDENTIFIERS[1] });
    notifications.schedule.mockResolvedValueOnce({
      scheduled: [RETENTION_IDENTIFIERS[0]],
      failed: [{ id: RETENTION_IDENTIFIERS[2], reason: 'INVALID_ARGUMENTS' }],
    });

    await expect(
      refreshRetentionPlan(notifications.provider, registered, 'build-7', 'asset'),
    ).resolves.toEqual({
      scheduled: [RETENTION_IDENTIFIERS[0]],
      failed: [
        { id: RETENTION_IDENTIFIERS[1], reason: 'unschedule: blocked' },
        { id: RETENTION_IDENTIFIERS[2], reason: 'INVALID_ARGUMENTS' },
      ],
    });
  });
});

function fakeNotifications(options: { failUnschedule?: string } = {}) {
  const order: string[] = [];
  const unschedule = vi.fn(async (id: string) => {
    order.push(`remove:${id}`);
    if (id === options.failUnschedule) throw new Error('blocked');
  });
  const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => {
    order.push('schedule');
    return { scheduled: items.map((item) => item.id), failed: [] };
  });
  const provider: NotificationsProvider = {
    eligible: () => true,
    unschedule,
    scheduleLadder: schedule,
  };
  return { provider, order, unschedule, schedule };
}
