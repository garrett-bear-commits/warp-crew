// One game day for every daily reset, at the player's local midnight, and safe across DST.
// Regression for the 2026-10-09 deep dive: login/free hire/Commission turned over at UTC midnight
// while the contract board and siege damage turned over at local midnight.
process.env.TZ = 'America/Los_Angeles';
import assert from 'node:assert/strict';
const { dayKey, yesterdayKey, applyDailyLogin } = await import('../src/systems/daily.js');
const { contractDayKey } = await import('../src/systems/contracts.js');
const { localDayKey } = await import('../src/shared/time.js');
const { createNewPlayer } = await import('../src/systems/player.js');

// 06:30 UTC on Sep 22 is 23:30 on Sep 21 in Los Angeles: every reset still says Sep 21.
const lateEvening = Date.UTC(2026, 8, 22, 6, 30);
assert.equal(dayKey(lateEvening), '2026-09-21');
assert.equal(contractDayKey(lateEvening), '2026-09-21');
assert.equal(localDayKey(lateEvening), '2026-09-21');

// A login at 23:30 and another at 00:30 local are two days: the free hire comes back at local midnight.
const first = applyDailyLogin(createNewPlayer(), lateEvening);
assert.equal(first.isNewDay, true);
const afterMidnight = applyDailyLogin(first.player, lateEvening + 60 * 60 * 1000);
assert.equal(afterMidnight.isNewDay, true, 'local midnight starts a new game day');
assert.equal(afterMidnight.player.loginStreak, 2);
assert.equal(afterMidnight.player.dailyPullAvailable, true);

// DST: 2027-03-14 is 23 hours long in Los Angeles. At 00:30 on Mar 15, "24 hours ago" is Mar 13,
// but yesterday is Mar 14, so the streak must continue.
const dstMorning = Date.UTC(2027, 2, 15, 7, 30); // 00:30 PDT on Mar 15
assert.equal(dayKey(dstMorning), '2027-03-15');
assert.equal(yesterdayKey(dstMorning), '2027-03-14');
const beforeDst = applyDailyLogin(createNewPlayer(), Date.UTC(2027, 2, 14, 20, 0)); // 13:00 PDT Mar 14
const acrossDst = applyDailyLogin(beforeDst.player, dstMorning);
assert.equal(acrossDst.player.loginStreak, 2, 'a streak survives the short DST day');

// Captains are chosen once and never come out of a hire.
const { RECRUIT_POOL, pullMerc } = await import('../src/systems/gacha.js');
const { STARTER_CAPTAINS } = await import('../src/data/crewRoster.js');
assert.ok(RECRUIT_POOL.length > 0);
assert.ok(RECRUIT_POOL.every(t => !STARTER_CAPTAINS.includes(t.id)), 'no captain template in the hire pool');
let seed = 7;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 3000; i += 1) {
  const { template } = pullMerc({ rng, guaranteedRarity: 'common' });
  assert.ok(!STARTER_CAPTAINS.includes(template.id), `pull ${i} returned a captain`);
}

console.log('game_day.test.mjs OK');
