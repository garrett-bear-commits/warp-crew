import assert from 'node:assert/strict';
import { advanceEncounter, startEncounter } from '../src/systems/autoCombat.js';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { createNewPlayer } from '../src/systems/player.js';
import { stationOutputs } from '../src/systems/stations.js';
import { acceptContract, commitContractAction, generateContractBoard, previewContractAction } from '../src/systems/contracts.js';

const baseArgs = {
  acceptanceId: 'acceptance-6a',
  encounterId: 'pirate_scout',
  kind: 'guided',
  seed: 19,
  assignments: { crew_gunner: 'weapons', crew_engineer: 'engineering' },
  outputs: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
};

function encounter(overrides = {}) {
  return startEncounter({ ...baseArgs, ruleset: 'v1', ...overrides });
}

function advanceUntil(state, predicate, limit = 40, orderForState = () => null) {
  for (let i = 0; i < limit && !predicate(state); i += 1) {
    state = advanceEncounter(state, orderForState(state)).state;
  }
  return state;
}

function reliablePushEncounter({ staffWeapons = false } = {}) {
  const now = Date.UTC(2030, 8, 22, 12);
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = {
    ...player,
    tutorial: { ...player.tutorial, completed: true, phase: 'done' },
    wallet: { ...player.wallet, fuel: 10 },
    contractBoard: generateContractBoard(player, now),
  };
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'reliable');
  assert.equal(offer?.routeContent.encounterId, 'pirate_scout');
  player = acceptContract(player, offer.id, now).player;
  for (const id of ['launch', ...(staffWeapons ? [] : ['push'])]) {
    const preview = previewContractAction(player, { id }, now);
    assert.equal(preview.ok, true, preview.reason);
    player = commitContractAction(player, preview, { now, rng: () => 0.5 }).player;
  }
  if (staffWeapons) {
    const gunner = createCrewInstance('merc_jen', { rng: () => 0.1 });
    player = {
      ...player,
      crew: [...player.crew, gunner],
      stationAssignments: { ...player.stationAssignments, [gunner.instanceId]: 'weapons' },
    };
    const preview = previewContractAction(player, { id: 'push' }, now);
    assert.equal(preview.ok, true, preview.reason);
    player = commitContractAction(player, preview, { now, rng: () => 0.5 }).player;
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(stationOutputs(player, now)).map(([station, output]) => [station, output.total])),
    player.activeEncounter.outputs,
  );
  return player.activeEncounter;
}

// Mutation caught: reading hidden process randomness or unsaved mutable RNG state.
{
  const first = encounter();
  const restored = JSON.parse(JSON.stringify(first));
  assert.deepEqual(advanceEncounter(first), advanceEncounter(restored));
}

// Mutation caught: editing the caller's snapshot while resolving a beat.
{
  const first = encounter();
  const before = structuredClone(first);
  advanceEncounter(first);
  assert.deepEqual(first, before);
  assert.equal(first.revision, 0);
  assert.equal(first.beat, 0);
}

// Mutation caught: omitting a telegraph target or its visible impact countdown.
{
  const state = encounter();
  const { events } = advanceEncounter(state);
  const tell = events.find(event => event.type === 'tell');
  assert.ok(tell, 'first beat emits a threat tell');
  assert.equal(typeof tell.target, 'string');
  assert.equal(typeof tell.beatsToImpact, 'number');
  assert.ok(tell.beatsToImpact > 0);
}

// Mutation caught: accepting Brace outside its window, or spending a beat on rejection.
{
  const state = encounter();
  const rejected = advanceEncounter(state, 'brace');
  assert.deepEqual(rejected, { ok: false, reason: 'order_unavailable', state });
  assert.equal(state.beat, 0);
}

