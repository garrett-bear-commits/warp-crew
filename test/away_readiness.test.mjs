import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { chooseCaptain } from '../src/systems/captainFirstPlay.js';
import { hireFirstCrew } from '../src/systems/tutorialV5.js';
import { expeditionCrewOptions, validateExpeditionParty, recommendedExpeditionCrewIds, visiblePlanets } from '../src/systems/expedition.js';
import { sessionModels, shipReadiness } from '../src/systems/sessionLoop.js';
import { threatLabel } from '../src/systems/encounterState.js';
import { renderAwayPicker, renderContractReview } from '../src/ui/contractView.js';
import { generateContractBoard } from '../src/systems/contracts.js';

const now = Date.UTC(2030, 8, 22, 12);
let player = createNewPlayer({ now, rng: () => 0.1 });
player = chooseCaptain(player, { templateId: 'captain_cyborg', name: 'Aster', rng: () => 0.1 }).player;
player = hireFirstCrew({ ...player, tutorial: { ...player.tutorial, phase: 'hire' } }, { rng: () => 0.2 }).player;
player = { ...player, tutorial: { ...player.tutorial, phase: 'done', completed: true } };
const planet = visiblePlanets(player, now)[0];
const captainId = player.captainInstanceId;
const hireId = player.tutorial.firstHireInstanceId;

// The captain always stays aboard; everyone else may go.
const options = expeditionCrewOptions(player, planet.id, now);
assert.equal(options.find(option => option.id === captainId).enabled, false);
assert.match(options.find(option => option.id === captainId).reason, /Captain stays aboard/);
assert.ok(!recommendedExpeditionCrewIds(player, planet.id, now).includes(captainId));
assert.equal(validateExpeditionParty(player, planet.id, [captainId], now).reason, 'captain_stays');
assert.equal(validateExpeditionParty(player, planet.id, [hireId], now).ok, true);

// Readiness shows the power and stations the ship loses when a team leaves.
player = { ...player, stationAssignments: { ...player.stationAssignments, [hireId]: 'weapons' } };
const readiness = shipReadiness(player, [hireId], now);
assert.ok(readiness.after < readiness.before);
assert.equal(readiness.aboard, 1);
assert.deepEqual(readiness.unstaffed, ['Weapons']);
const picker = sessionModels(player, { selectedExpeditionId: planet.id, selectedExpeditionCrewIds: [hireId] }, now).awayPicker;
assert.match(renderAwayPicker(picker), /Ship combat power \d+ → <b>\d+<\/b> · 1 aboard · Weapons unstaffed/);

// Contract review states the fight threat with the crew actually aboard.
assert.equal(threatLabel(0.8), 'Favorable');
assert.equal(threatLabel(1.0), 'Even');
assert.equal(threatLabel(1.2), 'Dangerous');
assert.equal(threatLabel(1.5), 'Deadly');
player = { ...player, wallet: { ...player.wallet, fuel: 10 }, contractBoard: generateContractBoard(player, now) };
const risky = player.contractBoard.offers.find(offer => offer.profile === 'risky');
const aboard = sessionModels(player, { reviewedOfferId: risky.id }, now).contractReview;
const away = sessionModels({ ...player, crew: player.crew.map(member => member.instanceId === hireId ? { ...member, status: 'expedition' } : member) },
  { reviewedOfferId: risky.id }, now).contractReview;
assert.ok(aboard.fightThreat && away.fightThreat);
assert.equal(away.fightThreat.awayCount, 1);
const order = ['Favorable', 'Even', 'Dangerous', 'Deadly'];
assert.ok(order.indexOf(away.fightThreat.label) >= order.indexOf(aboard.fightThreat.label), 'sending crew away cannot make the fight safer');
assert.match(renderContractReview(away), /Fight threat with crew aboard: <b>\w+<\/b> · 1 crew away/);

console.log('away_readiness.test.mjs OK');
