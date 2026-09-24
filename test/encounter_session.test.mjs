import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction, claimContractReward, tutorialDistressOffer } from '../src/systems/contracts.js';
import { applyEncounterAction, recoverEncounter } from '../src/systems/encounterState.js';
import { sessionAction, sessionModels, persistSessionTransition } from '../src/systems/sessionLoop.js';
import { renderActiveContract, renderShipEncounter } from '../src/ui/contractView.js';
import { encounterVisualFrame } from '../src/ui/combatView.js';
import { renderOverlays } from '../src/ui/bridge.js';

const now = Date.UTC(2030, 8, 22, 12);
const clone = value => JSON.parse(JSON.stringify(value));
const action = (player, id) => {
  const preview = previewContractAction(player, { id }, now);
  assert.equal(preview.ok, true, `${id}: ${preview.reason}`);
  const committed = commitContractAction(player, preview, { now, rng: () => 0.5 });
  assert.equal(committed.ok, true, `${id}: ${committed.reason}`);
  return committed.player;
};
const guided = (script = 4) => {
  let player = createNewPlayer({ now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, script }, contractBoard: { dayKey: 'tutorial', offers: [tutorialDistressOffer(player)], completedOfferIds: [] } };
  player = acceptContract(player, 'offer_tutorial_distress', now).player;
  return action(player, 'launch');
};
const normal = ({ staffWeapons = false } = {}) => {
  let player = createNewPlayer({ now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, wallet: { ...player.wallet, fuel: 10 } };
  player = { ...player, contractBoard: generateContractBoard(player, now) };
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'reliable');
  assert.equal(offer.routeContent.encounterId, 'pirate_scout', 'fixed repeatable route exists in authored content');
  player = acceptContract(player, offer.id, now).player;
  player = action(player, 'launch');
  if (staffWeapons) {
    const gunner = createCrewInstance('merc_jen', { rng: () => 0.1 });
    player = {
      ...player,
      crew: [...player.crew, gunner],
      stationAssignments: { ...player.stationAssignments, [gunner.instanceId]: 'weapons' },
    };
  }
  return action(player, 'push');
};
const beat = (player, order = null) => {
  const { acceptanceId, revision } = player.activeEncounter;
  const result = applyEncounterAction(player, { acceptanceId, revision, order }, now);
  assert.equal(result.ok, true, result.reason);
  return result.player;
};

test('only a newly entered eligible fight starts the new encounter', () => {
  const first = guided();
  assert.equal(first.activeContract.stage, 'confrontation');
  assert.equal(first.activeEncounter.kind, 'guided');
  assert.equal(first.activeEncounter.acceptanceId, first.activeContract.acceptanceId);
  assert.equal(migratePlayer(clone(first)).activeEncounter.kind, 'guided');
  let guidedWin = first;
  for (let i = 0; i < 30 && !guidedWin.activeEncounter.result; i++) guidedWin = beat(guidedWin);
  assert.equal(migratePlayer(clone(guidedWin)).activeEncounter.result, 'win');
  assert.equal(normal().activeEncounter.kind, 'normal');
  const old = guided(3);
  assert.equal(old.activeEncounter ?? null, null);
  assert.equal(previewContractAction(old, { id: 'order', orderId: 'brace' }, now).ok, true);
  assert.equal(migratePlayer(clone(old)).activeContract.stage, 'confrontation');
  assert.equal(migratePlayer(clone(old)).activeEncounter ?? null, null);
});

