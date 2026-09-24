import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { chooseCaptain } from '../src/systems/captainFirstPlay.js';
import { defaultTutorialV5, normalizeTutorialV5, advanceTutorialV5, hireFirstCrew, nameShipV5, grantWelcomePullV5 } from '../src/systems/tutorialV5.js';
import { isFeatureUnlocked, unlockedTabs } from '../src/systems/tutorial.js';
import { sessionAction } from '../src/systems/sessionLoop.js';

const fresh = () => createNewPlayer({ now: 1, rng: () => 0.1 });
const clone = value => JSON.parse(JSON.stringify(value));

test('captain and free first hire are ordered, saved, and exact once', () => {
  let p = fresh();
  assert.equal(p.tutorial.phase, 'board');
  assert.equal(advanceTutorialV5(p, 'captain_chosen'), p);
  p = advanceTutorialV5(p, 'board_ship');
  assert.equal(p.tutorial.phase, 'captain');
  assert.equal(advanceTutorialV5(p, 'captain_chosen'), p);
  p = chooseCaptain(p, { templateId: 'captain_gunner', name: 'Mara', rng: () => 0.1 }).player;
  p = advanceTutorialV5(p, 'captain_chosen');
  assert.equal(p.tutorial.phase, 'hire');
  const first = hireFirstCrew(p, { rng: () => 0.3 });
  assert.equal(first.ok, true);
  assert.equal(first.instance.templateId, 'merc_bolt');
  assert.equal(first.player.wallet.credits, 80);
  assert.equal(first.player.tutorial.phase, 'assign');
  assert.equal(first.player.tutorial.firstHireInstanceId, first.instance.instanceId);
  assert.equal(first.player.tutorial.firstHireUsed, true);
  assert.equal(hireFirstCrew(first.player).ok, false);
  const loaded = migratePlayer(clone(first.player));
  assert.equal(hireFirstCrew(loaded).ok, false);
  assert.equal(advanceTutorialV5(loaded, 'station_assigned'), loaded);
  const staffed = { ...loaded, stationAssignments: { ...loaded.stationAssignments, [first.instance.instanceId]: 'shields' } };
  assert.equal(advanceTutorialV5(staffed, 'station_assigned').tutorial.phase, 'fight');
});

test('a pilot receives Jen and only the hired instance can satisfy assignment', () => {
  let p = advanceTutorialV5(fresh(), 'board_ship');
  p = advanceTutorialV5(chooseCaptain(p, { templateId: 'captain_cyborg', name: 'Ada', rng: () => 0.1 }).player, 'captain_chosen');
  const hired = hireFirstCrew(p, { rng: () => 0.2 });
  assert.equal(hired.instance.templateId, 'merc_jen');
  const wrong = { ...hired.player, stationAssignments: { ...hired.player.stationAssignments, [hired.player.captainInstanceId]: 'weapons' } };
  assert.equal(advanceTutorialV5(wrong, 'station_assigned'), wrong);
  const right = { ...wrong, stationAssignments: { ...wrong.stationAssignments, [hired.instance.instanceId]: 'weapons' } };
  assert.equal(advanceTutorialV5(right, 'station_assigned').tutorial.phase, 'fight');
});

test('a failed save write leaves the entitlement available on the old snapshot', () => {
  let p = advanceTutorialV5(fresh(), 'board_ship');
  p = advanceTutorialV5(chooseCaptain(p, { templateId: 'captain_cyborg', name: 'Ada', rng: () => 0.1 }).player, 'captain_chosen');
  const attempted = hireFirstCrew(p, { rng: () => 0.2 });
  assert.equal(attempted.ok, true);
  const reloaded = migratePlayer(clone(p));
  assert.equal(reloaded.tutorial.firstHireUsed, false);
  assert.equal(hireFirstCrew(reloaded, { rng: () => 0.4 }).ok, true);
});

test('script five unlocks only ship navigation while active', () => {
  const p = fresh();
  assert.deepEqual(unlockedTabs(p), ['ship']);
  assert.equal(isFeatureUnlocked(p, 'nav_ship'), true);
  for (const feature of ['gacha', 'shop', 'nav_shop', 'hud_gems']) assert.equal(isFeatureUnlocked(p, feature), false);
});