// Mutation caught: failing to charge and record the one permitted Brace response.
{
  const window = advanceUntil(encounter(), state => Boolean(state.orderWindow), 5);
  assert.ok(window.orderWindow);
  assert.ok(window.shield >= 2, 'Brace must have enough shield charge to pay its cost');
  const braced = advanceEncounter(window, 'brace');
  assert.equal(braced.ok, undefined);
  assert.equal(braced.state.orders.brace.used, true);
  assert.ok(braced.events.some(event => event.type === 'order' && event.order === 'brace' && event.cost.shield === 2));
  assert.equal(braced.state.shield, window.shield - 2);
  const nextWindow = advanceUntil(braced.state, state => Boolean(state.orderWindow), 5);
  const rejected = advanceEncounter(nextWindow, 'brace');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.beat, nextWindow.beat);
}

// Mutation caught: emergency repair not healing or not entering its cooldown.
{
  const normal = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, weapons: 0 } });
  const window = advanceUntil(normal, state => Boolean(state.orderWindow), 5);
  window.hull = 24;
  window.enemy.hull = 500;
  const beforeHull = window.hull;
  const beforeShield = window.shield;
  const repaired = advanceEncounter(window, 'repair');
  assert.ok(repaired.state.hull > beforeHull);
  assert.ok(repaired.state.cooldowns.repair > 0);
  assert.ok(repaired.events.some(event => event.type === 'order' && event.order === 'repair' && event.cost.shield === 3));
  assert.equal(repaired.state.shield, beforeShield - 3);
  const nextWindow = advanceUntil(repaired.state, state => Boolean(state.orderWindow), 8);
  assert.equal(nextWindow.orderWindow.orderOptions.repair.available, false);
  assert.equal(nextWindow.orderWindow.orderOptions.repair.reason, 'cooldown');
  assert.equal(nextWindow.orderWindow.orderOptions.repair.cooldownBeats, 2);
  assert.equal(nextWindow.orderWindow.availableOrders.includes('repair'), false);
  const rejected = advanceEncounter(nextWindow, 'repair');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'cooldown');
  assert.equal(rejected.state.beat, nextWindow.beat);
}

// Mutation caught: allowing orders without enough shield charge, or charging a no-order beat.
{
  const window = advanceEncounter(encounter({ kind: 'normal' })).state;
  const short = { ...window, shield: 1 };
  assert.deepEqual(advanceEncounter(short, 'brace'), { ok: false, reason: 'insufficient_resource', state: short });
  const conserved = advanceEncounter(window, null);
  assert.equal(conserved.state.shield, window.shield);
  assert.equal(conserved.events.some(event => event.type === 'order'), false);
}

// Mutation caught: Brace's shield cost must buy a real reduction in the telegraphed hit.
{
  const window = advanceEncounter(encounter({ kind: 'normal' })).state;
  const braced = advanceEncounter(window, 'brace').state;
  const waited = advanceEncounter(window, null).state;
  const bracedImpact = advanceEncounter(braced);
  const waitedImpact = advanceEncounter(waited);
  assert.equal(bracedImpact.events.find(event => event.type === 'enemy_impact').amount, 0,
    'Brace blocks the next hull and subsystem impact entirely');
  assert.ok(waitedImpact.events.find(event => event.type === 'enemy_impact').amount > 0);
  assert.equal(bracedImpact.state.shield, braced.shield);
  assert.equal(bracedImpact.state.hull, braced.hull);
  assert.ok(window.shield - braced.shield === 2);
}

// Mutation caught: the matching Weapons station bonus not changing outgoing damage.
{
  const baseline = encounter({ outputs: { ...baseArgs.outputs, weapons: 100 } });
  const staffed = encounter({ outputs: { ...baseArgs.outputs, weapons: 110 } });
  const baseShot = advanceEncounter(baseline).events.find(event => event.type === 'weapon_damage');
  const staffedShot = advanceEncounter(staffed).events.find(event => event.type === 'weapon_damage');
  assert.ok(baseShot && staffedShot);
  assert.ok(staffedShot.amount > baseShot.amount);
}

// Mutation caught: the matching Shields station bonus not reducing incoming hull damage.
{
  const baseline = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, shields: 100 } });
  const staffed = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, shields: 110 } });
  const baselineEvents = advanceUntil(baseline, state => state.beat >= 3, 3);
  const staffedEvents = advanceUntil(staffed, state => state.beat >= 3, 3);
  assert.ok(baselineEvents.hull + baselineEvents.shield < staffedEvents.hull + staffedEvents.shield);
}

