import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { prepareSession, sessionModels, sessionAction, persistSessionTransition, improvementFocus } from '../src/systems/sessionLoop.js';
import { renderActiveContract, renderCombatOrders } from '../src/ui/contractView.js';
import { renderSessionGuidance, renderRoomSheet } from '../src/ui/bridge.js';
import { ROOMS } from '../src/data/starterShip.js';
import { defaultTutorial, ordersStep, sessionHint } from '../src/systems/tutorial.js';

// A bad saved route must not enter the acceptance transition, and live modifiers
// must change the displayed band without replacing the saved route identity.
const fixedNow = Date.UTC(2030, 8, 22, 12);
const bandPlayer = prepareSession({ ...createNewPlayer({ tutorialScript: 4, now: fixedNow, rng: () => 0.1 }), tutorial: { script: 3, completed: true, phase: 'done' }, wallet: { credits: 0, medals: 0, reputation: 0, gems: 0, fuel: 10 } }, fixedNow);
const bandOffer = bandPlayer.contractBoard.offers.find(x => x.profile === 'risky');
const initialBand = sessionModels(bandPlayer, { reviewedOfferId: bandOffer.id }, fixedNow).contractReview.rewardBand;
const upgraded = { ...bandPlayer, ship: { ...bandPlayer.ship, systems: { ...bandPlayer.ship.systems, weapons: 9 } } };
assert.notDeepEqual(sessionModels(upgraded, { reviewedOfferId: bandOffer.id }, fixedNow).contractReview.rewardBand.currencies, initialBand.currencies);
const invalidOffer = { ...bandOffer, routeContent: null };
const invalidPlayer = { ...bandPlayer, contractBoard: { ...bandPlayer.contractBoard, offers: [invalidOffer] } };
const invalidReview = sessionModels(invalidPlayer, { reviewedOfferId: invalidOffer.id }, fixedNow).contractReview;
assert.equal(invalidReview.enabled, false);
assert.equal(invalidReview.rewardBand.label, 'Reward unavailable');
assert.equal(sessionAction(invalidPlayer, {}, 'contract-accept', { offer: invalidOffer.id }, { now: fixedNow }).reason, 'reward_unavailable');
const acceptedBand = sessionAction(bandPlayer, {}, 'contract-accept', { offer: bandOffer.id }, { now: fixedNow }).player;
const injuredBand = { ...acceptedBand, crew: acceptedBand.crew.map(c => ({ ...c, status: 'injured', injuredUntil: fixedNow + 1000 })) };
assert.equal(sessionModels(injuredBand, {}, fixedNow).activeContractView.crewLabel, 'No ready crew');
assert.notEqual(sessionModels(injuredBand, {}, fixedNow + 1000).activeContractView.crewLabel, 'No ready crew');