test('each beat has an acceptance and revision guard, and reload preserves its next step', () => {
  const start = normal();
  const fuel = start.wallet.fuel;
  assert.equal(applyEncounterAction(start, { acceptanceId: 'wrong', revision: 0, order: null }, now).reason, 'stale_encounter_action');
  assert.equal(applyEncounterAction(start, { acceptanceId: start.activeEncounter.acceptanceId, revision: 9, order: null }, now).reason, 'stale_encounter_action');
  assert.equal(applyEncounterAction(start, { acceptanceId: start.activeEncounter.acceptanceId, revision: 0, order: 'burn' }, now).reason, 'order_unavailable');
  const advanced = beat(start);
  assert.equal(advanced.activeEncounter.revision, 1);
  assert.equal(advanced.wallet.fuel, fuel);
  assert.equal(applyEncounterAction(advanced, { acceptanceId: start.activeEncounter.acceptanceId, revision: 0, order: null }, now).reason, 'stale_encounter_action');
  const loaded = migratePlayer(clone(advanced));
  assert.deepEqual(beat(loaded).activeEncounter, beat(advanced).activeEncounter);
  assert.equal(loaded.wallet.fuel, fuel);
});

test('the next committed beat uses crew availability and never spends route fuel again', () => {
  let player = normal();
  const fuel = player.wallet.fuel;
  const bolt = player.crew.find(member => member.templateId === 'merc_bolt');
  player = { ...player, stationAssignments: { ...player.stationAssignments, [bolt.instanceId]: 'shields' } };
  const staffed = beat(player);
  assert.equal(staffed.activeEncounter.outputs.shields, 110);
  const away = { ...staffed, crew: staffed.crew.map(member => member.instanceId === bolt.instanceId ? { ...member, status: 'expedition' } : member) };
  const unstaffed = beat(away);
  assert.equal(unstaffed.activeEncounter.outputs.shields, 100);
  assert.equal(unstaffed.stationAssignments[bolt.instanceId], 'shields');
  assert.equal(unstaffed.wallet.fuel, fuel);
});

test('a saved win claims its route reward once, after the final beat', () => {
  let player = normal({ staffWeapons: true });
  const initial = clone(player.wallet);
  for (let i = 0; i < 30 && !player.activeEncounter.result; i++) player = beat(player);
  assert.equal(player.activeEncounter.result, 'win');
  assert.equal(player.activeContract.stage, 'return');
  assert.equal(player.activeContract.result.success, true);
  assert.deepEqual(player.wallet, initial, 'beats never grant wallet rewards');
  const loaded = migratePlayer(clone(player));
  assert.equal(loaded.activeEncounter.result, 'win');
  assert.equal(applyEncounterAction(loaded, { acceptanceId: loaded.activeEncounter.acceptanceId, revision: loaded.activeEncounter.revision, order: null }, now).reason, 'encounter_finished');
  const reward = loaded.activeContract.result.rewards;
  const claimed = claimContractReward(loaded, now);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.player.activeEncounter, null);
  assert.equal(claimed.player.wallet.credits, initial.credits + reward.credits);
  assert.equal(claimed.player.wallet.reputation, initial.reputation + reward.reputation);
  assert.equal(claimed.player.wallet.fuel, initial.fuel + reward.fuel);
  assert.equal(claimContractReward(claimed.player, now).ok, false);
});

test('a damaged normal ship can lose, then recover without a reward', () => {
  let player = normal();
  player = { ...player, activeEncounter: { ...player.activeEncounter, systems: { ...player.activeEncounter.systems, weapons: 0 } } };
  const initial = clone(player.wallet);
  for (let i = 0; i < 40 && !player.activeEncounter.result; i++) player = beat(player);
  assert.equal(player.activeEncounter.result, 'loss');
  assert.equal(player.activeContract.stage, 'confrontation');
  assert.ok(player.activeEncounter.lossReason);
  assert.deepEqual(player.wallet, initial);
  const loaded = migratePlayer(clone(player));
  const recovered = recoverEncounter(loaded, { acceptanceId: loaded.activeEncounter.acceptanceId, revision: loaded.activeEncounter.revision });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.player.activeContract, null);
  assert.equal(recovered.player.activeEncounter, null);
  assert.ok(recovered.player.ship.hull >= 1);
  assert.deepEqual(recovered.player.wallet, initial);
  assert.equal(recoverEncounter(recovered.player, { acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision }).ok, false);
});

