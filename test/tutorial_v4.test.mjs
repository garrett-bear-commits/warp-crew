import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewPlayer } from '../src/systems/player.js';
import { defaultTutorialV4, advanceTutorialV4, grantWelcomePull, nameShip } from '../src/systems/tutorialV4.js';
import { pullMerc, pullOnce, pullTen, defaultGacha, PITY } from '../src/systems/gacha.js';

const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => createNewPlayer({ now: 1, rng: () => 0.2 });
const ready = () => {
  const player = fresh();
  return { ...player, crewSlots: 3, tutorial: { ...defaultTutorialV4(), phase: 'pull', firstWin: true, firstClaim: true, named: true } };
};

test('new players begin the short script with a named Sparrow', () => {
  const player = createNewPlayer({ now: 1, rng: () => 0.2 });
  assert.equal(player.version, 8);
  assert.equal(player.ship.name, 'Sparrow');
  assert.equal(player.tutorial.script, 4);
  assert.equal(player.tutorial.phase, 'board');
});

test('only the committed, ordered first-session events advance', () => {
  const player = fresh();
  assert.equal(advanceTutorialV4(player, 'station_assigned'), player);
  const boarded = advanceTutorialV4(player, 'board_ship');
  assert.equal(boarded.tutorial.phase, 'station');
  assert.equal(player.tutorial.phase, 'board');
  assert.equal(advanceTutorialV4(boarded, 'station_assigned'), boarded);
  const bolt = boarded.crew.find(member => member.templateId === 'merc_bolt');
  const staffed = { ...boarded, stationAssignments: { ...boarded.stationAssignments, [bolt.instanceId]: 'shields' } };
  const fighting = advanceTutorialV4(staffed, 'station_assigned');
  assert.equal(fighting.tutorial.phase, 'fight');
  assert.equal(advanceTutorialV4(fighting, 'guided_win'), fighting, 'a UI event cannot claim an uncommitted win');
  const won = { ...fighting,
    activeContract: { profile: 'distress', stage: 'return', result: { success: true }, offerId: 'offer_tutorial_distress' },
    activeEncounter: { kind: 'guided', result: 'win', orders: { brace: { used: true } } },
  };
  const claiming = advanceTutorialV4(won, 'guided_win');
  assert.equal(claiming.tutorial.phase, 'claim');
  assert.equal(claiming.tutorial.firstWin, true);
  assert.equal(advanceTutorialV4(claiming, 'guided_win'), claiming);
  assert.equal(advanceTutorialV4(claiming, 'reward_claimed'), claiming);
  const paid = { ...claiming, activeContract: null, contractBoard: { completedOfferIds: ['offer_tutorial_distress'] } };
  const naming = advanceTutorialV4(paid, 'reward_claimed');
  assert.equal(naming.tutorial.phase, 'name');
  assert.equal(naming.tutorial.firstClaim, true);
  assert.equal(advanceTutorialV4(naming, 'board_ship'), naming);
});

test('ship naming accepts a default and counts visible Unicode characters', () => {
  const source = { ...fresh(), tutorial: { ...defaultTutorialV4(), phase: 'name', firstWin: true, firstClaim: true } };
  const named = nameShip(source, '  🌌  ');
  assert.equal(named.ship.name, '🌌');
  assert.equal(named.tutorial.phase, 'pull');
  assert.equal(named.tutorial.named, true);
  assert.equal(source.ship.name, 'Sparrow');
  assert.equal(nameShip(source, '  ').ship.name, 'Sparrow');
  assert.equal(nameShip(source, '👩‍🚀'.repeat(24)).ship.name, '👩‍🚀'.repeat(24));
  assert.throws(() => nameShip(source, '👩‍🚀'.repeat(25)), /name/i);
  assert.throws(() => nameShip(source, 'Bad\nName'), /name/i);
  assert.throws(() => nameShip(source, 'Bad\n'), /name/i);
  assert.throws(() => nameShip(source, '\u200b'), /name/i, 'an invisible character is not a ship name');
  assert.equal(nameShip(named, 'Another Name'), named, 'replayed initial naming grants nothing');
});

