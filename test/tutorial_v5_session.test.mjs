import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction, persistSessionTransition } from '../src/systems/sessionLoop.js';
import * as main from '../src/main.js';

const now = Date.UTC(2030, 8, 23, 12);
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));
const fresh = () => prepareSession(createNewPlayer({ now, rng: () => 0.1 }), now);
const contractIdentity = player => ({ acceptanceId: player.activeContract.acceptanceId, revision: player.activeContract.revision });
const encounterIdentity = player => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });

function act(player, action, data = {}, { save = () => true, rng = () => 0.1 } = {}) {
  const result = sessionAction(player, {}, action, data, { now, rng });
  assert.ok(result, `${action} must use the session transition boundary`);
  if (!result.ok) return result;
  let published = player;
  const captures = [];
  const animations = [];
  const committed = persistSessionTransition(result, {
    save,
    publish: value => { published = value.player; },
    capture: (name, fields) => captures.push({ name, fields }),
    animate: effect => animations.push(effect),
  });
  return { ...committed, player: reload(published), captures, animations };
}

function staffed() {
  let player = reload(act(fresh(), 'splash-dismiss').player);
  player = act(player, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }).player;
  player = act(player, 'tutorial-first-hire').player;
  player = act(player, 'station-assign', { id: player.tutorial.firstHireInstanceId, station: 'weapons' }).player;
  return player;
}

function guidedWin(player) {
  player = act(player, 'tutorial-fight-start').player;
  player = act(player, 'encounter-order', { ...encounterIdentity(player), order: 'target_weapons' }).player;
  for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) {
    player = act(player, 'encounter-advance', encounterIdentity(player)).player;
  }
  assert.equal(player.tutorial.phase, 'claim');
  return player;
}

