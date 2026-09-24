import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogById, createCrewInstance, recomputeCrew } from '../src/data/crewRoster.js';
import { createNewPlayer, migratePlayer, readyCrew } from '../src/systems/player.js';
import { STARTER_CAPTAINS, chooseCaptain, captainStationFor } from '../src/systems/captainFirstPlay.js';
import { applyPullToRoster, benchCrew, sellReserve } from '../src/systems/gacha.js';
import { parkOverflowToReserve } from '../src/systems/hangar.js';

const fresh = () => createNewPlayer({ now: 1, rng: () => 0.1 });
const picked = (templateId = 'captain_alien', name = 'Aster') =>
  chooseCaptain(fresh(), { templateId, name, rng: () => 0.2 });
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));

test('fresh script 5 has no crew; choosing once saves the named working captain', () => {
  const player = fresh();
  assert.equal(player.version, 9);
  assert.equal(player.tutorial.script, 5);
  assert.equal(player.crew.length, 0);
  assert.equal(player.captainInstanceId, null);
  const result = chooseCaptain(player, { templateId: 'captain_alien', name: '  Aster  ', rng: () => 0.2 });
  assert.equal(result.ok, true);
  assert.equal(result.player.crew.length, 1);
  assert.equal(result.instance.customName, 'Aster');
  assert.equal(result.instance.name, 'Aster');
  assert.equal(result.instance.isCaptain, true);
  assert.equal(result.player.captainInstanceId, result.instance.instanceId);
  assert.equal(result.player.stationAssignments[result.instance.instanceId], 'helm');
  assert.equal(reload(result.player).crew[0].name, 'Aster');
  assert.equal(reload(result.player).crew[0].customName, 'Aster');
  assert.equal(reload(result.player).crew[0].isCaptain, true);
  assert.equal(chooseCaptain(result.player, { templateId: 'captain_droid', name: 'Two' }).reason, 'captain_already_chosen');
  assert.equal(chooseCaptain(reload(result.player), { templateId: 'captain_droid', name: 'Two' }).ok, false);
  assert.equal(player.crew.length, 0);
});

test('four equal Common templates map to useful stations', () => {
  assert.deepEqual(STARTER_CAPTAINS, ['captain_cyborg', 'captain_gunner', 'captain_alien', 'captain_droid']);
  const stations = ['helm', 'weapons', 'helm', 'shields'];
  const roles = ['pilot', 'gunner', 'scout', 'engineer'];
  for (let i = 0; i < STARTER_CAPTAINS.length; i++) {
    const template = catalogById(STARTER_CAPTAINS[i]);
    assert.equal(template.rarity, 'common');
    assert.equal(template.basePower, 10);
    assert.equal(template.role, roles[i]);
    assert.equal(captainStationFor(template.role), stations[i]);
    const result = picked(template.id);
    assert.equal(result.player.stationAssignments[result.instance.instanceId], stations[i]);
    assert.equal(result.instance.stars, 1);
  }
});

test('captain name defaults, rejects controls and invisible or overlong names', () => {
  assert.equal(picked('captain_cyborg', '  ').instance.name, 'Captain');
  for (const name of ['\u0000', 'Bad\nName', '\u200b', '🌌'.repeat(25)]) {
    assert.equal(picked('captain_alien', name).reason, 'invalid_captain_name');
  }
  assert.equal(picked('captain_alien', '🌌'.repeat(24)).ok, true);
  assert.equal(picked('merc_rex', 'Rex').ok, false);
});

test('duplicate draw stars up the same captain and preserves its custom name', () => {
  const selected = picked().player;
  const draw = createCrewInstance('captain_alien', { rng: () => 0.3 });
  const result = applyPullToRoster(selected, draw);
  assert.equal(result.kind, 'star');
  assert.equal(result.player.crew.length, 1);
  assert.equal(result.player.crew[0].stars, 2);
  assert.equal(result.player.crew[0].instanceId, selected.captainInstanceId);
  assert.equal(result.player.crew[0].name, 'Aster');
  assert.equal(recomputeCrew(result.player.crew[0]).name, 'Aster');
  assert.equal(reload(result.player).crew[0].name, 'Aster');
});

test('captain can be injured or Away, but cannot be benched, sold, or overflowed', () => {
  const selected = picked().player;
  const captain = selected.crew[0];
  assert.equal(readyCrew({ ...selected, crew: [{ ...captain, status: 'injured', injuredUntil: 100 }] }, 2).length, 0);
  assert.equal(readyCrew({ ...selected, crew: [{ ...captain, status: 'expedition' }] }, 2).length, 0);
  const withOther = { ...selected, crew: [...selected.crew, createCrewInstance('merc_bolt', { rng: () => 0.4 })] };
  assert.equal(benchCrew(withOther, captain.instanceId).ok, false);
  const parked = parkOverflowToReserve(withOther, 1, 0);
  assert.equal(parked.player.crew.length, 1);
  assert.equal(parked.player.crew[0].instanceId, captain.instanceId);
  assert.equal(parked.sold.length, 1);
  const corrupted = { ...selected, crew: [], reserve: [{ ...captain, status: 'reserve' }] };
  assert.equal(sellReserve(corrupted, captain.instanceId).ok, false);
});

test('explicit script 4 fixture keeps Rex and Bolt and survives migration', () => {
  const old = createNewPlayer({ tutorialScript: 4, now: 1, rng: () => 0.1 });
  assert.equal(old.tutorial.script, 4);
  assert.deepEqual(old.crew.map(c => c.templateId), ['merc_rex', 'merc_bolt']);
  assert.equal(old.captainInstanceId, null);
  assert.deepEqual(reload(old).crew.map(c => c.templateId), ['merc_rex', 'merc_bolt']);
});