// Mutation caught: engineering never repairing hull between enemy impacts.
{
  const noEngineer = encounter({ kind: 'normal', seed: 0, outputs: { ...baseArgs.outputs, engineering: 0 } });
  const engineer = encounter({ kind: 'normal', seed: 0, outputs: { ...baseArgs.outputs, engineering: 100 } });
  const damaged = advanceUntil(noEngineer, state => state.beat >= 7, 7);
  const repaired = advanceUntil(engineer, state => state.beat >= 7, 7);
  assert.ok(repaired.hull > damaged.hull);
  assert.ok(advanceEncounter(repaired).events.some(event => event.type === 'repair'));
}

// Mutation caught: replacing the guided encounter's authored combat with a forced result.
{
  let state = encounter();
  assert.equal(state.result, null);
  state = advanceUntil(state, current => current.result !== null, 20, current => current.orderWindow && !current.orders.brace.used ? 'brace' : null);
  assert.equal(state.result, 'win');
  assert.ok(state.beat > 0 && state.beat <= 20);
}

// Mutation caught: a zero-weapon normal fight becoming unwinnable only by hitting zero hull.
{
  let state = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, weapons: 0 } });
  state = advanceUntil(state, current => current.result !== null, 40);
  assert.equal(state.result, 'loss');
  assert.ok(state.hull >= 1);
  assert.equal(typeof state.lossReason, 'string');
  assert.ok(state.lossReason.length > 0);
}

// Mutation caught: functional Weapons station failing to defeat an ordinary encounter.
{
  let state = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, weapons: 110 } });
  state = advanceUntil(state, current => current.result !== null, 40);
  assert.equal(state.result, 'win');
}

// Mutation caught: captain-order event count must not perturb the seeded enemy target sequence.
{
  let plain = reliablePushEncounter();
  let braced = reliablePushEncounter();
  while (plain.beat < 4) plain = advanceEncounter(plain).state;
  while (braced.beat < 4) {
    const order = braced.beat === 1 && braced.orderWindow?.availableOrders.includes('brace') ? 'brace' : null;
    braced = advanceEncounter(braced, order).state;
  }
  assert.equal(plain.orderWindow.target, braced.orderWindow.target,
    'an order changes combat effects, not the seed-derived next threat');
  const restored = JSON.parse(JSON.stringify(braced));
  assert.deepEqual(advanceEncounter(braced), advanceEncounter(restored), 'the order branch still replays after JSON reload');
}

// Mutation caught: the real reliable Ice Spur Push winning hands-free before station choice matters.
{
  const push = reliablePushEncounter();
  assert.deepEqual(push.outputs, { helm: 110, shields: 100, weapons: 100, engineering: 100 });
  const noOrder = advanceUntil(push, current => current.result !== null, 40);
  assert.equal(noOrder.result, 'loss');
  assert.equal(noOrder.beat, 9, 'the authored baseline survives eight committed beats before the fatal volley');
  assert.equal(noOrder.enemy.hull, 2);
  assert.ok(noOrder.hull >= 1);
  assert.ok(noOrder.lossReason);

  let bracedPush = reliablePushEncounter();
  const bracedWin = advanceUntil(bracedPush, current => current.result !== null, 40,
    current => current.beat === 1 && current.orderWindow?.availableOrders.includes('brace') ? 'brace' : null);
  assert.equal(bracedWin.result, 'win', 'a legal Brace at the first threat window turns the real baseline Push into a win');
  assert.equal(bracedWin.beat, 9);
  assert.ok(bracedWin.hull > noOrder.hull, 'the same final volley is survivable when Brace is timed at the first tell');
  assert.equal(bracedWin.orders.brace.uses, 1);

  const staffedPush = reliablePushEncounter({ staffWeapons: true });
  assert.deepEqual(staffedPush.outputs, { helm: 110, shields: 100, weapons: 110, engineering: 100 });
  const staffedWin = advanceUntil(staffedPush, current => current.result !== null, 40);
  assert.equal(staffedWin.result, 'win');
  assert.ok(staffedWin.beat < noOrder.beat, 'a matching Weapons assignment changes the route from loss to a faster win');
}

