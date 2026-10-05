import { describe, expect, it, vi } from 'vitest';
import {
  createStorage,
  memoryStorage,
  type LadderItem,
  type NotificationsProvider,
  type Player,
  type ScheduleResult,
} from '@foundation/client';
import {
  buildRetentionPlan,
  claimRetentionOrdinal,
  createRetentionCoordinator,
  createRetentionMutationMutex,
  refreshRetentionPlan,
  shouldRefreshRetention,
  RETENTION_IDENTIFIERS,
  RETENTION_RETURN_MIN_MS,
} from '../../src/retention.ts';

const registered: Player = { playerId: 'p1', registered: true };

describe('template Jest retention plan', () => {
  it('builds one attributed, ASCII-safe notification for every day D1-D7', () => {
    const plan = buildRetentionPlan({
      buildVersion: 'build-7',
      assetReference: 'approved-return-asset',
      progress: 42,
      returnOrdinal: 0,
    });

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
        plan_version: 'template_retention_v2',
        progress_bucket: '1',
        variant: expect.stringMatching(/^[abc]$/),
      });
    }
  });

  it('rotates copy and attribution across meaningful returns and progress buckets', () => {
    const base = {
      buildVersion: 'build-7',
      assetReference: 'asset',
      progress: 0,
    };
    const first = buildRetentionPlan({ ...base, returnOrdinal: 0 });
    const returned = buildRetentionPlan({ ...base, returnOrdinal: 1 });
    const progressed = buildRetentionPlan({ ...base, progress: 50, returnOrdinal: 1 });

    expect(returned[0]!.body).not.toBe(first[0]!.body);
    expect(returned[0]!.entryPayload?.notification_template).not.toBe(
      first[0]!.entryPayload?.notification_template,
    );
    expect(progressed[0]!.body).not.toBe(returned[0]!.body);
  });

  it('refreshes initially and only after a meaningful hidden interval', () => {
    expect(shouldRefreshRetention(false, null)).toBe(true);
    expect(shouldRefreshRetention(true, RETENTION_RETURN_MIN_MS - 1)).toBe(false);
    expect(shouldRefreshRetention(true, RETENTION_RETURN_MIN_MS)).toBe(true);
  });

  it('persists the copy cursor per player so cold launches rotate instead of restarting at A', () => {
    const primary = memoryStorage();
    const firstLaunch = createStorage({ localStorage: primary });
    expect(claimRetentionOrdinal(firstLaunch, 'template', 'player-1')).toBe(0);

    const coldLaunch = createStorage({ localStorage: primary });
    expect(claimRetentionOrdinal(coldLaunch, 'template', 'player-1')).toBe(1);
    expect(claimRetentionOrdinal(coldLaunch, 'template', 'player-1')).toBe(2);
    expect(claimRetentionOrdinal(coldLaunch, 'template', 'player-1')).toBe(0);
    expect(claimRetentionOrdinal(coldLaunch, 'template', 'player-2')).toBe(0);
  });

  it('schedules nothing for guests', async () => {
    const notifications = fakeNotifications();
    const result = await refreshRetentionPlan(
      notifications.provider,
      { playerId: 'guest', registered: false },
      'build-7',
      'asset',
      { progress: 0, returnOrdinal: 0 },
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
      { progress: 0, returnOrdinal: 0 },
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
      refreshRetentionPlan(notifications.provider, registered, 'build-7', 'asset', {
        progress: 0,
        returnOrdinal: 0,
      }),
    ).resolves.toEqual({
      scheduled: [RETENTION_IDENTIFIERS[0]],
      failed: [
        { id: RETENTION_IDENTIFIERS[1], reason: 'unschedule: blocked' },
        { id: RETENTION_IDENTIFIERS[2], reason: 'INVALID_ARGUMENTS' },
      ],
    });
  });

  it('leaves notification mutation and the copy cursor to the elected leader', async () => {
    const notifications = fakeNotifications();
    const storage = createStorage({ localStorage: memoryStorage() });
    let leader = false;
    const coordinator = createRetentionCoordinator({
      notifications: notifications.provider,
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => leader,
      mark: () => 0,
      sinceMark: () => 0,
    });

    coordinator.reconcile({
      booted: true,
      player: registered,
      visible: true,
      progress: 0,
    });
    await coordinator.idle();

    expect(notifications.unschedule).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(storage.get('foundation:template:retention:v2:p1')).toBeNull();

    leader = true;
    coordinator.reconcile({
      booted: true,
      player: registered,
      visible: true,
      progress: 0,
    });
    await coordinator.idle();

    expect(notifications.unschedule).toHaveBeenCalledTimes(7);
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
    expect(storage.get('foundation:template:retention:v2:p1')).toBe('1');
  });

  it('serializes an identity change so stale account A cannot schedule after account B', async () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    let releaseFirstUnschedule: (() => void) | undefined;
    let firstUnscheduleStarted: (() => void) | undefined;
    const firstUnschedule = new Promise<void>((resolve) => {
      releaseFirstUnschedule = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstUnscheduleStarted = resolve;
    });
    const unschedule = vi.fn(async (id: string) => {
      if (id === RETENTION_IDENTIFIERS[0]) {
        firstUnscheduleStarted?.();
        await firstUnschedule;
      }
    });
    const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => ({
      scheduled: items.map((item) => item.id),
      failed: [],
    }));
    const coordinator = createRetentionCoordinator({
      notifications: { eligible: () => true, unschedule, scheduleLadder: schedule },
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      mark: () => 0,
      sinceMark: () => 0,
    });

    coordinator.reconcile({
      booted: true,
      player: { playerId: 'account-a', registered: true },
      visible: true,
      progress: 0,
    });
    await firstStarted;
    coordinator.reconcile({
      booted: true,
      player: { playerId: 'account-b', registered: true },
      visible: true,
      progress: 50,
    });
    releaseFirstUnschedule?.();
    await coordinator.idle();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]![0][0]!.entryPayload).toMatchObject({
      progress_bucket: '2',
      variant: 'c',
    });
    expect(storage.get('foundation:template:retention:v2:account-a')).toBe('1');
    expect(storage.get('foundation:template:retention:v2:account-b')).toBe('1');
  });

  it('lets only the new leader finish a delayed two-tab plan replacement', async () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    let aLeads = true;
    let bLeads = false;
    let holdFirst = true;
    let releaseFirstUnschedule: (() => void) | undefined;
    let firstUnscheduleStarted: (() => void) | undefined;
    const firstUnschedule = new Promise<void>((resolve) => {
      releaseFirstUnschedule = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstUnscheduleStarted = resolve;
    });
    const unschedule = vi.fn(async (id: string) => {
      if (id === RETENTION_IDENTIFIERS[0] && holdFirst) {
        holdFirst = false;
        firstUnscheduleStarted?.();
        await firstUnschedule;
      }
    });
    const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => ({
      scheduled: items.map((item) => item.id),
      failed: [],
    }));
    const base = {
      notifications: { eligible: () => true, unschedule, scheduleLadder: schedule },
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      mark: () => 0,
      sinceMark: () => 0,
    };
    const tabA = createRetentionCoordinator({ ...base, isLeader: () => aLeads });
    const tabB = createRetentionCoordinator({ ...base, isLeader: () => bLeads });

    tabA.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    tabB.reconcile({ booted: true, player: registered, visible: true, progress: 25 });
    await firstStarted;

    aLeads = false;
    bLeads = true;
    tabA.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    tabB.reconcile({ booted: true, player: registered, visible: true, progress: 25 });
    releaseFirstUnschedule?.();
    await Promise.all([tabA.idle(), tabB.idle()]);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]![0][0]!.entryPayload).toMatchObject({
      progress_bucket: '1',
      variant: 'c',
    });
    expect(unschedule).toHaveBeenCalledTimes(8);
  });

  it('stops after an in-flight SDK call when the provider is destroyed', async () => {
    let releaseFirstUnschedule: (() => void) | undefined;
    let firstUnscheduleStarted: (() => void) | undefined;
    const firstUnschedule = new Promise<void>((resolve) => {
      releaseFirstUnschedule = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstUnscheduleStarted = resolve;
    });
    const unschedule = vi.fn(async (id: string) => {
      if (id === RETENTION_IDENTIFIERS[0]) {
        firstUnscheduleStarted?.();
        await firstUnschedule;
      }
    });
    const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => ({
      scheduled: items.map((item) => item.id),
      failed: [],
    }));
    const coordinator = createRetentionCoordinator({
      notifications: { eligible: () => true, unschedule, scheduleLadder: schedule },
      storage: createStorage({ localStorage: memoryStorage() }),
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      mark: () => 0,
      sinceMark: () => 0,
    });

    coordinator.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    await firstStarted;
    coordinator.destroy();
    releaseFirstUnschedule?.();
    await coordinator.idle();

    expect(unschedule).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('reactivates cleanly after React Strict Mode replays effect cleanup and setup', async () => {
    const notifications = fakeNotifications();
    const coordinator = createRetentionCoordinator({
      notifications: notifications.provider,
      storage: createStorage({ localStorage: memoryStorage() }),
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      mark: () => 0,
      sinceMark: () => 0,
    });

    coordinator.destroy();
    coordinator.activate();
    coordinator.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    await coordinator.idle();

    expect(notifications.unschedule).toHaveBeenCalledTimes(7);
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
  });

  it('does not abandon a startup replacement on a short hide/show', async () => {
    let releaseFirstUnschedule: (() => void) | undefined;
    let firstUnscheduleStarted: (() => void) | undefined;
    const firstUnschedule = new Promise<void>((resolve) => {
      releaseFirstUnschedule = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstUnscheduleStarted = resolve;
    });
    const unschedule = vi.fn(async (id: string) => {
      if (id === RETENTION_IDENTIFIERS[0]) {
        firstUnscheduleStarted?.();
        await firstUnschedule;
      }
    });
    const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => ({
      scheduled: items.map((item) => item.id),
      failed: [],
    }));
    const coordinator = createRetentionCoordinator({
      notifications: { eligible: () => true, unschedule, scheduleLadder: schedule },
      storage: createStorage({ localStorage: memoryStorage() }),
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      mark: () => 1,
      sinceMark: () => 1,
    });

    coordinator.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    await firstStarted;
    coordinator.reconcile({ booted: true, player: registered, visible: false, progress: 0 });
    coordinator.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    releaseFirstUnschedule?.();
    await coordinator.idle();

    expect(unschedule).toHaveBeenCalledTimes(7);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("waits for a former leader's delayed bulk schedule before the new leader replaces it", async () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    const mutationMutex = fakeMutationMutex();
    let aLeads = true;
    let bLeads = false;
    let releaseFirstSchedule: (() => void) | undefined;
    let firstScheduleStarted: (() => void) | undefined;
    const firstSchedule = new Promise<void>((resolve) => {
      releaseFirstSchedule = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstScheduleStarted = resolve;
    });
    const completed: string[] = [];
    let scheduleCalls = 0;
    const schedule = vi.fn(async (items: LadderItem[]): Promise<ScheduleResult> => {
      const variant = String(items[0]!.entryPayload?.variant);
      if (++scheduleCalls === 1) {
        firstScheduleStarted?.();
        await firstSchedule;
      }
      completed.push(variant);
      return { scheduled: items.map((item) => item.id), failed: [] };
    });
    const base = {
      notifications: {
        eligible: () => true,
        unschedule: vi.fn(async () => undefined),
        scheduleLadder: schedule,
      },
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      mutationMutex,
      mark: () => 0,
      sinceMark: () => 0,
    };
    const tabA = createRetentionCoordinator({ ...base, isLeader: () => aLeads });
    const tabB = createRetentionCoordinator({ ...base, isLeader: () => bLeads });

    tabA.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    await firstStarted;
    aLeads = false;
    bLeads = true;
    tabA.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    tabB.reconcile({ booted: true, player: registered, visible: true, progress: 25 });
    releaseFirstSchedule?.();
    await Promise.all([tabA.idle(), tabB.idle()]);

    expect(completed).toEqual(['a', 'c']);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('two no-Web-Locks coordinators never mutate or reserve a cursor', async () => {
    const storage = createStorage({ localStorage: memoryStorage() });
    const notifications = fakeNotifications();
    const base = {
      notifications: notifications.provider,
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      leaderAvailable: false as const,
      mark: () => 0,
      sinceMark: () => 0,
    };
    const tabA = createRetentionCoordinator(base);
    const tabB = createRetentionCoordinator(base);
    const request = { booted: true, player: registered, visible: true, progress: 0 };
    tabA.reconcile(request);
    tabB.reconcile(request);
    await Promise.all([tabA.idle(), tabB.idle()]);
    expect(notifications.unschedule).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(storage.get('foundation:template:retention:v2:p1')).toBeNull();
  });

  it('does not mutate when exclusive ownership cannot be established', async () => {
    const notifications = fakeNotifications();
    const storage = createStorage({ localStorage: memoryStorage() });
    const coordinator = createRetentionCoordinator({
      notifications: notifications.provider,
      storage,
      gameId: 'template',
      buildVersion: 'build-7',
      assetReference: 'asset',
      isLeader: () => true,
      leaderAvailable: false,
      mark: () => 0,
      sinceMark: () => 0,
    });
    coordinator.reconcile({ booted: true, player: registered, visible: true, progress: 0 });
    await coordinator.idle();
    expect(notifications.unschedule).not.toHaveBeenCalled();
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(storage.get('foundation:template:retention:v2:p1')).toBeNull();
  });

  it('queues overlapping mutationMutex.run calls for the whole critical section', async () => {
    const mutex = createRetentionMutationMutex('retention-queue', { locks: null });
    let inFlight = 0;
    let maxInFlight = 0;
    const work = async (): Promise<void> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    };
    await Promise.all([mutex.run(work), mutex.run(work)]);
    expect(maxInFlight).toBe(1);
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

function fakeMutationMutex() {
  let tail = Promise.resolve();
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const before = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      try {
        return await fn();
      } finally {
        release?.();
      }
    },
  };
}
