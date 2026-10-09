import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { chooseCaptain } from '../src/systems/captainFirstPlay.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction, claimContractReward, tutorialDistressOffer } from '../src/systems/contracts.js';
import { applyEncounterAction, applyEncounterCommand, normalizeEncounterState, recoverEncounter } from '../src/systems/encounterState.js';
import { hireFirstCrew } from '../src/systems/tutorialV5.js';
import { sessionAction, sessionModels, persistSessionTransition } from '../src/systems/sessionLoop.js';
import { renderActiveContract, renderShipEncounter } from '../src/ui/contractView.js';
import { encounterVisualFrame } from '../src/ui/combatView.js';
import { startEncounter } from '../src/systems/autoCombat.js';
import { stationOutputs, normalizeAssignments } from '../src/systems/stations.js';
import { contractThreat, unlockedTactics } from '../src/systems/encounterState.js';
import { manning } from '../src/systems/ftlCombat.js';
import { fightHullLoss } from '../src/systems/encounterState.js';
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
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, script }, contractBoard: { dayKey: 'tutorial', offers: [tutorialDistressOffer(player)], completedOfferIds: [] } };
  player = acceptContract(player, 'offer_tutorial_distress', now).player;
  return action(player, 'launch');
};
const normal = ({ staffWeapons = false } = {}) => {
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
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
/** A save from before FTL-lite: the same contract fight, saved as a v1/v2 beat fight. */
const legacyNormal = (options = {}) => {
  const player = normal(options);
  const c = player.activeContract;
  const outputs = Object.fromEntries(Object.entries(stationOutputs(player, now)).map(([id, o]) => [id, o.total]));
  return { ...player, activeEncounter: startEncounter({ acceptanceId: c.acceptanceId, encounterId: c.encounterId, kind: 'normal',
    ruleset: c.encounterId === 'pirate_scout' ? 'v2' : 'v1', seed: c.routeSeed, assignments: normalizeAssignments(player), outputs,
    threat: contractThreat(player, c, now), tactics: unlockedTactics(player) }) };
};
const captainGuided = templateId => {
  let player = createNewPlayer({ now, rng: () => 0.1 });
  player = chooseCaptain(player, { templateId, name: 'Captain', rng: () => 0.1 }).player;
  player = hireFirstCrew({ ...player, tutorial: { ...player.tutorial, phase: 'hire' } }, { rng: () => 0.2 }).player;
  const firstHire = player.crew.find(member => member.instanceId === player.tutorial.firstHireInstanceId);
  player = { ...player,
    stationAssignments: { ...player.stationAssignments,
      [firstHire.instanceId]: firstHire.templateId === 'merc_bolt' ? 'shields' : 'weapons' },
    tutorial: { ...player.tutorial, phase: 'fight' },
    contractBoard: { dayKey: 'tutorial', offers: [tutorialDistressOffer(player)], completedOfferIds: [] } };
  player = acceptContract(player, 'offer_tutorial_distress', now).player;
  return action(player, 'launch');
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
  // FTL-lite: the fighting crew stand at their stations; a manned room works better than an empty one.
  assert.equal(player.activeEncounter.version, 3);
  const staffed = beat(player);
  const helm = staffed.activeEncounter.crew.find(member => member.station === 'helm');
  assert.ok(helm, 'the captain fights from the helm');
  assert.ok(manning(staffed.activeEncounter, 'helm') > 1, 'a manned station is faster');
  assert.equal(manning(staffed.activeEncounter, 'engineering'), 1, 'an empty station runs at baseline');
  assert.equal(beat(staffed).wallet.fuel, fuel, 'beats never spend route fuel again');
});

