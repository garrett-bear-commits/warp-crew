import assert from 'node:assert/strict';
import { advanceEncounter, startEncounter } from '../src/systems/autoCombat.js';

const baseArgs = {
  acceptanceId: 'acceptance-6a',
  encounterId: 'pirate_scout',
  kind: 'guided',
  seed: 19,
  assignments: { crew_gunner: 'weapons', crew_engineer: 'engineering' },
  outputs: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
};

function encounter(overrides = {}) {
  return startEncounter({ ...baseArgs, ...overrides });
}

function advanceUntil(state, predicate, limit = 40, orderForState = () => null) {
  for (let i = 0; i < limit && !predicate(state); i += 1) {
    state = advanceEncounter(state, orderForState(state)).state;
  }
  return state;
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
  const braced = advanceEncounter(window, 'brace');
  assert.equal(braced.ok, undefined);
  assert.equal(braced.state.orders.brace.used, true);
  assert.ok(braced.events.some(event => event.type === 'order' && event.order === 'brace' && event.cost.shield === 2));
  const nextWindow = advanceUntil(braced.state, state => Boolean(state.orderWindow), 5);
  const rejected = advanceEncounter(nextWindow, 'brace');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.beat, nextWindow.beat);
}

// Mutation caught: emergency repair not healing or not entering its cooldown.
{
  const normal = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, weapons: 0 } });
  const window = advanceUntil(normal, state => state.beat >= 4 && Boolean(state.orderWindow), 5);
  const beforeHull = window.hull;
  const repaired = advanceEncounter(window, 'repair');
  assert.ok(repaired.state.hull > beforeHull);
  assert.ok(repaired.state.cooldowns.repair > 0);
  assert.ok(repaired.events.some(event => event.type === 'order' && event.order === 'repair' && event.cost.shield === 3));
  const nextWindow = advanceUntil(repaired.state, state => Boolean(state.orderWindow), 8);
  const rejected = advanceEncounter(nextWindow, 'repair');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.beat, nextWindow.beat);
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
  assert.ok(baselineEvents.hull < staffedEvents.hull);
}

// Mutation caught: engineering never repairing hull between enemy impacts.
{
  const noEngineer = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, engineering: 0 } });
  const engineer = encounter({ kind: 'normal', outputs: { ...baseArgs.outputs, engineering: 100 } });
  const damaged = advanceUntil(noEngineer, state => state.beat >= 4, 4);
  const repaired = advanceUntil(engineer, state => state.beat >= 4, 4);
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
  let state = encounter({ kind: 'normal' });
  state = advanceUntil(state, current => current.result !== null, 40);
  assert.equal(state.result, 'win');
}

// Mutation caught: changing a terminal encounter after completion.
{
  let state = encounter();
  state = advanceUntil(state, current => current.result !== null, 20, current => current.orderWindow && !current.orders.brace.used ? 'brace' : null);
  const terminal = advanceEncounter(state, 'brace');
  assert.deepEqual(terminal, { state, events: [] });
}

console.log('auto combat reducer tests passed');
