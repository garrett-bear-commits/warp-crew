import assert from 'node:assert/strict';
import { unlockedTabs, hudChips, missionViews, postTutorialStage } from '../src/systems/tutorial.js';
import { renderMissionSwitcher } from '../src/ui/contractView.js';

const captain = (contractsCompleted, extra = {}) => ({
  tutorial: { script: 5, phase: 'done', completed: true },
  stats: { contractsCompleted },
  wallet: { credits: 200, gems: 0, medals: 8 },
  iapFulfilled: [],
  ...extra,
});

// Fresh from the guided session: ship, crew and contracts only.
assert.deepEqual(unlockedTabs(captain(1)), ['ship', 'crew', 'missions']);
assert.deepEqual(hudChips(captain(1)), ['fuel', 'credits', 'medals']);
assert.deepEqual(missionViews(captain(1)), ['contracts', 'away']);

// Second finished contract opens Shop, Log and the gem counter.
assert.ok(unlockedTabs(captain(2)).includes('shop'));
assert.ok(unlockedTabs(captain(2)).includes('log'));
assert.ok(hudChips(captain(2)).includes('gems'));
assert.deepEqual(missionViews(captain(2)), ['contracts', 'away']);

// Third opens Explore.
assert.deepEqual(missionViews(captain(3)), ['contracts', 'away', 'explore']);

// Anyone holding premium value, and veterans, see everything immediately.
assert.equal(postTutorialStage(captain(1, { wallet: { gems: 5 } })), null);
assert.equal(postTutorialStage(captain(1, { iapFulfilled: ['tok'] })), null);
assert.equal(postTutorialStage({ tutorial: { script: 3, completed: true }, stats: {} }), null);
assert.ok(unlockedTabs(captain(1, { wallet: { gems: 5 } })).includes('shop'));

// The switcher renders only the unlocked views.
const two = renderMissionSwitcher('contracts', ['contracts', 'away']);
assert.ok(!two.includes('Explore'));
assert.match(two, /--views:2/);

console.log('progressive_unlock.test.mjs OK');