test('normalization preserves committed fields and repairs invalid phase', () => {
  assert.equal(defaultTutorialV5().phase, 'board');
  const normalized = normalizeTutorialV5({ phase: 'nonsense', firstHireUsed: true, firstHireInstanceId: 'saved' });
  assert.equal(normalized.phase, 'board');
  assert.equal(normalized.firstHireUsed, true);
  assert.equal(normalized.firstHireInstanceId, 'saved');
  assert.equal(normalizeTutorialV5({ phase: 'done' }).completed, true);
});

test('session gate cannot bypass hire or pretend unavailable actions succeeded', () => {
  let p = advanceTutorialV5(fresh(), 'board_ship');
  assert.equal(sessionAction(p, {}, 'station-assign', { id: 'other', station: 'weapons' }).ok, false);
  const choose = sessionAction(p, {}, 'captain-choose', { templateId: 'captain_cyborg', name: 'Ada' });
  assert.equal(choose.ok, false);
  p = advanceTutorialV5(chooseCaptain(p, { templateId: 'captain_cyborg', name: 'Ada', rng: () => 0.1 }).player, 'captain_chosen');
  assert.equal(sessionAction(p, {}, 'tutorial-first-hire').ok, false);
  assert.equal(sessionAction(p, {}, 'tutorial-fight-start').ok, false);
});

test('win, claim, name, pull, and registration each require prior saved evidence', () => {
  let p = advanceTutorialV5(fresh(), 'board_ship');
  p = advanceTutorialV5(chooseCaptain(p, { templateId: 'captain_cyborg', name: 'Ada', rng: () => 0.1 }).player, 'captain_chosen');
  const hired = hireFirstCrew(p, { rng: () => 0.2 });
  p = advanceTutorialV5({ ...hired.player, stationAssignments: { ...hired.player.stationAssignments, [hired.instance.instanceId]: 'weapons' } }, 'station_assigned');
  assert.equal(p.tutorial.phase, 'fight');
  assert.equal(advanceTutorialV5(p, 'guided_win'), p);
  const won = { ...p, activeContract: { offerId: 'offer_tutorial_distress', profile: 'distress', stage: 'return', acceptanceId: 'accepted', result: { success: true } },
    activeEncounter: { kind: 'guided', acceptanceId: 'accepted', result: 'win', orders: { targetWeapons: { used: true } } } };
  const braceOnly = { ...won, activeEncounter: { ...won.activeEncounter, orders: { brace: { used: true } } } };
  assert.equal(advanceTutorialV5(braceOnly, 'guided_win'), braceOnly, 'Brace alone does not satisfy script 5');
  p = advanceTutorialV5(won, 'guided_win');
  assert.equal(p.tutorial.phase, 'claim');
  assert.equal(p.tutorial.firstWin, true);
  assert.equal(advanceTutorialV5(p, 'reward_claimed'), p);
  p = advanceTutorialV5({ ...p, activeContract: null, contractBoard: { completedOfferIds: ['offer_tutorial_distress'] } }, 'reward_claimed');
  assert.equal(p.tutorial.phase, 'name_ship');
  assert.equal(p.tutorial.firstClaim, true);
  assert.equal(advanceTutorialV5(p, 'ship_named'), p);
  p = nameShipV5(p, 'The Sparrow');
  assert.equal(p.tutorial.phase, 'pull');
  assert.equal(p.tutorial.named, true);
  assert.equal(advanceTutorialV5(p, 'registration_skipped'), p);
  const pulled = grantWelcomePullV5(p, { rng: () => 0.5 });
  assert.equal(pulled.ok, true);
  assert.equal(pulled.player.tutorial.phase, 'register');
  assert.equal(pulled.player.gacha.pulls, 1);
  assert.equal(pulled.player.gacha.history[0].source, 'welcome');
  assert.equal(grantWelcomePullV5(pulled.player).ok, false);
  const done = advanceTutorialV5(migratePlayer(clone(pulled.player)), 'registration_skipped');
  assert.equal(done.tutorial.phase, 'done');
  assert.equal(done.tutorial.completed, true);
});