test('committed script-5 captain, hire, target order, claim, name, pull and Skip survive every reload once', () => {
  let player = fresh();
  assert.equal(player.tutorial.script, 5);
  assert.deepEqual(player.crew, []);
  assert.equal(player.contractBoard.offers.length, 1);
  player = act(player, 'splash-dismiss').player;
  assert.equal(player.tutorial.phase, 'captain');
  assert.equal(act(player, 'tutorial-first-hire').ok, false);
  player = act(player, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }).player;
  assert.equal(player.tutorial.script, 5);
  assert.equal(player.tutorial.phase, 'hire');
  assert.equal(player.crew[0].name, 'Rook');
  assert.equal(act(player, 'captain-choose', { templateId: 'captain_gunner', name: 'Again' }).ok, false);
  const hired = act(player, 'tutorial-first-hire');
  player = hired.player;
  assert.deepEqual(player.crew.map(c => c.templateId), ['captain_cyborg', 'merc_jen']);
  assert.equal(player.tutorial.phase, 'assign');
  assert.equal(player.tutorial.firstHireUsed, true);
  assert.equal(hired.animations[0]?.kind, 'crew-arrival');
  assert.equal(hired.animations[0]?.crewInstanceId, player.tutorial.firstHireInstanceId);
  assert.equal(hired.captures.filter(item => item.name === 'crew_arrived').length, 1);
  assert.equal(act(player, 'tutorial-first-hire').ok, false);
  assert.equal(act(player, 'station-assign', { id: player.captainInstanceId, station: 'weapons' }).ok, false);
  const forgedHire = { ...player, tutorial: { ...player.tutorial, firstHireInstanceId: player.captainInstanceId } };
  assert.equal(act(forgedHire, 'station-assign', { id: player.captainInstanceId, station: 'weapons' }).ok, false);
  player = act(player, 'station-assign', { id: player.tutorial.firstHireInstanceId, station: 'weapons' }).player;
  assert.equal(player.tutorial.phase, 'fight');
  assert.equal(act(player, 'contract-review', { offer: 'offer_tutorial_distress' }).ok, false);
  const fuel = player.wallet.fuel;
  player = act(player, 'tutorial-fight-start').player;
  assert.equal(player.activeContract.profile, 'distress');
  assert.equal(player.activeEncounter.version, 2);
  assert.equal(player.activeEncounter.kind, 'guided');
  assert.equal(player.wallet.fuel, fuel - 1);
  assert.equal(act(player, 'encounter-advance', encounterIdentity(player)).ok, false);
  assert.equal(act(player, 'encounter-order', { ...encounterIdentity(player), order: 'brace' }).ok, false);
  assert.equal(act(player, 'encounter-order', { acceptanceId: 'forged', revision: player.activeEncounter.revision, order: 'target_weapons' }).ok, false);
  player = act(player, 'encounter-order', { ...encounterIdentity(player), order: 'target_weapons' }).player;
  assert.equal(player.activeEncounter.orders.targetWeapons.used, true);
  for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) {
    player = act(player, 'encounter-advance', encounterIdentity(player)).player;
  }
  assert.equal(player.tutorial.phase, 'claim');
  assert.equal(player.activeContract.stage, 'return');
  assert.equal(player.wallet.fuel, fuel - 1);
  const beforeClaim = { ...player.wallet };
  const reward = { ...player.activeContract.result.rewards };
  const claimIdentity = contractIdentity(player);
  const missingWin = { ...player, tutorial: { ...player.tutorial, firstWin: false } };
  assert.equal(act(missingWin, 'contract-claim', claimIdentity).ok, false);
  assert.equal(act(player, 'contract-claim', { ...claimIdentity, acceptanceId: 'forged' }).ok, false);
  player = act(player, 'contract-claim', claimIdentity).player;
  assert.equal(player.tutorial.phase, 'name_ship');
  assert.equal(player.tutorial.script, 5);
  assert.equal(player.crewSlots, 3);
  assert.equal(player.flags.berth3Opened, true);
  assert.equal(player.flags.sparrowFirstRepair, true);
  assert.equal(player.wallet.credits, beforeClaim.credits + reward.credits);
  assert.equal(player.wallet.reputation, beforeClaim.reputation + reward.reputation);
  assert.equal(player.contractBoard.completedOfferIds.filter(id => id === 'offer_tutorial_distress').length, 1);
  assert.equal(act(player, 'contract-claim', claimIdentity).ok, false);
  player = act(player, 'tutorial-name', { name: 'The Sparrow' }).player;
  assert.equal(player.tutorial.phase, 'pull');
  assert.equal(player.tutorial.script, 5);
  assert.equal(player.ship.name, 'The Sparrow');
  assert.equal(act(player, 'tutorial-name', { name: 'Again' }).ok, false);
  player = act(player, 'tutorial-welcome-pull', {}, { rng: () => 0.5 }).player;
  assert.equal(player.tutorial.phase, 'register');
  assert.equal(player.crew.length, 3);
  assert.equal(player.reserve.length, 0);
  assert.equal(player.gacha.pulls, 1);
  assert.equal(player.gacha.history[0].source, 'welcome');
  assert.equal(act(player, 'tutorial-welcome-pull').ok, false);
  player = act(player, 'tutorial-register-skip').player;
  assert.equal(player.tutorial.phase, 'done');
  assert.equal(player.tutorial.completed, true);
  assert.equal(player.tutorial.registered, false);
  assert.equal(player.contractBoard.offers.length, 3);
  assert.equal(player.wallet.credits, beforeClaim.credits + reward.credits);
  assert.equal(player.gacha.pulls, 1);
  assert.equal(act(player, 'tutorial-register-skip').ok, false);
});