test('a saved win claims its route reward once, after the final beat', () => {
  let player = normal({ staffWeapons: true });
  const initial = clone(player.wallet);
  for (let i = 0; i < 200 && !player.activeEncounter.result; i++) player = beat(player);
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

test('a lost normal fight settles to salvage once, and a legacy saved loss still recovers', () => {
  let player = normal();
  // Weapons room wrecked and nobody aboard to repair it: the crew cannot win.
  const wrecked = clone(player.activeEncounter);
  wrecked.rooms.weapons.integrity = 0;
  wrecked.crew = [];
  player = { ...player, activeEncounter: wrecked };
  const initial = clone(player.wallet);
  for (let i = 0; i < 300 && !player.activeEncounter.result; i++) player = beat(player);
  assert.equal(player.activeEncounter.result, 'loss');
  assert.equal(player.activeContract.stage, 'return', 'a crew loss resolves to the salvage payout');
  assert.equal(player.activeContract.result.success, false);
  assert.equal(player.activeContract.result.hullLoss, fightHullLoss(player.activeEncounter));
  assert.ok(player.activeContract.result.rewards.credits >= 8);
  assert.deepEqual(player.wallet, initial, 'salvage is paid only on claim');
  const loaded = migratePlayer(clone(player));
  assert.equal(loaded.activeContract.stage, 'return', 'a settled loss survives reload');
  const claimed = claimContractReward(loaded, now);
  assert.equal(claimed.ok, true, claimed.reason);
  assert.equal(claimed.player.wallet.credits, initial.credits + player.activeContract.result.rewards.credits);
  assert.equal(claimContractReward(claimed.player, now).ok, false);

  // Saves from before salvage kept a lost fight at confrontation awaiting recovery.
  const legacy = { ...loaded, activeContract: { ...loaded.activeContract, stage: 'confrontation', result: null } };
  const legacyLoaded = migratePlayer(clone(legacy));
  const recovered = recoverEncounter(legacyLoaded, { acceptanceId: legacyLoaded.activeEncounter.acceptanceId, revision: legacyLoaded.activeEncounter.revision });
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(recovered.player.activeContract, null);
  assert.deepEqual(recovered.player.wallet, initial);
});


test('script-5 distress is a guided FTL-lite fight for every captain, and the targeted win survives reload', () => {
  for (const templateId of ['captain_cyborg', 'captain_gunner', 'captain_alien', 'captain_droid']) {
    let player = captainGuided(templateId);
    const encounter = player.activeEncounter;
    assert.equal(encounter.version, 3, templateId);
    assert.equal(encounter.guided, true, templateId);
    assert.equal(encounter.enemy.threat, 0.6, 'an easy first enemy');
    assert.equal(encounter.enemy.hull, 25);
    assert.equal(Object.hasOwn(encounter, 'tactics'), false, 'no tactics in the first fight');
    assert.equal(Object.hasOwn(encounter, 'boarders'), false, 'no boarders in the first fight');
    assert.ok(encounter.crew.some(member => member.station), templateId);
    const id = { acceptanceId: encounter.acceptanceId, revision: encounter.revision };
    const targeted = applyEncounterCommand(player, { ...id, command: { type: 'target', room: 'weapons' } });
    assert.equal(targeted.ok, true, templateId);
    player = migratePlayer(clone(targeted.player));
    assert.equal(player.activeEncounter.intent.target, 'weapons', 'the target survives reload');
    for (let i = 0; i < 60 && !player.activeEncounter.result; i++) player = beat(player);
    assert.equal(player.activeEncounter.result, 'win', templateId);
    assert.ok(player.activeEncounter.beat >= 12 && player.activeEncounter.beat <= 30, `first fight lasts 12-30 s (${player.activeEncounter.beat})`);
    assert.equal(player.activeContract.stage, 'return', templateId);
  }
});

test('a saved script-4 fight retains its v1 Brace path and reward', () => {
  const started = guided(4);
  assert.equal(started.activeEncounter.version, 1);
  const saved = { activeContract: clone(started.activeContract), activeEncounter: clone(started.activeEncounter), tutorial: clone(started.tutorial) };
  assert.deepEqual(normalizeEncounterState(saved), saved);
  let player = migratePlayer(clone(started));
  player = beat(player);
  assert.deepEqual(Object.keys(player.activeEncounter.orderWindow.orderOptions), ['brace']);
  player = beat(player, 'brace');
  for (let i = 0; i < 20 && !player.activeEncounter.result; i++) player = beat(player);
  assert.equal(player.activeEncounter.result, 'win');
  assert.deepEqual(player.activeContract.result.rewards, { credits: 120, medals: 8, reputation: 4, gems: 0, fuel: 0 });
});

test('a saved script-4 distress fight cannot adopt v2 target weapons on reload or action', () => {
  const opened = beat(guided(4));
  assert.equal(opened.activeEncounter.version, 1);
  const original = clone(opened.activeEncounter);
  const targetOption = { cost: { shield: 0 }, available: true, reason: null, cooldownBeats: 0 };
  const forged = { ...clone(opened), activeEncounter: {
    ...original, version: 2,
    enemy: { ...original.enemy, weaponDisabledThroughBeat: 0 },
    orders: { ...original.orders, targetWeapons: { used: false, uses: 0 } },
    orderWindow: { ...original.orderWindow,
      availableOrders: [...original.orderWindow.availableOrders, 'target_weapons'],
      orderOptions: { ...original.orderWindow.orderOptions, target_weapons: targetOption } },
  } };
  assert.equal(normalizeEncounterState(forged).activeContract, null);
  assert.equal(migratePlayer(clone(forged)).activeContract, null);
  const attempt = applyEncounterAction(forged, {
    acceptanceId: forged.activeEncounter.acceptanceId,
    revision: forged.activeEncounter.revision,
    order: 'target_weapons',
  }, now);
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'invalid_encounter_state');
});

test('a malformed v2 target option cannot fall through to a legacy claim', () => {
  const downgraded = legacyNormal();
  downgraded.activeEncounter = { ...downgraded.activeEncounter, version: 1 };
  assert.equal(migratePlayer(clone(downgraded)).activeContract, null,
    'a v2 snapshot with its version changed cannot become a payable v1 fight');
  const opened = beat(legacyNormal());
  assert.equal(opened.activeEncounter.version, 2);
  const malformed = { ...clone(opened), activeEncounter: { ...clone(opened.activeEncounter),
    orderWindow: { ...clone(opened.activeEncounter.orderWindow),
      orderOptions: { ...clone(opened.activeEncounter.orderWindow.orderOptions), target_weapons: { cost: { shield: 2 }, available: true, reason: null, cooldownBeats: 0 } } } } };
  assert.equal(applyEncounterAction(malformed, {
    acceptanceId: malformed.activeEncounter.acceptanceId, revision: malformed.activeEncounter.revision, order: 'target_weapons',
  }, now).ok, false);
  const loaded = migratePlayer(malformed);
  assert.equal(loaded.activeEncounter, null);
  assert.equal(loaded.activeContract, null);
  assert.equal(claimContractReward(loaded, now).ok, false);
  for (const change of [
    { orders: { ...clone(opened.activeEncounter.orders), targetWeapons: null } },
    { enemy: { ...clone(opened.activeEncounter.enemy), weaponDisabledThroughBeat: null } },
  ]) {
    const broken = { ...clone(opened), activeEncounter: { ...clone(opened.activeEncounter), ...change } };
    assert.equal(migratePlayer(broken).activeContract, null);
    assert.equal(claimContractReward(broken, now).ok, false);
  }
});

test('mismatched or corrupt encounter snapshots cannot pay rewards', () => {
  const player = legacyNormal({ staffWeapons: true });
  // The same identity rules guard new FTL-lite saves.
  const ftl = normal({ staffWeapons: true });
  assert.equal(migratePlayer({ ...clone(ftl), activeEncounter: { ...clone(ftl.activeEncounter), acceptanceId: 'different' } }).activeContract, null);
  assert.equal(migratePlayer({ ...clone(ftl), activeEncounter: { ...clone(ftl.activeEncounter), seed: ftl.activeEncounter.seed + 1 } }).activeContract, null);
  assert.equal(migratePlayer({ ...clone(ftl), activeEncounter: { ...clone(ftl.activeEncounter), hull: 250 } }).activeContract, null);
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

test('the active UI exposes truthful costs and runs normal fights on a real-time beat', () => {
  const player = normal();
  // Missions tab: the fight is on the ship, with a way there.
  let html = renderActiveContract(sessionModels(player, {}, now).activeContractView);
  assert.match(html, /The fight plays out on the ship/);
  assert.match(html, /data-act="goto-ship"/);
  assert.doesNotMatch(html, /data-act="encounter-advance"/, 'normal fights advance on their own');
  // Ship tab: the controls strip, with weapons, Hold and crew, and no manual advance.
  const told = beat(player);
  const view = sessionModels(told, {}, now).activeContractView;
  html = renderShipEncounter(view);
  assert.match(html, /class="ftl-controls"/);
  assert.match(html, /Burst Laser/);
  assert.match(html, /data-command-type="hold"/);
  assert.match(html, /data-act="ftl-select-crew"/);
  assert.doesNotMatch(html, /data-act="encounter-advance"/);
  assert.equal(view.encounter.beatMs, 1000, 'one beat per second');
  const failed = { guidedBeatSaveFailed: { acceptanceId: told.activeEncounter.acceptanceId, revision: told.activeEncounter.revision } };
  assert.match(renderShipEncounter(sessionModels(told, failed, now).activeContractView), /data-act="encounter-advance"[^>]*>Retry fight progress/, 'a failed save offers a retry');
  // Over the ship view: only the zoom toggle; the enemy and controls have their own slots.
  const shipOverlay = renderOverlays(told, { isHome: true, selectedRoom: null, activeContractView: view });
  assert.match(shipOverlay, /data-camera="ftl-zoom"/);
});

test('entering a new fight keeps controls with the visible ship', () => {
  let ready = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  const bolt = ready.crew.find(member => member.templateId === 'merc_bolt');
  ready = { ...ready, tutorial: { ...ready.tutorial, phase: 'fight' },
    stationAssignments: { ...ready.stationAssignments, [bolt.instanceId]: 'shields' },
    contractBoard: { dayKey: 'tutorial', offers: [tutorialDistressOffer(ready)], completedOfferIds: [] } };
  const result = sessionAction(ready, {}, 'tutorial-fight-start', {}, { now });
  assert.equal(result.ok, true);
  assert.equal(result.ui.tab, 'ship');
  assert.equal(result.player.activeEncounter.kind, 'guided');
  assert.ok(result.player.activeEncounter.orderWindow);
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
  for (let i = 0; i < 120 && !player.activeEncounter.result; i++) {
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