test('mismatched or corrupt encounter snapshots cannot pay rewards', () => {
  const player = normal({ staffWeapons: true });
  const mismatched = migratePlayer({ ...clone(player), activeEncounter: { ...clone(player.activeEncounter), acceptanceId: 'different' } });
  assert.equal(mismatched.activeEncounter, null);
  assert.equal(mismatched.activeContract, null, 'a broken crew fight cannot fall back to old combat');
  assert.equal(claimContractReward(mismatched, now).ok, false);
  const corrupt = migratePlayer({ ...clone(player), activeEncounter: { ...clone(player.activeEncounter), enemy: { hull: Number.NaN } } });
  assert.equal(corrupt.activeEncounter, null);
  assert.equal(claimContractReward(corrupt, now).ok, false);
  const wrongRoute = migratePlayer({ ...clone(player), activeEncounter: { ...clone(player.activeEncounter), seed: player.activeEncounter.seed + 1 } });
  assert.equal(wrongRoute.activeContract, null, 'route seed is part of saved fight identity');
  const told = beat(player);
  const badOrder = migratePlayer({ ...clone(told), activeEncounter: {
    ...clone(told.activeEncounter),
    orderWindow: { ...clone(told.activeEncounter.orderWindow), orderOptions: { brace: { cost: null } } },
  } });
  assert.equal(badOrder.activeContract, null, 'a broken saved order window cannot crash the combat UI');
  const malformedOrder = { ...clone(told.activeEncounter), orders: { brace: null, repair: { uses: 0 } } };
  const badNested = migratePlayer({ ...clone(told), activeEncounter: malformedOrder });
  assert.equal(badNested.activeContract, null, 'nested order state must be checked before reducer use');
  assert.equal(applyEncounterAction({ ...told, activeEncounter: malformedOrder }, {
    acceptanceId: told.activeContract.acceptanceId, revision: told.activeEncounter.revision, order: 'brace',
  }, now).ok, false);
  const badBraceWindow = migratePlayer({ ...clone(told), activeEncounter: {
    ...clone(told.activeEncounter), braceThroughBeat: null,
  } });
  assert.equal(badBraceWindow.activeContract, null);
  const missingMode = migratePlayer({ ...clone(told), activeContract: { ...clone(told.activeContract), encounterMode: null } });
  assert.equal(missingMode.activeContract, null, 'new fight with lost mode cannot become a legacy fight');
  assert.equal(missingMode.activeEncounter, null);
  const won = (() => { let current = player; for (let i = 0; i < 30 && !current.activeEncounter.result; i++) current = beat(current); return current; })();
  const impossibleWin = migratePlayer({ ...clone(won), activeEncounter: {
    ...clone(won.activeEncounter), enemy: { ...clone(won.activeEncounter.enemy), hull: 1 },
  } });
  assert.equal(impossibleWin.activeContract, null, 'a claimed victory requires a defeated enemy');
  const zeroBeatWin = { ...clone(won), activeEncounter: {
    ...clone(won.activeEncounter), beat: 0, revision: 0, eventIndex: 0,
  } };
  assert.equal(migratePlayer(zeroBeatWin).activeContract, null, 'a terminal win cannot predate its first combat beat');
  assert.equal(claimContractReward(zeroBeatWin, now).ok, false, 'a forged zero-beat win cannot pay directly');
  const brokenProgression = { ...clone(won), activeContract: { ...clone(won.activeContract), revision: won.activeContract.revision + 1 } };
  assert.equal(migratePlayer(brokenProgression).activeContract, null, 'saved contract and combat revisions must advance together');
  const directModeLoss = { ...won, activeContract: { ...won.activeContract, encounterMode: null } };
  assert.equal(claimContractReward(directModeLoss, now).ok, false);
});