test('save failure publishes no captain, hire, target order, or reward claim', () => {
  let player = act(fresh(), 'splash-dismiss').player;
  let failed = act(player, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }, { save: () => false });
  assert.equal(failed.reason, 'save_failed');
  assert.deepEqual(failed.player.crew, []);
  assert.deepEqual(failed.captures, []);
  assert.deepEqual(failed.animations, []);
  player = act(player, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }).player;
  failed = act(player, 'tutorial-first-hire', {}, { save: () => false });
  assert.equal(failed.reason, 'save_failed');
  assert.equal(failed.player.crew.length, 1);
  assert.equal(failed.player.tutorial.firstHireUsed, false);
  assert.deepEqual(failed.captures, []);
  assert.deepEqual(failed.animations, []);
  player = act(player, 'tutorial-first-hire').player;
  player = act(player, 'station-assign', { id: player.tutorial.firstHireInstanceId, station: 'weapons' }).player;
  player = act(player, 'tutorial-fight-start').player;
  failed = act(player, 'encounter-order', { ...encounterIdentity(player), order: 'target_weapons' }, { save: () => false });
  assert.equal(failed.reason, 'save_failed');
  assert.equal(failed.player.activeEncounter.orders.targetWeapons.used, false);
  assert.deepEqual(failed.captures, []);
  assert.deepEqual(failed.animations, []);
  player = act(player, 'encounter-order', { ...encounterIdentity(player), order: 'target_weapons' }).player;
  for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) player = act(player, 'encounter-advance', encounterIdentity(player)).player;
  assert.equal(player.tutorial.phase, 'claim');
  const wallet = { ...player.wallet };
  failed = act(player, 'contract-claim', contractIdentity(player), { save: () => false });
  assert.equal(failed.reason, 'save_failed');
  assert.deepEqual(failed.player.wallet, wallet);
  assert.equal(failed.player.crewSlots, 2);
  assert.equal(failed.player.activeContract.stage, 'return');
  assert.deepEqual(failed.captures, []);
  assert.deepEqual(failed.animations, []);
});

test('a reloaded fight with a missing saved first hire cannot launch or claim a payout', () => {
  const ready = staffed();
  const captain = ready.crew.find(member => member.isCaptain);
  const corrupted = reload({
    ...ready,
    crew: [captain],
    stationAssignments: { [captain.instanceId]: 'helm' },
    tutorial: { ...ready.tutorial, phase: 'fight', firstHireUsed: true, firstHireInstanceId: 'missing' },
  });
  assert.equal(corrupted.tutorial.phase, 'hire');
  assert.equal(corrupted.tutorial.firstHireInstanceId, null);
  const wallet = { ...corrupted.wallet };
  const launch = act(corrupted, 'tutorial-fight-start');
  assert.equal(launch.ok, false);
  assert.equal(launch.player.activeContract, null);
  assert.equal(launch.player.activeEncounter, null);
  assert.deepEqual(launch.player.wallet, wallet);
  const claim = act(reload(launch.player), 'contract-claim', { acceptanceId: 'forged', revision: 0 });
  assert.equal(claim.ok, false);
  assert.deepEqual(claim.player.wallet, wallet);
});

test('a missing saved first hire returns to one free hire after reload', () => {
  const ready = staffed();
  const captain = ready.crew.find(member => member.isCaptain);
  const corrupted = reload({
    ...ready,
    crew: [captain],
    stationAssignments: { [captain.instanceId]: 'helm' },
  });
  assert.equal(corrupted.tutorial.phase, 'hire');
  assert.equal(corrupted.tutorial.firstHireUsed, false);
  assert.equal(corrupted.tutorial.firstHireInstanceId, null);
  const hired = act(corrupted, 'tutorial-first-hire');
  assert.equal(hired.ok, true);
  assert.equal(hired.player.crew.length, 2);
  assert.equal(hired.player.crew.filter(member => member.isCaptain).length, 1);
  assert.equal(act(hired.player, 'tutorial-first-hire').ok, false);
  const assigned = act(hired.player, 'station-assign', {
    id: hired.player.tutorial.firstHireInstanceId, station: 'weapons',
  });
  assert.equal(assigned.player.tutorial.phase, 'fight');
  assert.equal(act(assigned.player, 'tutorial-fight-start').ok, true);
});

test('a stale first-hire ID finds the existing recruit instead of granting another', () => {
  const ready = staffed();
  const corrupted = reload({ ...ready, tutorial: {
    ...ready.tutorial, phase: 'fight', firstHireInstanceId: 'missing', firstHireUsed: true,
  } });
  assert.equal(corrupted.tutorial.phase, 'fight');
  assert.equal(corrupted.tutorial.firstHireInstanceId, ready.crew[1].instanceId);
  assert.equal(corrupted.crew.length, 2);
  assert.equal(act(corrupted, 'tutorial-first-hire').ok, false);
});