// Catches production actions that skip tutorial steps, lose rendered identity, auto-pick
// a different away party, or publish effects before a failed local save.
let player = prepareSession({ ...createNewPlayer({ tutorialScript: 4 }), version: 7, tutorial: defaultTutorial() });
let ui = { missionView: 'contracts' };
const events = [];
function act(name, data = {}, options = {}) {
  const result = sessionAction(player, ui, name, data, options);
  if (result.ok) { player = result.player; ui = { ...ui, ...result.ui }; events.push(...result.events); }
  return result;
}
const identity = () => ({ revision: String(player.activeContract.revision), acceptanceId: player.activeContract.acceptanceId });
assert.equal(player.contractBoard.offers.length, 1);
assert.equal(act('contract-review', { offer: 'missing' }).ok, false);
assert.equal(player.tutorial.phase, 'distress');
act('contract-review', { offer: 'offer_tutorial_distress' });
assert.equal(player.tutorial.phase, 'launch');
act('contract-accept', { offer: 'offer_tutorial_distress' });
const fuel = player.wallet.fuel;
assert.equal(act('contract-action', { action: 'launch', revision: '0' }).reason, 'stale_contract_action');
act('contract-action', { action: 'launch', ...identity() });
assert.equal(player.wallet.fuel, fuel - 1);
assert.equal(player.tutorial.phase, 'order');
let model = sessionModels(player, ui);
assert.deepEqual(model.activeContractView.combat.orders.filter(x => x.enabled).map(x => x.id), ['brace']);
let html = renderActiveContract(model.activeContractView);
assert.match(html, /data-act="contract-order"/);
assert.match(html, /data-acceptance-id=/);
const stale = identity();
const renderedPreviews = sessionModels(player, ui).contractPreviews;
const changedPower = { ...player, crew: player.crew.map(c => ({ ...c, power: c.power + 100 })) };
assert.equal(sessionAction(changedPower, { ...ui, contractPreviews: renderedPreviews }, 'contract-order', { order: 'brace', ...identity() }).reason, 'stale_contract_action');
act('contract-order', { order: 'brace', ...identity() }, { rng: () => 0.999 });
assert.equal(player.tutorial.phase, 'return');
assert.equal(ui.tab, 'ship');
assert.equal(ui.selectedRoom, 'cargo');
assert.match(renderRoomSheet(player, ROOMS.find(r => r.id === 'cargo'), {}, Date.now()), /Bring it aboard/);
assert.equal(act('contract-claim', stale).reason, 'stale_contract_action');
const beforeClaim = player.wallet.credits;
act('contract-claim', identity());
assert.equal(player.wallet.credits, beforeClaim + 120);
assert.equal(player.tutorial.phase, 'recruit');
assert.equal(player.flags.sparrowFirstRepair, true, 'first tutorial claim lights the Sparrow repair');
assert.equal(player.dailyLoop.contract, true);
assert.equal(act('contract-claim', stale).ok, false);
act('tutorial-draw');
assert.equal(player.tutorial.phase, 'choose');
assert.equal(player.contractBoard.offers.length, 3);
assert.equal(sessionAction(player, ui, 'goto-contracts').events.filter(x => x.event === 'contract_board_seen').length, 1);
const offer = player.contractBoard.offers[0];
act('contract-review', { offer: offer.id });
act('contract-accept', { offer: offer.id });
assert.equal(player.tutorial.phase, 'away');
// Catches false board exposure when an accepted route replaces the three offers.
for (const action of ['goto-contracts', 'goto-missions', 'mission-view']) {
  const navigation = sessionAction(player, ui, action, { view: 'contracts' });
  assert.equal(navigation.ok, true);
  assert.equal(navigation.ui.missionView, 'contracts');
  assert.equal(navigation.events.filter(x => x.event === 'contract_board_seen').length, 0, `${action}: active route hides the board`);
}
act('exp-choose', { planet: 'dustfall' });
assert.match(sessionModels(player, ui).awayPicker.options.find(c => c.templateId === 'merc_jen').portrait, /jen\.png$/);
for (const id of [...ui.selectedExpeditionCrewIds]) act('exp-crew-toggle', { id });
assert.equal(act('exp-start', { planet: 'dustfall' }).reason, 'empty_party');
const chosen = player.crew.at(-1).instanceId;
act('exp-crew-toggle', { id: chosen });
const chance = sessionModels(player, ui).awayPicker.chance;
assert.equal(sessionAction({ ...player, crew: player.crew.map(c => c.instanceId === chosen ? { ...c, status: 'expedition' } : c) }, ui, 'exp-start', { planet: 'dustfall' }).reason, 'away_crew');
assert.equal(sessionAction(player, { ...ui, selectedExpeditionCrewIds: ['fabricated'] }, 'exp-start', { planet: 'dustfall' }).reason, 'unknown_crew');
assert.equal(act('exp-start', { planet: 'other' }).ok, false);
act('exp-start', { planet: 'dustfall' });
assert.deepEqual(player.activeExpedition.payload.crewInstanceIds, [chosen]);
assert.equal(player.activeExpedition.payload.successChance, chance);
assert.equal(sessionAction(player, {
  ...ui,
  selectedExpeditionId: 'dustfall',
  selectedExpeditionCrewIds: [chosen],
}, 'exp-start', { planet: 'dustfall' }).reason, 'expedition_active');
assert.equal(player.tutorial.phase, 'done');
assert.equal(player.dailyLoop.away, true);
assert.equal(ui.tab, 'ship');
assert.equal(ordersStep({ ...player, tutorial: { ...player.tutorial, ordersBeat: 'exp' } }), null);
assert.equal(sessionHint(player, {}), null);
assert.match(renderSessionGuidance(player), /1\/3|2\/3/);
assert.doesNotMatch(renderSessionGuidance(player), /class="coach"/);
assert.equal(events.some(x => x.event === 'travel'), false);
assert.deepEqual(events.filter(x => x.event === 'tutorial_stage').map(x => x.fields.phase), ['launch', 'order', 'return', 'recruit', 'choose', 'away', 'done']);
assert.equal(events.filter(x => x.event === 'contract_resolved').length, 1);
assert.equal(events.filter(x => x.event === 'daily_plan_progress' && x.fields.milestone === 'contract').length, 1);
assert.equal(act('ship-upgrade', { system: 'fake' }).ok, false);
assert.equal(player.dailyLoop.improve, false);
player = { ...player, wallet: { ...player.wallet, credits: 10000 } };
act('ship-upgrade', { system: 'engines' });
assert.equal(player.dailyLoop.improve, true);
assert.equal(renderSessionGuidance(player), '');
act('ship-upgrade', { system: 'engines' });
assert.equal(events.filter(x => x.event === 'daily_plan_progress' && x.fields.milestone === 'improve').length, 1);

