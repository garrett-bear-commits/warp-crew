import assert from 'node:assert/strict';
import { COMBAT_ORDERS, ENCOUNTERS_V1 } from '../src/systems/combat.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { ensureContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { createNewPlayer } from '../src/systems/player.js';
import { previewTravel } from '../src/systems/travel.js';
import { sessionModels, sessionAction } from '../src/systems/sessionLoop.js';

assert.equal(ENCOUNTERS_V1.length, 16);
for (const encounter of ENCOUNTERS_V1) {
  assert.ok(encounter.tell?.label?.trim(), encounter.id);
  assert.ok(encounter.tell?.text?.trim(), encounter.id);
  assert.ok(COMBAT_ORDERS[encounter.tell?.recommendedOrder], encounter.id);
  assert.ok(encounter.tell?.reason?.trim(), encounter.id);
}

let player = completeFreshTutorial();
player = { ...player, activeContract: null };
player = ensureContractBoard(player).player;
player = acceptContract(player, player.contractBoard.offers.find((x) => x.profile === 'risky').id).player;
player = commitContractAction(player, previewContractAction(player, { id: 'launch' }), { rng: () => 0 }).player;
player = commitContractAction(player, previewContractAction(player, { id: 'push' }), { rng: () => 0 }).player;
const ui = sessionModels(player, {}).activeContractView.combat;
assert.deepEqual(ui.tell, player.activeContract && ENCOUNTERS_V1.find((x) => x.id === player.activeContract.encounterId).tell);
assert.equal(ui.orders.filter((x) => x.recommended).length, 1);
const order = ui.orders.find((x) => x.recommended);
const result = sessionAction(player, { contractPreviews: { [`order:${order.id}`]: previewContractAction(player, { id: 'order', orderId: order.id }) } }, 'contract-order', { order: order.id, revision: player.activeContract.revision, acceptanceId: player.activeContract.acceptanceId }, { rng: () => 0 });
const event = result.events.find((x) => x.event === 'combat_order_selected');
assert.equal(event.fields.recommendedOrder, order.id);
assert.equal(event.fields.followedRecommendation, true);

let explorer = createNewPlayer();
explorer.tutorial.completed = true;
explorer.tutorial.phase = 'done';
const pendingCombat = previewTravel(explorer, 'lane_a', { rng: () => 0.5 });
const exploreUi = sessionModels(explorer, { pendingCombat }).combatOrders;
assert.deepEqual(exploreUi.tell, ENCOUNTERS_V1.find((x) => x.id === pendingCombat.encounter.id).tell);
assert.equal(exploreUi.orders.filter((x) => x.recommended).length, 1);
const exploreResult = sessionAction(explorer, { pendingCombat }, 'combat-order', { order: 'burn' }, { rng: () => 0 });
const exploreEvent = exploreResult.events.find((x) => x.event === 'combat_order_selected');
assert.equal(exploreEvent.fields.recommendedOrder, 'brace');
assert.equal(exploreEvent.fields.followedRecommendation, false);
console.log('encounter_intelligence.test.mjs OK');