test('a corrupted saved v5 fight retries without charging launch fuel twice', () => {
  let player = act(staffed(), 'tutorial-fight-start').player;
  const spentFuel = player.wallet.fuel;
  const credits = player.wallet.credits;
  player = reload({ ...player, activeEncounter: { ...player.activeEncounter, seed: player.activeEncounter.seed + 1 } });
  assert.equal(player.activeContract, null);
  assert.equal(player.activeEncounter, null);
  assert.equal(player.tutorial.phase, 'fight');
  assert.equal(player.tutorial.contractRecoveryFuelSpent, 1);
  player = act(player, 'tutorial-fight-start').player;
  assert.equal(player.wallet.fuel, spentFuel);
  assert.equal(player.wallet.credits, credits);
  assert.equal(player.activeEncounter.version, 2);
});

test('malformed v5 contract revision keeps paid launch credit on retry', () => {
  let player = act(staffed(), 'tutorial-fight-start').player;
  const fuel = player.wallet.fuel;
  const credits = player.wallet.credits;
  const acceptance = player.activeContract.acceptanceId;
  player = reload({ ...player, activeContract: { ...player.activeContract, revision: 'bad' } });
  assert.equal(player.activeContract, null);
  assert.equal(player.activeEncounter, null);
  assert.equal(player.tutorial.phase, 'fight');
  assert.equal(player.tutorial.contractRecoveryFuelSpent, 1);
  const retried = act(player, 'tutorial-fight-start');
  assert.equal(retried.ok, true);
  assert.equal(retried.player.wallet.fuel, fuel);
  assert.equal(retried.player.wallet.credits, credits);
  assert.notEqual(retried.player.activeContract.acceptanceId, acceptance);
  assert.deepEqual(retried.player.contractBoard.completedOfferIds, []);
  assert.equal(retried.player.gacha.pulls, 0);
});

for (const [label, corrupt] of [
  ['missing return rewards', player => ({ ...player, activeContract: {
    ...player.activeContract, result: { ...player.activeContract.result, rewards: null },
  } })],
  ['missing return encounter', player => ({ ...player, activeEncounter: null })],
  ['unsupported return encounter version', player => ({ ...player, activeEncounter: {
    ...player.activeEncounter, version: 3,
  } })],
]) {
  test(`corrupt v5 claim with ${label} recovers a single paid guided retry`, () => {
    const won = guidedWin(staffed());
    const fuel = won.wallet.fuel;
    const credits = won.wallet.credits;
    const staleClaim = contractIdentity(won);
    const recovered = reload(corrupt(won));
    assert.equal(recovered.tutorial.phase, 'fight');
    assert.equal(recovered.tutorial.firstWin, false);
    assert.equal(recovered.tutorial.contractRecoveryFuelSpent, 1);
    assert.equal(recovered.activeContract, null);
    assert.equal(recovered.activeEncounter, null);
    assert.deepEqual(recovered.contractBoard.completedOfferIds, []);
    assert.equal(act(recovered, 'contract-claim', staleClaim).ok, false);
    const restarted = act(recovered, 'tutorial-fight-start');
    assert.equal(restarted.ok, true);
    let player = restarted.player;
    assert.equal(player.wallet.fuel, fuel);
    assert.equal(player.wallet.credits, credits);
    assert.notEqual(player.activeContract.acceptanceId, staleClaim.acceptanceId);
    player = act(player, 'encounter-order', { ...encounterIdentity(player), order: 'target_weapons' }).player;
    for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) {
      player = act(player, 'encounter-advance', encounterIdentity(player)).player;
    }
    assert.equal(player.tutorial.phase, 'claim');
    assert.equal(player.wallet.credits, credits);
    assert.equal(player.gacha.pulls, 0);
    const claim = contractIdentity(player);
    player = act(player, 'contract-claim', claim).player;
    assert.equal(player.wallet.credits, credits + 120);
    assert.deepEqual(player.contractBoard.completedOfferIds, ['offer_tutorial_distress']);
    assert.equal(act(player, 'contract-claim', claim).ok, false);
    assert.equal(player.gacha.pulls, 0);
  });
}

