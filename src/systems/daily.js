// @ts-nocheck
/** Calendar-day helpers for login streak + daily free gacha reset */

export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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

  dailyPullAvailable = true;

  // 7-day cycle — day 7 is the big retention hit
  const rewardTable = {
    1: { credits: 40, medals: 2 },
    2: { credits: 55 },
    3: { medals: 8, credits: 40 },
    4: { credits: 80, fuel: 1 },
    5: { medals: 12, credits: 60 },
    6: { credits: 100, reputation: 2 },
    7: { gems: 15, credits: 150, medals: 15, reputation: 5 },
  };
  const dayReward = rewardTable[((loginStreak - 1) % 7) + 1] || { credits: 40 };
  bonus = { ...dayReward, streak: loginStreak };

  const wallet = { ...player.wallet };
  for (const [k, v] of Object.entries(dayReward)) {
    if (k === 'fuel') {
      wallet.fuel = Math.min(
        player.fuelMax || 10,
        (wallet.fuel || 0) + v
      );
    } else {
      wallet[k] = (wallet[k] || 0) + v;
    }
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
