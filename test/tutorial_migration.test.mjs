import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { defaultTutorialV4, grantWelcomePull } from '../src/systems/tutorialV4.js';
import { tutorialDistressOffer, acceptContract } from '../src/systems/contracts.js';

const clone = value => JSON.parse(JSON.stringify(value));
const base = () => createNewPlayer({ now: 1, rng: () => 0.2 });
const withActiveRoute = player => {
  const offer = tutorialDistressOffer(player);
  const boarded = { ...player, contractBoard: { dayKey: 'tutorial', offers: [offer], completedOfferIds: [] } };
  const accepted = acceptContract(boarded, offer.id, 1);
  assert.equal(accepted.ok, true);
  return accepted.player;
};

test('active script-3 recruit keeps its roster, economy, and route identity', () => {
  const old = withActiveRoute({ ...base(), version: 7, tutorial: { script: 3, phase: 'recruit', completed: false, dismissed: false } });
  const migrated = migratePlayer(clone(old));
  assert.equal(migrated.version, 8);
  assert.equal(migrated.tutorial.script, 3);
  assert.equal(migrated.tutorial.phase, 'recruit');
  assert.deepEqual(migrated.crew.map(member => member.instanceId), old.crew.map(member => member.instanceId));
  assert.deepEqual(migrated.wallet, old.wallet);
  assert.equal(migrated.activeContract.acceptanceId, old.activeContract.acceptanceId);
  assert.equal(migrated.activeContract.revision, old.activeContract.revision);
  assert.deepEqual(migrated.contractBoard.completedOfferIds, []);
  assert.equal(grantWelcomePull(migrated).ok, false);
});

test('completed script-3 and veteran version-7 saves never restart onboarding', () => {
  const completed = { ...base(), version: 7, tutorial: { script: 3, phase: 'done', completed: true },
    gacha: { pityRare: 4, pityLegend: 4, luck: 1, pulls: 4, lastRarity: 'common' } };
  const done = migratePlayer(clone(completed));
  assert.equal(done.tutorial.script, 3);
  assert.equal(done.tutorial.phase, 'done');
  assert.equal(done.tutorial.completed, true);
  assert.equal(done.gacha.pulls, 4);
  assert.deepEqual(done.gacha.history, []);
  assert.equal(grantWelcomePull(done).ok, false);
  const veteran = { ...base(), version: 7, tutorial: undefined, stats: { ...base().stats, jumps: 3, combatsWon: 1 } };
  const migratedVeteran = migratePlayer(clone(veteran));
  assert.equal(migratedVeteran.tutorial.script, 3);
  assert.equal(migratedVeteran.tutorial.phase, 'done');
  assert.equal(migratedVeteran.tutorial.completed, true);
  assert.equal(grantWelcomePull(migratedVeteran).ok, false);
  const malformedHistory = migratePlayer({ ...clone(completed), gacha: { ...completed.gacha, history: null } });
  assert.deepEqual(malformedHistory.gacha.history, [], 'old or damaged history normalizes to a list');
});

test('every script-4 phase survives reload with an active contract unchanged', () => {
  for (const phase of ['board', 'station', 'fight', 'claim', 'name', 'pull', 'register', 'done']) {
    const accepted = withActiveRoute(base());
    const source = { ...accepted, tutorial: { ...defaultTutorialV4(), phase, completed: phase === 'done' } };
    const migrated = migratePlayer(clone(source));
    assert.equal(migrated.tutorial.script, 4, phase);
    assert.equal(migrated.tutorial.phase, phase);
    assert.equal(migrated.tutorial.completed, phase === 'done');
    assert.equal(migrated.activeContract.acceptanceId, source.activeContract.acceptanceId, phase);
    assert.equal(migrated.activeContract.revision, source.activeContract.revision, phase);
    assert.deepEqual(migrated.wallet, source.wallet, phase);
  }
});

test('script-4 reward and name flags survive JSON migration', () => {
  const source = { ...base(), ship: { ...base().ship, name: 'The Oddity' },
    tutorial: { ...defaultTutorialV4(), phase: 'register', firstWin: true, firstClaim: true, named: true, welcomePulled: true,
      welcomeInstanceId: 'merc_tink_unique', suggestedStation: 'shields' },
    gacha: { pityRare: 1, pityLegend: 1, luck: 0, pulls: 1, lastRarity: 'uncommon',
      history: [{ templateId: 'merc_tink', instanceId: 'merc_tink_unique', rarity: 'uncommon', kind: 'hire', source: 'welcome' }] } };
  const loaded = migratePlayer(clone(source));
  assert.equal(loaded.ship.name, 'The Oddity');
  assert.equal(loaded.tutorial.welcomePulled, true);
  assert.equal(loaded.tutorial.welcomeInstanceId, 'merc_tink_unique');
  assert.equal(loaded.gacha.pulls, 1);
  assert.deepEqual(loaded.gacha.history, source.gacha.history);
  assert.equal(grantWelcomePull(loaded).ok, false);
});
