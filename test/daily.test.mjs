import { dayKey, applyDailyLogin } from '../src/systems/daily.js';
import { createNewPlayer } from '../src/systems/player.js';

// Daily login/free-pull boundaries remain UTC, independent of Contract Board days.
if (dayKey(Date.UTC(2026, 8, 22, 6, 30)) !== '2026-09-22') throw new Error('daily day must use UTC date');

const p0 = createNewPlayer();
const r1 = applyDailyLogin(p0, Date.parse('2026-09-18T12:00:00Z'));
if (!r1.isNewDay || r1.player.loginStreak !== 1) throw new Error('day1 streak');
if (!r1.player.dailyPullAvailable) throw new Error('pull should be available');

const r2 = applyDailyLogin(r1.player, Date.parse('2026-09-18T18:00:00Z'));
if (r2.isNewDay) throw new Error('same day should not re-bonus');

const r3 = applyDailyLogin(r1.player, Date.parse('2026-09-19T12:00:00Z'));
if (r3.player.loginStreak !== 2) throw new Error('streak 2 expected got ' + r3.player.loginStreak);

console.log('daily.test.mjs OK', dayKey());
