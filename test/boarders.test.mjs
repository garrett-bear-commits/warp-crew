import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { ensureContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { applyEncounterAction, boardersUnlocked, pickDefender, BOARDERS_UNLOCK } from '../src/systems/encounterState.js';
import { startEncounter, advanceEncounter, BOARDERS } from '../src/systems/autoCombat.js';
import { sessionModels } from '../src/systems/sessionLoop.js';
import { renderShipEncounter } from '../src/ui/contractView.js';
import { crewTargetStates } from '../src/ui/crewWalk.js';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { NODES } from '../src/data/sectors.js';
import { finishCrewFight } from './helpers/crewFight.mjs';

const now = new Date(2026, 8, 21, 12).getTime();
const clone = value => JSON.parse(JSON.stringify(value));
const outputs = { helm: 110, shields: 100, weapons: 110, engineering: 100 };

// Core timeline: warning on beat 2, landing on beat 3, sabotage each beat until repelled.
{
  let state = startEncounter({ acceptanceId: 'a', encounterId: 'scrapper_gang', kind: 'normal', seed: 5, threat: 1, outputs, boarders: true });
  assert.equal(state.boarders.phase, 'none');
  state = advanceEncounter(state).state;
  const warn = advanceEncounter(state);
  assert.ok(warn.events.some(event => event.type === 'boarders_incoming'));
  state = warn.state;
  assert.equal(state.boarders.phase, 'incoming');
  const target = state.boarders.target;
  const landed = advanceEncounter(state);
  assert.ok(landed.events.some(event => event.type === 'boarders_landed'));
  assert.equal(landed.state.boarders.strength, BOARDERS.strength);
  assert.equal(landed.state.systems[target], 100 - BOARDERS.sabotage + (landed.events.some(e => e.type === 'repair' && e.target === 'system' && e.system === target) ? 1 : 0));
  let ignored = landed.state;
  for (let i = 0; i < 6 && !ignored.result; i++) ignored = advanceEncounter(ignored).state;
  assert.ok(ignored.systems[target] >= BOARDERS.minSystem, 'sabotage has a floor');

  // Repel with a gunner: two per beat, done in two beats, and their own post drops to baseline meanwhile.
  const repelled = advanceEncounter(landed.state, 'repel', { defender: { id: 'jen', role: 'gunner', station: 'weapons' } });
  assert.equal(repelled.state.boarders.defenderId, 'jen');
  assert.equal(repelled.state.boarders.phase, 'repelled', 'a gunner clears a three-raider party in one beat');
  assert.ok(repelled.events.some(event => event.type === 'boarders_repelled'));
  const cleared = repelled;
  const slower = advanceEncounter(landed.state, 'repel', { defender: { id: 'rex', role: 'pilot', station: 'helm' } });
  assert.equal(slower.state.boarders.strength, 1, 'other roles take two beats');
  assert.equal(slower.state.outputs.helm, 100, 'a defender off their post leaves it at baseline while fighting');
  assert.equal(advanceEncounter(cleared.state, 'repel', { defender: { id: 'x', role: 'gunner' } }).reason, 'no_boarders');
  assert.deepEqual(advanceEncounter(clone(landed.state), 'repel', { defender: { id: 'jen', role: 'gunner', station: 'weapons' } }), repelled, 'deterministic');

  // Only listed raiders board; other enemies never do.
  assert.equal(Object.hasOwn(startEncounter({ acceptanceId: 'a', encounterId: 'pirate_wing', kind: 'normal', seed: 5, threat: 1, outputs, boarders: true }), 'boarders'), false);
}

// Slow rollout for guided-flow captains.
assert.equal(boardersUnlocked({ tutorial: { script: 5, completed: true }, stats: { contractsCompleted: BOARDERS_UNLOCK - 1 } }), false);
assert.equal(boardersUnlocked({ tutorial: { script: 5, completed: true }, stats: { contractsCompleted: BOARDERS_UNLOCK } }), true);

// Integration: a real Scrapyard contract fight, with a gunner aboard to defend.
function scrapperFight() {
  const base = createNewPlayer({ tutorialScript: 4 });
  const gunner = createCrewInstance('merc_jen', { rng: () => 0.1 });
  let player = { ...base, crew: [...base.crew.map(member => ({ ...member, power: 30 })), { ...gunner, power: 30 }],
    stationAssignments: { ...base.stationAssignments, [gunner.instanceId]: 'weapons' },
    crewSlots: 3, tutorial: { script: 3, completed: true, phase: 'done' }, wallet: { ...base.wallet, fuel: 10 } };
  player = ensureContractBoard(player, now).player;
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'risky');
  const combat = NODES.scrapyard.outcomes.find(outcome => outcome.kind === 'combat');
  offer.destinationId = 'scrapyard';
  offer.routeContent = { ...offer.routeContent, destinationId: 'scrapyard', routeOutcome: { ...combat }, secureOutcome: { ...combat }, encounterId: combat.encounter, storyFlag: null };
  player = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', 'push']) player = commitContractAction(player, previewContractAction(player, { id }, now), { now, rng: () => 0 }).player;
  return { player, gunner };
}
{
  const { player: start, gunner } = scrapperFight();
  assert.equal(start.activeEncounter.encounterId, 'scrapper_gang');
  assert.ok(start.activeEncounter.boarders, 'veteran scrapper fights can board');
  assert.equal(pickDefender(start, now).id, gunner.instanceId, 'gunners defend before the captain');
  let player = start;
  const step = () => {
    const { acceptanceId, revision } = player.activeEncounter;
    player = applyEncounterAction(player, { acceptanceId, revision, order: null }, now).player;
    assert.deepEqual(migratePlayer(clone(player)).activeEncounter, player.activeEncounter, 'every beat survives reload');
  };
  step(); step();
  let html = renderShipEncounter(sessionModels(player, {}, now).activeContractView);
  assert.match(html, /Clamps on the airlock/);
  assert.match(html, new RegExp(`data-order="repel"[^>]*>Repel boarders<span>${gunner.name} leaves Weapons`));
  step();
  assert.equal(player.activeEncounter.boarders.phase, 'aboard');
  const { acceptanceId, revision } = player.activeEncounter;
  player = applyEncounterAction(player, { acceptanceId, revision, order: 'repel' }, now).player;
  html = renderShipEncounter(sessionModels(player, {}, now).activeContractView);
  assert.match(html, new RegExp(`${gunner.name} threw the boarders out of`));
  const target = crewTargetStates(player).find(t => t.crewInstanceId === gunner.instanceId);
  assert.equal(target.mode, 'repel-boarders', 'the defender walks to the boarded room');
  const finished = finishCrewFight(player, now);
  assert.ok(['win', 'loss'].includes(finished.activeEncounter.result));
  assert.equal(finished.activeContract.stage, 'return');
}

console.log('boarders.test.mjs OK');
