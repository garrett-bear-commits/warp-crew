import { dayKey, applyDailyLogin } from '../src/systems/daily.js';
import { contractDayKey } from '../src/systems/contracts.js';
import { createNewPlayer } from '../src/systems/player.js';

// Login, free hire and the Contract Board share one game day (local midnight; see game_day.test.mjs).
if (dayKey(Date.UTC(2026, 8, 22, 6, 30)) !== contractDayKey(Date.UTC(2026, 8, 22, 6, 30))) throw new Error('daily day must match the contract day');

const p0 = createNewPlayer();
const r1 = applyDailyLogin(p0, Date.parse('2026-09-18T12:00:00Z'));
if (!r1.isNewDay || r1.player.loginStreak !== 1) throw new Error('day1 streak');
if (!r1.player.dailyPullAvailable) throw new Error('pull should be available');

const r2 = applyDailyLogin(r1.player, Date.parse('2026-09-18T18:00:00Z'));
if (r2.isNewDay) throw new Error('same day should not re-bonus');

const r3 = applyDailyLogin(r1.player, Date.parse('2026-09-19T12:00:00Z'));
if (r3.player.loginStreak !== 2) throw new Error('streak 2 expected got ' + r3.player.loginStreak);

// Logging in pays nothing by itself: the login calendar (calendar.js) pays the day's square when claimed.
for (const streak of [1, 2, 7, 8]) {
  const before = { ...createNewPlayer(), loginStreak: streak - 1, lastLoginDay: dayKey(Date.parse('2026-09-18T12:00:00Z') - 86400000) };
  const res = applyDailyLogin(before, Date.parse('2026-09-18T12:00:00Z'));
  if (res.streak !== streak || res.player.loginStreak !== streak) throw new Error('streak ' + streak);
  if (JSON.stringify(res.player.wallet) !== JSON.stringify(before.wallet)) throw new Error('login must not touch the wallet on day ' + streak);
  if ('bonus' in res) throw new Error('login has no bonus');
}
if (applyDailyLogin(r1.player, Date.parse('2026-09-18T18:00:00Z')).player !== r1.player) throw new Error('same-day login is a no-op');

console.log('daily.test.mjs OK', dayKey());
