/**
 * Retention notification ladder for Warp Crew.
 * Schedules via Jest RCS/SMS when on platform; logs locally otherwise.
 *
 * Identifiers (stable for reschedule/unschedule):
 *  - wc_fuel_full
 *  - wc_expedition_done
 *  - wc_daily_pull
 *  - wc_comeback_d1 / d3
 */

import {
  scheduleNotification,
  unscheduleNotification,
  isReal,
} from '../shared/platform.js';
import { fuelStatus } from './fuel.js';
import { MS_PER_HOUR } from '../shared/timer.js';

export const NOTIF_IDS = {
  fuelFull: 'wc_fuel_full',
  expeditionDone: 'wc_expedition_done',
  dailyPull: 'wc_daily_pull',
  comebackD1: 'wc_comeback_d1',
  comebackD3: 'wc_comeback_d3',
};

async function safeSchedule(opts) {
  try {
    await scheduleNotification(opts);
  } catch (e) {
    console.warn('[notifications] schedule failed', opts.identifier, e);
  }
}

async function safeUnschedule(id) {
  try {
    await unscheduleNotification(id);
  } catch (e) {
    console.warn('[notifications] unschedule failed', id, e);
  }
}

/** Call whenever fuel state changes or on boot after claim. */
export async function syncFuelFullNotification(player, now = Date.now()) {
  const st = fuelStatus(player, now);
  await safeUnschedule(NOTIF_IDS.fuelFull);
  if (st.isFull || st.current >= st.max) return;

  // Exact schedule when we expect tank full
  const unitsNeeded = st.max - st.current;
  const rate = st.ratePerHour || 1;
  const msUntilFull = (unitsNeeded / rate) * MS_PER_HOUR;
  // Clamp to Jest exact window (~7 days); fuel full is hours
  const scheduledAt = new Date(now + Math.max(60_000, Math.min(msUntilFull, 6.5 * 24 * MS_PER_HOUR)));

  await safeSchedule({
    identifier: NOTIF_IDS.fuelFull,
    scheduledAt,
    priority: 'high',
    body: 'Fuel tanks are full, Captain. The Spur is waiting.',
    ctaText: 'Launch',
    entryPayload: {
      notification_type: 'fuel_full',
      notification_template: 'wc_fuel_full_v1',
    },
  });
}

/** Call when launching or resolving an expedition. */
export async function syncExpeditionNotification(player, now = Date.now()) {
  await safeUnschedule(NOTIF_IDS.expeditionDone);
  const job = player.activeExpedition;
  if (!job || !job.endAt) return;

  const scheduledAt = new Date(Math.max(now + 30_000, job.endAt));
  await safeSchedule({
    identifier: NOTIF_IDS.expeditionDone,
    scheduledAt,
    priority: 'high',
    body: 'Away team has returned. Claim their haul on the bridge.',
    ctaText: 'Claim',
    entryPayload: {
      notification_type: 'expedition_done',
      planetId: job.payload?.planetId,
      notification_template: 'wc_expedition_done_v1',
    },
  });
}

/** Daily free merc pull reminder — fuzzy next day if used, else skip. */
export async function syncDailyPullNotification(player) {
  await safeUnschedule(NOTIF_IDS.dailyPull);
  if (player.dailyPullAvailable) return; // already ready — no nag

  await safeSchedule({
    identifier: NOTIF_IDS.dailyPull,
    scheduledInDays: 1,
    priority: 'medium',
    body: 'New mercenary contracts just hit the board. Free hire ready.',
    ctaText: 'Hire',
    entryPayload: {
      notification_type: 'daily_pull',
      notification_template: 'wc_daily_pull_v1',
    },
  });
}

/** Soft comeback series for registered players. */
export async function syncComebackSeries(player) {
  await safeUnschedule(NOTIF_IDS.comebackD1);
  await safeUnschedule(NOTIF_IDS.comebackD3);

  // Only meaningful on real Jest for registered users
  const reg = player?._jestRegistered;
  if (reg === false) return;

  await safeSchedule({
    identifier: NOTIF_IDS.comebackD1,
    scheduledInDays: 1,
    priority: 'medium',
    body: 'Trade routes shifted overnight. Credits are waiting on Spur Anchor.',
    ctaText: 'Open Warp Crew',
    entryPayload: {
      notification_type: 'comeback',
      notification_template: 'wc_comeback_d1_v1',
      notification_offset: 'D1',
    },
  });
  await safeSchedule({
    identifier: NOTIF_IDS.comebackD3,
    scheduledInDays: 3,
    priority: 'low',
    body: 'Eclipse Swarm chatter on the outer lanes. Your crew could use you.',
    ctaText: 'Return',
    entryPayload: {
      notification_type: 'comeback',
      notification_template: 'wc_comeback_d3_v1',
      notification_offset: 'D3',
    },
  });
}

/** Full resync — call on boot and after major state changes. */
export async function syncAllNotifications(player, now = Date.now()) {
  await syncFuelFullNotification(player, now);
  await syncExpeditionNotification(player, now);
  await syncDailyPullNotification(player);
  await syncComebackSeries(player);
  if (!isReal()) {
    // Quiet in local dev
  }
}