test('the active UI exposes truthful costs and an always available advance action', () => {
  const player = normal();
  const beforeTell = sessionModels(player, {}, now).activeContractView;
  let html = renderActiveContract(beforeTell);
  assert.match(html, /data-act="encounter-advance"/);
  assert.doesNotMatch(html, /Choose Burn/);
  const told = beat(player);
  html = renderActiveContract(sessionModels(told, {}, now).activeContractView);
  assert.match(html, /Brace/);
  assert.match(html, /2 shield/);
  assert.match(html, /data-act="encounter-order"/);
  assert.match(html, /data-act="encounter-advance"/);
  assert.match(html, /Halves next hit/);
  assert.match(html, /3-beat cooldown/);
  assert.match(html, /Restore up to 8 hull/);
  const afterOrder = beat(told, 'brace');
  const countdown = sessionModels(afterOrder, {}, now).activeContractView.encounter;
  assert.equal(countdown.beatsToImpact, 1, 'the threat stays visible after the order window closes');
  assert.match(renderActiveContract(sessionModels(afterOrder, {}, now).activeContractView), /Incoming fire at hull · 1 beat/);
  assert.doesNotMatch(renderActiveContract(sessionModels(afterOrder, {}, now).activeContractView), /1 beats/);
  assert.match(renderShipEncounter(sessionModels(told, {}, now).activeContractView), /data-act="encounter-order"/);
  assert.match(renderShipEncounter(sessionModels(told, {}, now).activeContractView), /data-act="encounter-advance"/);
  const shipOverlay = renderOverlays(told, { isHome: true, selectedRoom: null, activeContractView: sessionModels(told, {}, now).activeContractView });
  assert.match(shipOverlay, /class="ship-encounter"/);
  assert.match(shipOverlay, /data-act="encounter-advance"/);
});

test('entering a new fight keeps controls with the visible ship', () => {
  let accepted = createNewPlayer({ now, rng: () => 0.1 });
  accepted = { ...accepted, tutorial: { ...accepted.tutorial, script: 4 },
    contractBoard: { dayKey: 'tutorial', offers: [tutorialDistressOffer(accepted)], completedOfferIds: [] } };
  accepted = acceptContract(accepted, 'offer_tutorial_distress', now).player;
  const result = sessionAction(accepted, {}, 'contract-action', {
    action: 'launch', revision: 0, acceptanceId: accepted.activeContract.acceptanceId,
  }, { now });
  assert.equal(result.ok, true);
  assert.equal(result.ui.tab, 'ship');
  assert.equal(result.player.activeEncounter.kind, 'guided');
});

test('a failed durable save publishes neither beat state nor effects', () => {
  const player = normal();
  const result = sessionAction(player, {}, 'encounter-advance', { acceptanceId: player.activeEncounter.acceptanceId, revision: 0 }, { now });
  assert.equal(result.ok, true);
  const calls = [];
  assert.equal(persistSessionTransition(result, { save: () => false, publish: () => calls.push('publish'), capture: () => calls.push('capture'), animate: () => calls.push('animate') }).reason, 'save_failed');
  assert.deepEqual(calls, []);
  assert.equal(player.activeEncounter.revision, 0);
});

test('a terminal beat does not enter travel-result logging after its save', () => {
  let player = normal({ staffWeapons: true });
  let result;
  for (let i = 0; i < 30 && !player.activeEncounter.result; i++) {
    result = sessionAction(player, {}, 'encounter-advance', {
      acceptanceId: player.activeEncounter.acceptanceId,
      revision: player.activeEncounter.revision,
    }, { now });
    assert.equal(result.ok, true);
    player = result.player;
  }
  assert.equal(result.effect.kind, 'encounter-beat');
  assert.equal(result.effect.result, undefined, 'travel logging consumes effect.result as a route object');
  assert.equal(result.effect.outcome, 'win');
});

test('battle visuals use the saved hull and emitted hit directions', () => {
  const encounter = normal().activeEncounter;
  const frame = encounterVisualFrame({ ...encounter, hull: 15, enemy: { ...encounter.enemy, hull: 21 } }, [
    { type: 'weapon_damage', target: 'enemy', amount: 5 },
    { type: 'enemy_impact', target: 'weapons', hullAmount: 3 },
  ]);
  assert.equal(frame.playerHull, 0.5);
  assert.equal(frame.enemyHull, 0.5);
  assert.deepEqual(frame.shots.map(shot => shot.ally), [true, false]);
});
