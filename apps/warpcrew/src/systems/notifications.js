// @ts-nocheck
/**
 * Retention notification ladder for Warp Crew.
 * Schedules via Jest RCS/SMS when on platform; logs locally otherwise.
 *
 * Identifiers (stable for reschedule/unschedule):
 *  - wc_fuel_full
 *  - wc_expedition_done
 *  - wc_daily_pull
 *  - wc_comeback_d1 / d3
 *  - wc_hold_full (income while away; skipped on a day another timed notice already lands, see holdFullAt)
 */

import { trustedNow } from '../shared/time.js';
import {
  scheduleNotification,
  unscheduleNotification,
  isReal,
} from '../shared/platform.js';
import { fuelStatus } from './fuel.js';
import { MS_PER_HOUR } from '../shared/timer.js';
import { idleHaul, idleRates } from './idle.js';
import { dayKey } from './daily.js';
import { isTutorialActive } from './tutorial.js';

export const NOTIF_IDS = {
  fuelFull: 'wc_fuel_full',
  expeditionDone: 'wc_expedition_done',
  dailyPull: 'wc_daily_pull',
  comebackD1: 'wc_comeback_d1',
  comebackD3: 'wc_comeback_d3',
  shipBuildDone: 'wc_ship_build_done',
  holdFull: 'wc_hold_full',
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

/** When the tank will be full (ms), or null when it already is. Clamped to Jest's exact window (~7 days). */
export function fuelFullAt(player, now = trustedNow()) {
  const st = fuelStatus(player, now);
  if (st.isFull || st.current >= st.max) return null;
  const unitsNeeded = st.max - st.current;
  const rate = st.ratePerHour || 1;
  const msUntilFull = (unitsNeeded / rate) * MS_PER_HOUR;
  return now + Math.max(60_000, Math.min(msUntilFull, 6.5 * 24 * MS_PER_HOUR));
}

/** Daytime hours (local) a "Hold full" text may arrive in. */
export const HOLD_NOTICE_HOURS = { from: 8, to: 21 };

/**
 * When the hold fills (ms), or null: no clock yet, nobody earning, already full, it fills after today (tomorrow
 * already has the comeback and daily-hire texts), it fills at night, or another timed notice (fuel full, away team
 * back, drydock done) lands the same game day. So it never adds a second message to a day.
 */
export function holdFullAt(player, now = trustedNow()) {
  if (isTutorialActive(player) || !player?.idle) return null;
  const haul = idleHaul(player, now);
  if (haul.full) return null;
  const rates = idleRates(player, now);
  if (!rates.credits && !rates.medals) return null;
  const at = Math.max(now + 60_000, Number(player.idle.since) + haul.capHours * MS_PER_HOUR);
  if (dayKey(at) !== dayKey(now)) return null;
  const hour = new Date(at).getHours();
  if (hour < HOLD_NOTICE_HOURS.from || hour >= HOLD_NOTICE_HOURS.to) return null;
  const others = [fuelFullAt(player, now), player.activeExpedition?.endAt, player.shipBuild?.endAt].filter(Number.isFinite);
  if (others.some(t => dayKey(t) === dayKey(at))) return null;
  return at;
}

/** Call whenever fuel state changes or on boot after claim. */
export async function syncFuelFullNotification(player, now = trustedNow()) {
  await safeUnschedule(NOTIF_IDS.fuelFull);
  const fullAt = fuelFullAt(player, now);
  if (!fullAt) return;
  const scheduledAt = new Date(fullAt);

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
export async function syncExpeditionNotification(player, now = trustedNow()) {
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

/** Drydock builds: tell the captain when the upgrade is online. */
export async function syncShipBuildNotification(player, now = trustedNow()) {
  await safeUnschedule(NOTIF_IDS.shipBuildDone);
  const build = player.shipBuild;
  if (!build?.endAt) return;
  await safeSchedule({
    identifier: NOTIF_IDS.shipBuildDone,
    scheduledAt: new Date(Math.max(now + 30_000, build.endAt)),
    priority: 'medium',
    body: 'Drydock reports the upgrade is online. Your Sparrow is stronger.',
    ctaText: 'Inspect',
    entryPayload: { notification_type: 'ship_build_done', system: build.system, notification_template: 'wc_ship_build_done_v1' },
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

/** The hold is full: income stops until the captain collects it. */
export async function syncHoldFullNotification(player, now = trustedNow()) {
  await safeUnschedule(NOTIF_IDS.holdFull);
  const at = holdFullAt(player, now);
  if (!at) return;
  await safeSchedule({
    identifier: NOTIF_IDS.holdFull,
    scheduledAt: new Date(at),
    priority: 'medium',
    body: 'The hold is full, Captain. Your crew has credits waiting.',
    ctaText: 'Collect',
    entryPayload: { notification_type: 'hold_full', notification_template: 'wc_hold_full_v1' },
  });
}

/** Full resync — call on boot and after major state changes. */
export async function syncAllNotifications(player, now = trustedNow()) {
  await syncFuelFullNotification(player, now);
  await syncExpeditionNotification(player, now);
  await syncShipBuildNotification(player, now);
  await syncHoldFullNotification(player, now);
  await syncDailyPullNotification(player);
  await syncComebackSeries(player);
  if (!isReal()) {
    // Quiet in local dev
  }
}