// Persistence is a real boundary: no state publication, analytics, or animation on failure.
const result = { ok: true, player, ui, events: [{ event: 'contract_action', fields: {} }], effect: { kind: 'combat' } };
const order = [];
assert.equal(persistSessionTransition(result, { save: () => false, publish: () => order.push('publish'), capture: () => order.push('event'), animate: () => order.push('animation') }).ok, false);
assert.deepEqual(order, []);
persistSessionTransition(result, { save: () => { order.push('save'); return true; }, publish: () => order.push('publish'), capture: () => order.push('event'), animate: () => order.push('animation') });
assert.deepEqual(order, ['save', 'publish', 'event', 'animation']);

// The live pending Explore sheet must be operable and commit the chosen order.
player = prepareSession({ ...createNewPlayer({ tutorialScript: 4 }), tutorial: { script: 3, completed: true, phase: 'done' } });
ui = { missionView: 'explore' };
act('travel-to', { node: 'lane_a' }, { rng: () => 0.5 });
assert.ok(ui.pendingCombat);
model = sessionModels(player, ui);
assert.deepEqual(model.combatOrders.orders.map(x => x.id), ['brace', 'burn', 'board']);
assert.match(renderCombatOrders(model.combatOrders), /data-order="burn"/);
const pendingFuel = player.wallet.fuel;
const travelCost = ui.pendingCombat.fuelCost;
act('combat-order', { order: 'burn' }, { rng: () => 0 });
assert.equal(ui.pendingCombat, null);
assert.equal(player.wallet.fuel, pendingFuel - travelCost - 1);
assert.equal(events.at(-1).event, 'combat');
assert.ok(events.some(x => x.event === 'combat_order_selected' && x.fields.order === 'burn'));

// Old DOM identity cannot mutate a new acceptance at the same revision.
act('contract-accept', { offer: player.contractBoard.offers[0].id });
const oldIdentity = identity();
act('contract-abandon', oldIdentity);
act('contract-accept', { offer: player.contractBoard.offers[0].id });
assert.equal(act('contract-abandon', oldIdentity).reason, 'stale_contract_action');
assert.equal(act('contract-action', { action: 'launch', ...oldIdentity }).reason, 'stale_contract_action');
act('contract-action', { action: 'launch', ...identity() });
assert.equal(act('travel-to', { node: 'danger_belt' }).reason, 'active_contract');
act('contract-abandon', identity());
assert.ok(player.activeContract, 'post-launch abandon requires a confirmation');
act('contract-abandon-confirm', identity());
assert.equal(player.activeContract, null);
act('contract-accept', { offer: player.contractBoard.offers.find(x => x.profile === 'risky').id });
assert.equal(sessionAction({ ...player, wallet: { ...player.wallet, fuel: 0 } }, ui, 'contract-action', { action: 'launch', ...identity() }).reason, 'not_enough_fuel');
assert.equal(sessionAction({ ...player, ship: { ...player.ship, hull: 8 } }, ui, 'contract-action', { action: 'launch', ...identity() }).reason, 'hull_critical');
assert.equal(sessionAction({ ...player, crew: [] }, ui, 'contract-action', { action: 'launch', ...identity() }).reason, 'no_ready_crew');
act('contract-action', { action: 'launch', ...identity() });
act('contract-action', { action: 'push', ...identity() });
const emptyFuel = { ...player, wallet: { ...player.wallet, fuel: 0 } };
const disabledBurn = sessionModels(emptyFuel, ui).activeContractView.combat.orders.find(x => x.id === 'burn');
assert.equal(disabledBurn.enabled, false);
assert.equal(disabledBurn.costLabel, '1F extra');
assert.ok(disabledBurn.chance > 0);
const resolvedEvents = events.filter(x => x.event === 'contract_resolved').length;
act('contract-order', { order: 'brace', ...identity() }, { rng: () => 0 });
assert.equal(events.filter(x => x.event === 'contract_resolved').length, resolvedEvents + 1);
assert.equal(improvementFocus({ ...player, ship: { ...player.ship, hull: 69 } }).selectedRoom, 'engineering');
assert.equal(improvementFocus({ ...player, wallet: { credits: 100000, medals: 0 } }).selectedRoom, 'operations');
assert.equal(improvementFocus({ ...player, wallet: { credits: 0, medals: 0 } }).missionView, 'away');
console.log('session_loop.test.mjs OK');
