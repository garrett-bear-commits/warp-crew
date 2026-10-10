// @ts-nocheck
/** Calendar-day helpers for the login streak and the daily free hire. Login rewards come from the 28-day calendar (calendar.js). */

import { trustedNow, localDayKey } from '../shared/time.js';

/** The game day (local calendar date); see localDayKey. */
export function dayKey(now = trustedNow()) {
  return localDayKey(now);
}

/** The calendar day before today, by date rather than 24 hours back (safe across DST). */
export function yesterdayKey(now = trustedNow()) {
  return localDayKey(now, -1);
}

/**
 * Apply the daily login: the streak (kept for analytics) and the free hire reset. It pays nothing itself: the
 * day's reward is the login calendar's square (calendar.js), claimed from its sheet.
 * Call once on boot after load.
 */
export function applyDailyLogin(player, now = trustedNow()) {
  const today = dayKey(now);
  const last = player.lastLoginDay;
  let loginStreak = player.loginStreak || 0;
  let dailyPullAvailable = player.dailyPullAvailable;

  // Only a later game day is a new day: a clock set back to an earlier day never resets the free hire.
  if (last && today <= last) {
    return { player, isNewDay: false, streak: loginStreak };
  }

  if (last === yesterdayKey(now)) {
    loginStreak = Math.min(30, loginStreak + 1);
  } else {
    loginStreak = 1;
  }

  dailyPullAvailable = true;

  return {
    player: {
      ...player,
      lastLoginDay: today,
      loginStreak,
      dailyPullAvailable,
    },
    isNewDay: true,
    streak: loginStreak,
  };
}