// Mutation caught: changing a terminal encounter after completion.
{
  let state = encounter();
  state = advanceUntil(state, current => current.result !== null, 20, current => current.orderWindow && !current.orders.brace.used ? 'brace' : null);
  const terminal = advanceEncounter(state, 'brace');
  assert.deepEqual(terminal, { state, events: [] });
}

// Mutation caught: dropping seeded target history when a later tell is serialized and restored.
{
  let state = encounter({ kind: 'normal', seed: 1 });
  while (state.beat < 4) state = advanceEncounter(state).state;
  assert.equal(state.orderWindow.target, 'shields');
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(advanceEncounter(state), advanceEncounter(restored));
}

function impactAtSecondTell(seed, target) {
  let state = encounter({ kind: 'normal', seed });
  while (state.beat < 6) state = advanceEncounter(state).state;
  assert.equal(state.enemy.target, target);
  return state;
}

// Mutation caught: weapons system damage not reducing later outgoing weapon damage.
{
  const damaged = impactAtSecondTell(3, 'weapons');
  assert.ok(damaged.systems.weapons < 100);
  const reducedShot = advanceEncounter(damaged).events.find(event => event.type === 'weapon_damage');
  const healthy = encounter({ kind: 'normal', seed: 3 });
  const healthyShot = advanceEncounter(healthy).events.find(event => event.type === 'weapon_damage');
  assert.ok(reducedShot.amount < healthyShot.amount);
}

// Mutation caught: shield system damage not increasing the next incoming hit, or never recovering.
{
  const damaged = impactAtSecondTell(0, 'shields');
  assert.ok(damaged.systems.shields < 100);
  const recovery = advanceEncounter(damaged);
  assert.equal(recovery.state.systems.shields, damaged.systems.shields + 1);
  assert.ok(recovery.events.some(event => event.type === 'repair' && event.target === 'system' && event.system === 'shields'));
  const sustained = structuredClone(damaged);
  sustained.enemy.hull = 5000;
  let later = sustained;
  while (later.beat < 8) later = advanceEncounter(later).state;
  const impact = advanceEncounter(later).events.find(event => event.type === 'enemy_impact');
  assert.ok(impact.hullAmount + impact.shieldLoss > 7);
}

// Mutation caught: engineering system damage not reducing repairs or recovering its function.
{
  const damaged = impactAtSecondTell(4, 'engineering');
  assert.ok(damaged.systems.engineering < 100);
  const degraded = advanceEncounter(damaged);
  assert.equal(degraded.events.some(event => event.type === 'repair' && event.target === 'hull'), false);
  assert.equal(degraded.state.systems.engineering, damaged.systems.engineering + 1);
  assert.ok(degraded.events.some(event => event.type === 'repair' && event.target === 'system' && event.system === 'engineering'));
}

// Mutation caught: order windows advertising unaffordable orders without their cost/reason.
{
  let state = encounter({ kind: 'normal', seed: 1 });
  while (state.beat < 7) state = advanceEncounter(state).state;
  assert.equal(state.shield, 0);
  assert.deepEqual(state.orderWindow.availableOrders, []);
  assert.deepEqual(state.orderWindow.orderOptions.brace, {
    cost: { shield: 2 }, available: false, reason: 'insufficient_resource', cooldownBeats: 0,
  });
  assert.deepEqual(state.orderWindow.orderOptions.repair, {
    cost: { shield: 3 }, available: false, reason: 'insufficient_resource', cooldownBeats: 0,
  });
  assert.equal(advanceEncounter(state, 'brace').reason, 'insufficient_resource');
}

// Mutation caught: Brace remaining advertised while its normal-fight cooldown is active.
{
  let state = advanceEncounter(encounter({ kind: 'normal' })).state;
  state = advanceEncounter(state, 'brace').state;
  while (state.beat < 4) state = advanceEncounter(state).state;
  assert.equal(state.orderWindow.orderOptions.brace.cost.shield, 2);
  assert.equal(state.orderWindow.orderOptions.brace.available, false);
  assert.equal(state.orderWindow.orderOptions.brace.reason, 'cooldown');
  assert.equal(state.orderWindow.orderOptions.brace.cooldownBeats, 1);
  assert.equal(state.orderWindow.availableOrders.includes('brace'), false);
  assert.equal(advanceEncounter(state, 'brace').reason, 'cooldown');
}

