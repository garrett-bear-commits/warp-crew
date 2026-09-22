import assert from 'node:assert/strict';
import { renderMissions, renderCombatModal } from '../src/ui/bridge.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import {
  renderMissionSwitcher, renderContractBoard, renderContractReview,
  renderActiveContract, renderCombatOrders, renderAwayPicker, renderDailyPlan,
} from '../src/ui/contractView.js';

// Catches hiding required card facts or losing accessible profile/fuel/reward context.
const offers = [
  { id: 'r', profile: 'reliable', profileLabel: 'Reliable', title: 'Quiet Freight', brief: 'Medicine through the Spur.', normalFuel: 2, beats: 2, primaryReward: 'Credits', danger: 'Low', favoredTrait: { label: 'Trader', why: 'Trade contacts' } },
  { id: 'k', profile: 'risky', profileLabel: 'Risky', title: 'Cut the Nest', brief: 'Pirates owe us metal.', normalFuel: 2, beats: 3, primaryReward: 'Medals', danger: 'High', favoredTrait: { label: 'Gunner' } },
  { id: 's', profile: 'strange', profileLabel: 'Strange', title: 'A Signal Knocks', brief: 'It knows the ship.', normalFuel: 2, beats: 3, primaryReward: 'Discovery', danger: 'Guarded', favoredTrait: { label: 'Sensors' } },
];
const board = renderContractBoard({ offers });
assert.equal((board.match(/data-act="contract-review"/g) || []).length, 3);
for (const fact of ['2F', '2 beats', '3 beats', 'High', 'Gunner', 'Trade contacts']) assert.ok(board.includes(fact), fact);
assert.match(board, /aria-label="[^"]*Reliable[^"]*Quiet Freight[^"]*2F[^"]*Low[^"]*Credits/);
assert.match(renderContractBoard({ offers: [{ ...offers[0], completed: true }] }), /disabled[^>]*>[^<]*Completed/);
assert.match(renderMissionSwitcher(), /aria-pressed="true"[^>]*>Contracts/);
assert.match(renderMissionSwitcher('away'), /aria-pressed="true"[^>]*>Away/);

// Catches restoring Sure, dropping consequences, or enabling unavailable orders.
const orders = renderCombatOrders({ guaranteed: true, orders: [
  { id: 'brace', name: 'Brace', enabled: true, chanceLabel: 'Guaranteed', consequence: 'Half hull loss · no injury', costLabel: 'Free', rewardLabel: 'Normal payout' },
  { id: 'burn', name: 'Burn', enabled: false, chanceLabel: '70%', consequence: 'Normal hull loss', costLabel: '1F', reason: 'Not enough fuel' },
] });
assert.ok(orders.includes('Guaranteed') && !orders.includes('Sure'));
assert.match(orders, /data-order="brace"/);
assert.ok(orders.includes('Half hull loss · no injury') && orders.includes('Normal payout'));
assert.match(orders, /data-order="burn"[^>]*disabled/);
assert.ok(orders.includes('Not enough fuel'));

// Catches launching without crew reasons, selection state, or opportunity cost.
const awayModel = { destination: { id: 'dustfall', name: 'Dustfall' }, cap: 2, selectedIds: ['a'], enabled: true, chanceLabel: '80%', successReward: '80 credits', failureReward: '18 credits', injuryRisk: 'Injury possible on failure', returnLabel: '14:30', opportunityCost: 'Selected crew unavailable for contracts until return.', options: [{ id: 'a', name: 'Rex', role: 'pilot', selected: true, portrait: '/rex.png', reasons: ['highest ready power'] }] };
const away = renderAwayPicker(awayModel);
for (const text of ['highest ready power', 'exp-crew-toggle', 'aria-pressed="true"', '80%', '18 credits', '14:30', 'unavailable for contracts']) assert.ok(away.includes(text), text);
assert.match(renderAwayPicker({ ...awayModel, selectedIds: [], enabled: false }), /data-act="exp-launch"[^>]*disabled/);

// Catches lost payable-cost/consequence context or using normal fuel as payable fuel.
const review = renderContractReview({ offer: offers[0], destinationName: 'Dust Lane', cost: { fuel: 1 }, rewardLabel: '40–80 credits', consequence: 'Possible hull loss', enabled: true });
for (const text of ['Dust Lane', '1F', '40–80 credits', 'Possible hull loss', 'contract-accept', 'role="dialog"', 'aria-modal="true"']) assert.ok(review.includes(text), text);
const route = renderActiveContract({ title: 'Quiet Freight', stage: 'choice', stageLabel: 'Route choice', revision: 3, actions: [{ id: 'secure', label: 'Secure the contract · 1F', consequence: 'Lower variance payout', enabled: true, primary: true }, { id: 'push', label: 'Push the signal · 1F', consequence: 'Combat ahead', enabled: false, reason: 'No ready crew' }] });
for (const text of ['Route choice', 'Lower variance payout', 'Combat ahead', 'data-revision="3"']) assert.ok(route.includes(text), text);
assert.match(route, /data-action="push"[^>]*disabled/);
assert.equal(renderDailyPlan({ complete: true }), '');
assert.ok(renderDailyPlan({ completed: 1, next: { label: 'Improve', act: 'goto-crew' } }).includes('1/3'));

// Catches HTML/attribute injection through view model text, ids and labels; no mutation.
const poison = '\"><img src=x onerror=alert(1)>';
const unsafe = { ...offers[0], id: poison, title: poison, favoredTrait: { label: poison, why: poison } };
const frozen = Object.freeze({ offers: Object.freeze([Object.freeze(unsafe)]) });
assert.ok(!renderContractBoard(frozen).includes('<img src=x'));
assert.ok(renderContractBoard(frozen).includes('&lt;img'));
for (const output of [renderCombatOrders({ orders: [{ id: poison, name: poison, consequence: poison }] }), renderAwayPicker({ destination: { name: poison }, options: [{ id: poison, name: poison, reasons: [poison] }] }), renderActiveContract({ title: poison, actions: [{ id: poison, label: poison }] }), renderDailyPlan({ next: { label: poison, act: poison } })]) assert.ok(!output.includes('<img src=x'));
// Catches stacking Board/Explore/Away, re-enabling conflicting travel, and old assists.
const player = { ...completeFreshTutorial(), activeContract: null, activeExpedition: null, contractBoard: { offers, completedOfferIds: [] } };
const missions = renderMissions(player, Date.now());
assert.ok(missions.includes('Quiet Freight'));
assert.ok(!missions.includes('data-act="travel-to"') && !missions.includes('data-act="exp-choose"'));
const explore = renderMissions({ ...player, activeContract: { title: 'Active' } }, Date.now(), { missionView: 'explore' });
assert.ok(explore.includes('Finish or abandon the active contract first.'));
const travelControls = explore.match(/<button[^>]*data-act="travel-to"[^>]*>/g) || [];
assert.ok(travelControls.length > 0);
assert.ok(travelControls.every((button) => button.includes('disabled')));
const awayView = renderMissions(player, Date.now(), { missionView: 'away' });
assert.ok(awayView.includes('data-act="exp-choose"') && !awayView.includes('data-act="travel-to"') && !awayView.includes('data-act="exp-start"'));
const combatModal = renderCombatModal({ title: 'Pirate', guaranteed: true, orders: [{ id: 'brace', name: 'Brace', enabled: true, costLabel: 'Free', consequence: 'No injury' }] });
assert.ok(combatModal.includes('data-order="brace"') && !combatModal.includes('data-assist=') && !combatModal.includes('Sure'));
console.log('contract_ui.test.mjs OK');
