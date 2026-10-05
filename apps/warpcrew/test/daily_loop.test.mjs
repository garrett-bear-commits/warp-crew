import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { ensureDailyLoop, markDailyMilestone, dailyPlan } from '../src/systems/dailyLoop.js';

// Catches wrong milestone order, duplicate writes, missing completion/reset, and rewards from guidance.
const now = Date.UTC(2026, 8, 21, 12);
let player = ensureDailyLoop(createNewPlayer(), now);
const wallet = { ...player.wallet };
assert.equal(dailyPlan(player, now).next.id, 'contract');
assert.equal(dailyPlan(player, now).completed, 0);
player = markDailyMilestone(player, 'contract', now);
assert.equal(markDailyMilestone(player, 'contract', now), player);
assert.equal(dailyPlan(player, now).next.id, 'improve');
player = markDailyMilestone(player, 'improve', now);
player = markDailyMilestone(player, 'away', now);
assert.equal(dailyPlan(player, now).next, null);
assert.equal(dailyPlan(player, now).completed, 3);
assert.equal(dailyPlan(player, now).total, 3);
assert.deepEqual(player.wallet, wallet);
assert.equal(dailyPlan(ensureDailyLoop(player, now + 86400000), now + 86400000).completed, 0);
assert.equal(dailyPlan(markDailyMilestone(player, 'invalid', now), now).completed, 3);
console.log('daily_loop.test.mjs OK');
