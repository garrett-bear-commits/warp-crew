import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { TUTORIAL_SCRIPT, currentTutorialStep } from '../src/systems/tutorial.js';
import { ensureContractBoard, acceptContract, previewContractAction, commitContractAction, normalizeContractState } from '../src/systems/contracts.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';

// Catches replaying completed tutorials, resetting paid/player data, and
// assigning the wrong continuation phase when a version-two save is loaded.
assert.equal(TUTORIAL_SCRIPT, 3, 'script version');
const fresh = createNewPlayer();
assert.equal(fresh.version, 7, 'save version');
assert.equal(fresh.tutorial.phase, 'distress');
assert.equal(fresh.contractBoard, null);
assert.equal(fresh.activeContract, null);
assert.deepEqual(fresh.dailyLoop, { dayKey: null, contract: false, improve: false, away: false });
assert.equal(fresh.stats.contractsCompleted, 0);
assert.deepEqual(fresh.stats.contractsByProfile, { reliable: 0, risky: 0, strange: 0 });

const cases = [
  ['completed veteran', { completed: true, phase: 'done', hiredThird: true }, 0, 'done'],
  ['dismissed veteran', { dismissed: true, phase: 'join' }, 0, 'done'],
  ['not fought', { firstCombat: false }, 0, 'distress'],
  ['traveled but not fought', { firstCombat: false }, 1, 'distress'],
  ['fought', { firstCombat: true, hiredThird: false }, 1, 'recruit'],
  ['recruited', { firstCombat: true, hiredThird: true }, 1, 'choose'],
];
for (const [label, tutorial, jumps, phase] of cases) {
  const input = {
    ...fresh, version: 6, captainName: 'Keeper',
    tutorial: { script: 2, ...tutorial },
    wallet: { credits: 17, fuel: 1, gems: 77, medals: 19, reputation: 23 },
    crew: fresh.crew.map((member, i) => i === 0 ? { ...member, status: 'expedition' } : member),
    reserve: [{ ...createCrewInstance('merc_jen'), status: 'reserve' }],
    ship: { ...fresh.ship, hull: 53, nickname: 'Kept', systems: { ...fresh.ship.systems, shields: 2 } },
    story: { chapter: 2, eclipseIntro: true, customDiscovery: 'kept' },
    activeExpedition: { id: 'existing-expedition', payload: { crewInstanceIds: [fresh.crew[0].instanceId], planetId: 'dustfall' }, endAt: Date.now() + 100000 },
    iapFulfilled: ['receipt-a'],
    stats: { ...fresh.stats, jumps, combatsWon: tutorial.firstCombat ? 1 : 0 },
  };
  const migrated = migratePlayer(input);
  assert.equal(migrated.tutorial.phase, phase, label);
  assert.equal(migrated.tutorial.script, 3, label);
  for (const field of ['wallet', 'crew', 'reserve', 'ship', 'activeExpedition', 'iapFulfilled']) {
    assert.deepEqual(migrated[field], input[field], `${label}: preserve ${field}`);
  }
  for (const [key, value] of Object.entries(input.story)) assert.deepEqual(migrated.story[key], value, `${label}: preserve story.${key}`);
  assert.equal(Boolean(currentTutorialStep(migrated)), phase !== 'done', label);
  assert.equal(migrated.tutorial.completed, phase === 'done', label);
  assert.deepEqual(migratePlayer(migrated), migrated, `${label}: idempotent migration`);
}

// Catches replaying the first session for progressed pre-v2 careers, while
// preserving the explicit v2 continuation rules even for traveled players.
for (const tutorial of [undefined, { script: 1 }]) {
  const veteran = migratePlayer({ ...fresh, version: 4, tutorial, stats: { ...fresh.stats, jumps: 5, combatsWon: 3 } });
  assert.equal(veteran.tutorial.phase, 'done', 'pre-v2 veteran');
  assert.equal(veteran.tutorial.completed, true);
}

// Catches migration clearing valid route identities/results or accepting partial
// and malformed snapshots that the production route validator rejects.
let route = ensureContractBoard({ ...fresh, tutorial: { script: 3, completed: true, phase: 'done' } }).player;
route = acceptContract(route, route.contractBoard.offers.find((offer) => offer.profile === 'risky').id).player;
for (const action of [null, { id: 'launch' }, { id: 'push' }, { id: 'order', orderId: 'brace' }]) {
  if (action) route = commitContractAction(route, previewContractAction(route, action), { rng: () => 0 }).player;
  const saved = JSON.parse(JSON.stringify(route));
  const migrated = migratePlayer(saved);
  assert.deepEqual(migrated.activeContract, saved.activeContract, `preserve ${saved.activeContract.stage}`);
  assert.deepEqual(migrated.contractBoard, saved.contractBoard);
  assert.equal(migrated.contractAcceptanceSequence, saved.contractAcceptanceSequence);
  assert.deepEqual(migrated.activeContract, normalizeContractState(saved).activeContract);
}
const invalidCases = [
  { stage: 'teleporting' }, { acceptanceId: '' }, { secureOutcome: null },
  { routeOutcome: null }, { destinationId: 'missing' }, { stage: 'confrontation', encounterId: 'missing' },
  { orderId: 'cheat' }, { revision: -1 },
  { result: { ...route.activeContract.result, rewards: { ...route.activeContract.result.rewards, credits: '100' } } },
  { result: { ...route.activeContract.result, hullLoss: Infinity } },
];
for (const mutation of invalidCases) {
  const saved = { ...route, activeContract: { ...route.activeContract, ...mutation } };
  const migrated = migratePlayer(saved);
  assert.equal(migrated.activeContract, null, `clear ${Object.keys(mutation)}`);
  assert.deepEqual(migrated.wallet, saved.wallet);
  assert.equal(migrated.recoveryEvents.at(-1).reason, 'invalid_contract_state');
}

completeFreshTutorial();
console.log('tutorial_v3.test.mjs OK');