// Mutation caught: charging for an emergency repair that cannot heal a full hull.
{
  const state = advanceEncounter(encounter({ kind: 'normal' })).state;
  assert.equal(state.orderWindow.orderOptions.repair.cost.shield, 3);
  assert.equal(state.orderWindow.orderOptions.repair.available, false);
  assert.equal(state.orderWindow.orderOptions.repair.reason, 'hull_full');
  assert.equal(state.orderWindow.availableOrders.includes('repair'), false);
  assert.equal(advanceEncounter(state, 'repair').reason, 'hull_full');
}

// Mutation caught: a zero-cost target lock that still lets the pirate volley land.
{
  const first = startEncounter({ ...baseArgs, ruleset: 'v2' });
  assert.equal(first.version, 2);
  assert.deepEqual(first.orders.targetWeapons, { used: false, uses: 0 });
  assert.equal(first.enemy.weaponDisabledThroughBeat, 0);
  const opened = advanceEncounter(first).state;
  assert.deepEqual(opened.orderWindow.orderOptions.target_weapons, {
    cost: { shield: 0 }, available: true, reason: null, cooldownBeats: 0,
  });
  const locked = advanceEncounter(opened, 'target_weapons');
  assert.equal(locked.state.orders.targetWeapons.used, true);
  assert.equal(locked.state.orders.targetWeapons.uses, 1);
  assert.equal(locked.state.shield, opened.shield);
  assert.equal(locked.state.enemy.weaponDisabledThroughBeat, 4);
  assert.ok(locked.events.some(event => event.type === 'enemy_weapon_disabled' && event.target === 'weapons' && event.throughBeat === 4));
  const impact = advanceEncounter(locked.state);
  assert.ok(impact.events.some(event => event.type === 'enemy_volley_canceled'));
  assert.equal(impact.events.some(event => event.type === 'enemy_impact' && event.amount > 0), false);
  assert.equal(impact.state.enemy.weaponDisabledThroughBeat, 0);
  assert.equal(advanceEncounter(impact.state, 'target_weapons').ok, false);
  const laterWindow = advanceUntil(impact.state, state => Boolean(state.orderWindow), 5);
  assert.equal(laterWindow.orderWindow.orderOptions.target_weapons.reason, 'used');
  assert.equal(laterWindow.orderWindow.availableOrders.includes('target_weapons'), false);
}

// Mutation caught: a saved v1 fight being reinterpreted as v2 after a reload.
{
  const legacy = startEncounter({ ...baseArgs, ruleset: 'v1' });
  assert.equal(legacy.version, 1);
  assert.equal(legacy.orders.targetWeapons, undefined);
  assert.equal(legacy.enemy.weaponDisabledThroughBeat, undefined);
  assert.deepEqual(advanceEncounter(JSON.parse(JSON.stringify(legacy))), advanceEncounter(legacy));
  const legacyWindow = advanceEncounter(legacy).state.orderWindow;
  assert.deepEqual(Object.keys(legacyWindow.orderOptions), ['brace']);
}

// Mutation caught: normal v2 impact resolving damage before checking the saved lock.
{
  const opened = advanceEncounter(startEncounter({ ...baseArgs, kind: 'normal', ruleset: 'v2' })).state;
  const locked = advanceEncounter(opened, 'target_weapons').state;
  const restored = JSON.parse(JSON.stringify(locked));
  assert.deepEqual(advanceEncounter(restored), advanceEncounter(locked));
  const impact = advanceEncounter(restored);
  assert.ok(impact.events.some(event => event.type === 'enemy_volley_canceled'));
  assert.equal(impact.events.some(event => event.type === 'enemy_impact'), false);
  assert.equal(impact.state.hull, locked.hull);
  assert.equal(impact.state.shield, locked.shield);
}

console.log('auto combat reducer tests passed');