test('the free first pull uniformly selects three Uncommon crew and never spends currency', () => {
  for (const [roll, expected] of [[0, 'merc_kira'], [0.5, 'merc_tink'], [0.999, 'merc_nemi']]) {
    const player = ready();
    const before = clone(player);
    const first = grantWelcomePull(player, { rng: () => roll });
    assert.equal(first.ok, true);
    assert.equal(first.instance.templateId, expected);
    assert.equal(first.instance.rarity, 'uncommon');
    assert.deepEqual(first.player.wallet, before.wallet);
    assert.equal(first.player.dailyPullAvailable, true);
    assert.equal(first.player.gacha.pulls, 1);
    assert.equal(first.player.gacha.pityRare, 1);
    assert.equal(first.player.gacha.pityLegend, 1);
    assert.equal(first.player.gacha.lastRarity, 'uncommon');
    assert.deepEqual(first.player.gacha.history, [{ templateId: expected, instanceId: first.instance.instanceId, rarity: 'uncommon', kind: 'hire', source: 'welcome' }]);
    assert.equal(first.player.crew.filter(member => member.templateId === expected).length, 1);
    assert.equal(first.player.tutorial.phase, 'register');
    assert.deepEqual(player, before);
    const loaded = clone(first.player);
    assert.equal(grantWelcomePull(loaded, { rng: () => 0 }).ok, false);
    assert.equal(grantWelcomePull(loaded, { rng: () => 0 }).player, loaded);
  }
});

test('welcome crew uses normal berth rules and offers a useful station or Away hint', () => {
  const full = { ...ready(), crewSlots: 2 };
  const reserved = grantWelcomePull(full, { rng: () => 0 });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.kind, 'reserve');
  assert.equal(reserved.player.reserve[0].templateId, 'merc_kira');
  assert.equal(reserved.player.tutorial.suggestedStation, 'weapons');
  const tink = grantWelcomePull(ready(), { rng: () => 0.5 });
  assert.equal(tink.player.tutorial.suggestedStation, 'shields');
  const nemi = grantWelcomePull(ready(), { rng: () => 0.999 });
  assert.equal(nemi.player.tutorial.suggestedStation, null);
  assert.equal(nemi.player.tutorial.suggestedRole, 'away');
});

test('welcome pull requires the committed win, claim, and name', () => {
  for (const patch of [
    { phase: 'name' }, { firstWin: false }, { firstClaim: false }, { named: false }, { welcomePulled: true },
  ]) {
    const player = ready();
    const source = { ...player, tutorial: { ...player.tutorial, ...patch } };
    const result = grantWelcomePull(source, { rng: () => 0.5 });
    assert.equal(result.ok, false);
    assert.equal(result.player, source);
  }
});

test('registration is optional and cannot complete before the welcome pull', () => {
  const player = ready();
  assert.equal(advanceTutorialV4(player, 'registration_skipped'), player);
  const rewarded = grantWelcomePull(player, { rng: () => 0 }).player;
  const skipped = advanceTutorialV4(rewarded, 'registration_skipped');
  assert.equal(skipped.tutorial.phase, 'done');
  assert.equal(skipped.tutorial.completed, true);
  assert.equal(skipped.tutorial.registered, false);
  assert.equal(advanceTutorialV4(skipped, 'registration_completed'), skipped);
  const registered = advanceTutorialV4(rewarded, 'registration_completed');
  assert.equal(registered.tutorial.registered, true);
  assert.equal(registered.tutorial.phase, 'done');
});

test('normal pull odds use the supplied RNG and record the same compact history', () => {
  const low = pullMerc({ rng: () => 0 });
  const high = pullMerc({ rng: () => 0.99999 });
  assert.equal(low.rarity, 'common');
  assert.equal(high.rarity, 'apex');
  assert.equal(pullMerc({ rng: () => 0.5 }).instance.instanceId, pullMerc({ rng: () => 0.5 }).instance.instanceId);
  const paid = { ...fresh(), wallet: { credits: 1000, gems: 1000, fuel: 8, medals: 0, reputation: 0 }, gacha: defaultGacha() };
  const once = pullOnce(paid, { rng: () => 0 });
  assert.equal(once.ok, true);
  assert.equal(once.player.gacha.history.length, 1);
  assert.equal(once.player.gacha.history[0].source, 'credits');
  assert.equal(once.player.gacha.history[0].rarity, once.rarity);
  assert.equal(once.player.gacha.history[0].instanceId, once.instance.instanceId);
  const ten = pullTen(once.player, { rng: () => 0.5 });
  assert.equal(ten.ok, true);
  assert.equal(ten.player.gacha.history.length, 11);
  assert.equal(ten.player.gacha.history.at(-1).source, 'gems10');
  assert.equal(ten.player.gacha.pulls, 11);
  assert.deepEqual(paid.gacha.history, []);
  assert.deepEqual(paid.wallet, { credits: 1000, gems: 1000, fuel: 8, medals: 0, reputation: 0 });
  assert.equal(PITY.rareHard, 15, 'normal pity threshold remains unchanged');
});
