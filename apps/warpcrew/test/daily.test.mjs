import { dayKey, applyDailyLogin, loginBonusLine } from '../src/systems/daily.js';
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

// The login log line is a readable sentence, never raw JSON.
if (loginBonusLine({ gems: 15, credits: 150, medals: 15, reputation: 5, streak: 7 }) !== 'Day 7 login: +15 gems, +150 credits, +15 medals, +5 reputation.') throw new Error('day 7 login line');
if (loginBonusLine({ credits: 40, medals: 8, streak: 3 }) !== 'Day 3 login: +40 credits, +8 medals.') throw new Error('day 3 login line');
if (loginBonusLine({ credits: 80, fuel: 1, streak: 4 }) !== 'Day 4 login: +80 credits, +1 fuel.') throw new Error('day 4 login line');
for (const streak of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const line = loginBonusLine(applyDailyLogin({ ...createNewPlayer(), loginStreak: streak - 1, lastLoginDay: dayKey(Date.parse('2026-09-18T12:00:00Z') - 86400000) }, Date.parse('2026-09-18T12:00:00Z')).bonus);
  if (/[{}"]/.test(line) || !line.startsWith(`Day ${streak} login: +`)) throw new Error('login line must read as a sentence: ' + line);
}

console.log('daily.test.mjs OK', dayKey());