test('corrupted v5 welcome flags reconcile to recorded pull without another recruit', () => {
  let player = guidedWin(staffed());
  player = act(player, 'contract-claim', contractIdentity(player)).player;
  player = act(player, 'tutorial-name', { name: 'Sparrow' }).player;
  player = act(player, 'tutorial-welcome-pull').player;
  const originalId = player.tutorial.welcomeInstanceId;
  const corrupted = reload({ ...player, tutorial: {
    ...player.tutorial, phase: 'pull', welcomePulled: false, welcomeInstanceId: null,
  } });
  assert.equal(corrupted.tutorial.phase, 'register');
  assert.equal(corrupted.tutorial.welcomePulled, true);
  assert.equal(corrupted.tutorial.welcomeInstanceId, originalId);
  assert.equal(act(corrupted, 'tutorial-welcome-pull').ok, false);
  assert.equal(corrupted.gacha.pulls, 1);
  assert.equal(corrupted.crew.length, 3);
  assert.equal(act(corrupted, 'tutorial-register-skip').player.tutorial.phase, 'done');
});

test('v5 launch requires the actual matched hire at its assigned station', () => {
  const ready = staffed();
  const captain = ready.crew.find(member => member.isCaptain);
  const hired = ready.crew.find(member => member.instanceId === ready.tutorial.firstHireInstanceId);
  const corruptions = [
    ['captain forged as hire', { tutorial: { ...ready.tutorial, firstHireInstanceId: captain.instanceId } }],
    ['Jen unassigned', { stationAssignments: { ...ready.stationAssignments, [hired.instanceId]: null } }],
    ['Bolt forged for pilot', { crew: [captain, { ...hired, templateId: 'merc_bolt' }],
      stationAssignments: { ...ready.stationAssignments, [hired.instanceId]: 'shields' } }],
  ];
  for (const [label, changes] of corruptions) {
    const corrupted = reload({ ...ready, ...changes });
    const result = act(corrupted, 'tutorial-fight-start');
    assert.equal(result.ok, false, label);
    assert.equal(result.player.activeContract, null, label);
  }

  let gunner = act(fresh(), 'splash-dismiss').player;
  gunner = act(gunner, 'captain-choose', { templateId: 'captain_gunner', name: 'Mara' }).player;
  gunner = act(gunner, 'tutorial-first-hire').player;
  assert.equal(gunner.crew[1].templateId, 'merc_bolt');
  gunner = act(gunner, 'station-assign', { id: gunner.tutorial.firstHireInstanceId, station: 'shields' }).player;
  assert.equal(gunner.tutorial.phase, 'fight');
  assert.equal(act(gunner, 'tutorial-fight-start').ok, true);
});

test('saved script-4 players never switch to script 5', () => {
  const saved = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  const loaded = reload(saved);
  assert.equal(loaded.tutorial.script, 4);
  assert.deepEqual(loaded.crew.map(c => c.templateId), ['merc_rex', 'merc_bolt']);
});

test('v5 entry stays on ship and fresh-boot roster text reflects the saved crew', () => {
  const empty = fresh();
  assert.equal(main.resolveEntryTab(empty, { notification_type: 'daily_pull' }, 'ship'), 'ship');
  assert.equal(typeof main.freshBootCrewMessage, 'function');
  assert.match(main.freshBootCrewMessage(empty), /choose your captain/i);
  const captain = act(act(empty, 'splash-dismiss').player, 'captain-choose', { templateId: 'captain_cyborg', name: 'Rook' }).player;
  assert.match(main.freshBootCrewMessage(captain), /Rook/);
  assert.doesNotMatch(main.freshBootCrewMessage(captain), /Rex and Bolt/);
});

test('v5 confirmed registration commits after welcome pull and cannot repeat', () => {
  let player = guidedWin(staffed());
  player = act(player, 'contract-claim', contractIdentity(player)).player;
  player = act(player, 'tutorial-name', { name: 'Oddity' }).player;
  player = act(player, 'tutorial-welcome-pull').player;
  assert.equal(sessionAction(player, {}, 'tutorial-register-start', {}, { now }), null,
    'the async Jest handoff must reach the app action handler');
  assert.equal(act(player, 'tutorial-register-complete').reason, 'registration_unconfirmed');
  player = act(player, 'tutorial-register-complete', { registered: true, username: 'Rook' }).player;
  assert.equal(player.tutorial.phase, 'done');
  assert.equal(player.tutorial.registered, true);
  assert.equal(player._jestRegistered, true);
  assert.equal(player.ship.name, 'Oddity');
  assert.equal(act(player, 'tutorial-register-complete', { registered: true }).ok, false);
});
