/** Calendar-day helpers for login streak + daily free gacha reset */

export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yesterdayKey(now = Date.now()) {
  return dayKey(now - 86400000);
}

/**
 * Apply daily login + free pull reset.
 * Call once on boot after load.
 */
export function applyDailyLogin(player, now = Date.now()) {
  const today = dayKey(now);
  const last = player.lastLoginDay;
  let loginStreak = player.loginStreak || 0;
  let dailyPullAvailable = player.dailyPullAvailable;
  let bonus = null;

  if (last === today) {
    return { player, isNewDay: false, bonus: null };
  }

  if (last === yesterdayKey(now)) {
    loginStreak = Math.min(30, loginStreak + 1);
  } else {
    loginStreak = 1;
  }

  // New calendar day: free pull resets
  dailyPullAvailable = true;

  // Light streak rewards (credits/medals) — keeps retention without breaking economy
  const rewardTable = {
    1: { credits: 25 },
    2: { credits: 40 },
    3: { medals: 5 },
    4: { credits: 60 },
    5: { medals: 8, credits: 40 },
    6: { credits: 80 },
    7: { gems: 10, credits: 100, medals: 10 },
  };
  const dayReward = rewardTable[((loginStreak - 1) % 7) + 1] || { credits: 30 };
  bonus = { ...dayReward, streak: loginStreak };

  const wallet = { ...player.wallet };
  for (const [k, v] of Object.entries(dayReward)) {
    wallet[k] = (wallet[k] || 0) + v;
  }

  return {
    player: {
      ...player,
      lastLoginDay: today,
      loginStreak,
      dailyPullAvailable,
      wallet,
    },
    isNewDay: true,
    bonus,
  };
}
