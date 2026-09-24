import assert from 'node:assert/strict';
import { renderMissions, renderCombatModal } from '../src/ui/bridge.js';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { createNewPlayer } from '../src/systems/player.js';
import { prepareSession, sessionModels } from '../src/systems/sessionLoop.js';
import { acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
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
assert.match(board, /aria-label="[^"]*Reliable[^"]*Quiet Freight[^"]*2F[^"]*Low[^"]*Possible payout now: Credits/);
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

// Live board and review expose the same literal range to sighted and screen-reader users.
const now = Date.UTC(2026, 8, 22, 12);
const livePlayer = prepareSession({ ...createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 }), tutorial: { script: 3, completed: true, phase: 'done' } }, now);
const liveOffer = livePlayer.contractBoard.offers[0];
const boardModel = sessionModels(livePlayer, {}, now).contractBoard;
const boardHtml = renderContractBoard(boardModel);
assert.match(boardHtml, /<dt>Possible payout now<\/dt>/);
assert.ok(boardModel.offers[0].rewardBand.label.includes('credits'));
assert.ok(boardHtml.includes(boardModel.offers[0].rewardBand.label));
assert.ok(boardHtml.includes(`Possible payout now: ${boardModel.offers[0].rewardBand.label}"`));
const reviewModel = sessionModels(livePlayer, { reviewedOfferId: liveOffer.id }, now).contractReview;
const reviewHtml = renderContractReview(reviewModel);
assert.match(reviewHtml, /<dt>Possible payout now<\/dt>/);
assert.ok(reviewHtml.includes(reviewModel.rewardBand.label));
assert.ok(reviewHtml.includes(`aria-label="Accept contract, Possible payout now: ${reviewModel.rewardBand.label}"`));
assert.doesNotMatch(boardHtml + reviewHtml, /Expected reward/);
const badOffer = { ...liveOffer, routeContent: null };
const badPlayer = { ...livePlayer, contractBoard: { ...livePlayer.contractBoard, offers: [badOffer] } };
const badReviewHtml = renderContractReview(sessionModels(badPlayer, { reviewedOfferId: badOffer.id }, now).contractReview);
assert.match(badReviewHtml, /Reward unavailable/);
assert.match(badReviewHtml, /data-act="contract-accept"[^>]*disabled/);
const acceptedLive = acceptContract(livePlayer, liveOffer.id, now).player;
const launchedLive = commitContractAction(acceptedLive, previewContractAction(acceptedLive, { id: 'launch' }, now), { now }).player;
const returnedLive = commitContractAction(launchedLive, previewContractAction(launchedLive, { id: 'secure' }, now), { now }).player;
const returnView = renderActiveContract(sessionModels(returnedLive, {}, now).activeContractView);
assert.ok(returnView.includes(sessionModels(returnedLive, {}, now).activeContractView.result.rewardLabel));
assert.doesNotMatch(returnView, /Possible payout now/);
const tellHtml = renderCombatOrders({ title: 'Pirate Wing', tell: { label: 'Formation tightening', text: 'Three cutters close in.', reason: 'Spend 1F for +12 power.' }, orders: [
  { id: 'brace', name: 'Brace', enabled: true, chanceLabel: '60%', costLabel: '0F extra', consequence: 'Half hull loss' },
  { id: 'burn', name: 'Burn', enabled: true, recommended: true, chanceLabel: '80%', costLabel: '1F extra', consequence: '+12 effective power' },
] });
assert.match(tellHtml, /Formation tightening/);
assert.match(tellHtml, /Spend 1F for \+12 power/);
assert.match(tellHtml, /Burn · Recommended/);
assert.doesNotMatch(tellHtml, /aria-pressed/);

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

// Catches rebinding a rendered revision to a different acceptance, or unescaped IDs.
const sameRevisionRoute = { title: 'Repeat contract', stage: 'briefing', revision: 0, actions: [{ id: 'launch', label: 'Launch · 1F', enabled: true }], abandon: { label: 'Abandon contract', enabled: true } };
const firstAcceptance = renderActiveContract({ ...sameRevisionRoute, acceptanceId: 'accepted-first' });
const secondAcceptance = renderActiveContract({ ...sameRevisionRoute, acceptanceId: 'accepted-"second<&' });
for (const action of ['contract-action', 'contract-abandon']) {
  const firstControl = firstAcceptance.match(new RegExp(`<button[^>]*data-act="${action}"[^>]*>`))?.[0];
  const secondControl = secondAcceptance.match(new RegExp(`<button[^>]*data-act="${action}"[^>]*>`))?.[0];
  assert.ok(firstControl?.includes('data-revision="0"'));
  assert.ok(secondControl?.includes('data-revision="0"'));
  assert.ok(firstControl?.includes('data-acceptance-id="accepted-first"'), `${action} must carry the first rendered acceptance`);
  assert.ok(secondControl?.includes('data-acceptance-id="accepted-&quot;second&lt;&amp;"'), `${action} must carry the second rendered acceptance, escaped`);
  assert.ok(!secondControl?.includes('accepted-first'));
}

// Catches aria-label replacing the visible action, breaking label-in-name access.
assert.ok(board.includes('aria-label="Review Reliable, Quiet Freight, 2F, Low danger, Possible payout now: Credits"'));
assert.ok(orders.includes('aria-label="Choose Brace, Guaranteed, Free, Half hull loss · no injury"'));
assert.ok(orders.includes('aria-label="Choose Burn, Guaranteed, 1F, Normal hull loss"'));
console.log('contract_ui.test.mjs OK');
