// Achievements (Phase 2 design §5): progress read from the save, tiers claimed once, gems under a lifetime budget.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, ACHIEVEMENT_TRACKS, ACHIEVEMENT_GEM_BUDGET, achievementGemTotal, achievementProgress, claimAchievement,
  claimableAchievements, normalizeAchievements } from '../src/systems/achievements.js';
import { sessionAction } from '../src/systems/sessionLoop.js';
import { isWarpcrewPlayer } from '../src/core/progress.js';
import { renderAchievements, renderNav } from '../src/ui/bridge.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';

// Shape: six tracks, every line three rising goals, a badge for every track, gems within the budget.
assert.deepEqual(ACHIEVEMENT_TRACKS.map(t => t.id), ['combat', 'crew', 'ship', 'explore', 'walls', 'collection']);
// Twelve lines (the Archivist joined in Phase 3), three tiers each.
assert.equal(ACHIEVEMENTS.reduce((n, line) => n + line.tiers.length, 0), 36);
for (const line of ACHIEVEMENTS) {
  assert.ok(ACHIEVEMENT_TRACKS.some(t => t.id === line.track), `${line.id} track`);
  assert.ok(line.tiers.every((tier, i) => i === 0 || tier.goal > line.tiers[i - 1].goal), `${line.id} goals rise`);
  assert.ok(existsSync(new URL(`../public/art/pixel/ui/ach-${line.track}.png`, import.meta.url)), `${line.track} badge art`);
}
assert.ok(achievementGemTotal() <= ACHIEVEMENT_GEM_BUDGET, `all tiers pay ${achievementGemTotal()} gems, budget ${ACHIEVEMENT_GEM_BUDGET}`);

// Progress comes from the save as it is; a new captain has nothing to claim.
const fresh = createNewPlayer({ tutorialScript: 5, now: 0, rng: () => 0.5 });
assert.equal(claimableAchievements(fresh), 0);
assert.equal(claimAchievement(fresh, 'victor').reason, 'achievement_not_ready');
assert.equal(claimAchievement(fresh, 'nope').reason, 'unknown_achievement');

// Ten wins: tier 1 of Victor is ready, pays once, and the next tier waits for 50.
let player = { ...fresh, stats: { ...fresh.stats, combatsWon: 12 } };
assert.equal(achievementProgress(player).find(l => l.id === 'victor').ready, true);
const first = claimAchievement(player, 'victor');
assert.ok(first.ok);
assert.equal(first.player.wallet.credits, player.wallet.credits + ACHIEVEMENT_BY_ID.victor.tiers[0].reward.credits);
assert.equal(first.player.wallet.medals, player.wallet.medals + 10);
assert.deepEqual(first.player.achievements, { victor: 1 });
assert.equal(claimAchievement(first.player, 'victor').reason, 'achievement_not_ready', 'a tier pays once');
player = { ...first.player, stats: { ...first.player.stats, combatsWon: 500 } };
const second = claimAchievement(player, 'victor');
const third = claimAchievement(second.player, 'victor');
assert.equal(third.player.wallet.gems, player.wallet.gems + 25 + 75);
assert.equal(claimAchievement(third.player, 'victor').reason, 'achievement_complete');

// The save: migrated and validated; an edited claim count is clamped on read and refused by the validator.
assert.deepEqual(migratePlayer(JSON.parse(JSON.stringify(third.player))).achievements, { victor: 3 });
assert.deepEqual(migratePlayer({ ...third.player, achievements: { victor: 99, 'bad key': 1, roster: 'x' } }).achievements, {});
assert.deepEqual(normalizeAchievements({ victor: 7, made_up: 2 }), { victor: 3 });
assert.equal(isWarpcrewPlayer({ ...third.player, achievements: { victor: 3 } }), true);
assert.equal(isWarpcrewPlayer({ ...third.player, achievements: { victor: 40 } }), false);
assert.equal(isWarpcrewPlayer({ ...third.player, achievements: [1] }), false);

// Claimed through the session (the engine path): it raises a reward reveal effect, and not during the tutorial.
const done = completeFreshTutorial();
const veteran = { ...done, stats: { ...done.stats, combatsWon: 10 } };
const claimed = sessionAction(veteran, {}, 'achievement-claim', { id: 'victor' }, { now: Date.UTC(2026, 9, 10) });
assert.ok(claimed.ok);
assert.equal(claimed.effect.kind, 'reward');
assert.deepEqual(claimed.effect.rewards, ACHIEVEMENT_BY_ID.victor.tiers[0].reward);
assert.deepEqual(claimed.events.find(e => e.event === 'achievement_claimed').fields, { id: 'victor', tier: 1, gems: 0 });
assert.equal(sessionAction(fresh, {}, 'achievement-claim', { id: 'victor' }).ok, false);

// The Log panel shows a claim button for a ready tier, and the Log tab gets a dot.
const html = renderAchievements(veteran);
assert.match(html, /data-act="achievement-claim" data-id="victor"/);
assert.match(html, /Achievements · 1 to claim/);
assert.match(renderNav('ship', veteran, false, ['ship', 'crew', 'missions', 'shop', 'log']), /nav-badge/);

console.log('achievements: OK');
