import test from 'node:test';
import assert from 'node:assert/strict';
import * as main from '../src/main.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction, sessionModels, persistSessionTransition } from '../src/systems/sessionLoop.js';
import { unlockedTabs, isFeatureUnlocked, defaultTutorial } from '../src/systems/tutorial.js';
import { advanceTutorialV4 } from '../src/systems/tutorialV4.js';
import { renderOverlays, renderSessionGuidance, renderCrew } from '../src/ui/bridge.js';
import { contractShipSignals, renderShipFeedback } from '../src/ui/shipView.js';
import { renderEncounter } from '../src/ui/contractView.js';

const now = Date.UTC(2030, 8, 23, 12);
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));
const fresh = () => prepareSession(createNewPlayer({ now, rng: () => 0.1 }), now);
const boltId = player => player.crew.find(member => member.templateId === 'merc_bolt').instanceId;
const identity = player => ({ acceptanceId: player.activeContract.acceptanceId, revision: player.activeContract.revision });
const encounterIdentity = player => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });
const apply = (player, act, data = {}, { rng = () => 0.5, save = () => true } = {}) => {
  const result = sessionAction(player, {}, act, data, { now, rng });
  assert.ok(result, `${act} must use the session transition boundary`);
  if (!result.ok) return result;
  let published = player;
  const committed = persistSessionTransition(result, { save, publish: value => { published = value.player; } });
  return { ...committed, player: published };
};

test('fresh boot and every committed first-session phase reload as script 4; saved script 3 stays script 3', () => {
  assert.equal(typeof main.restoreTutorialPlayer, 'function');
  const player = fresh();
  assert.equal(player.tutorial.phase, 'board');
  assert.equal(main.restoreTutorialPlayer(reload(player)).tutorial.script, 4);
  assert.equal(main.restoreTutorialPlayer(reload(player)).tutorial.phase, 'board');
  const old = { ...player, version: 7, tutorial: defaultTutorial() };
  old.tutorial.phase = 'recruit';
  old.tutorial.firstCombat = true;
  old.activeContract = null;
  const loadedOld = main.restoreTutorialPlayer(reload(old));
  assert.equal(loadedOld.tutorial.script, 3);
  assert.equal(loadedOld.tutorial.phase, 'recruit');
  assert.deepEqual(loadedOld.crew.map(c => c.instanceId), old.crew.map(c => c.instanceId));
  assert.deepEqual(loadedOld.wallet, old.wallet);
});

test('Board and Bolt at Shields advance only after a save; early paid and unrelated actions stay blocked', () => {
  let player = fresh();
  assert.equal(player.contractBoard.offers.length, 1);
  assert.equal(player.contractBoard.offers[0].id, 'offer_tutorial_distress');
  assert.deepEqual(unlockedTabs(player), ['ship']);
  assert.equal(isFeatureUnlocked(player, 'shop'), false);
  assert.equal(apply(player, 'contract-review', { offer: 'offer_tutorial_distress' }).ok, false);
  const failedBoard = apply(player, 'splash-dismiss', {}, { save: () => false });
  assert.equal(failedBoard.ok, false);
  assert.equal(failedBoard.reason, 'save_failed');
  assert.equal(failedBoard.player.tutorial.phase, 'board');
  player = reload(apply(player, 'splash-dismiss').player);
  assert.equal(player.flags.splashSeen, true);
  assert.equal(player.tutorial.phase, 'station');
  assert.equal(apply(player, 'station-assign', { id: player.crew[0].instanceId, station: 'shields' }).ok, false);
  assert.equal(apply(player, 'station-assign', { id: boltId(player), station: 'weapons' }).ok, false);
  const failedStation = apply(player, 'station-assign', { id: boltId(player), station: 'shields' }, { save: () => false });
  assert.equal(failedStation.ok, false);
  assert.equal(failedStation.player.stationAssignments[boltId(player)], null);
  player = reload(apply(player, 'station-assign', { id: boltId(player), station: 'shields' }).player);
  assert.equal(player.tutorial.phase, 'fight');
  assert.equal(player.stationAssignments[boltId(player)], 'shields');
  assert.match(renderSessionGuidance(player, now), /distress/i);
  assert.equal(isFeatureUnlocked(player, 'gacha'), false);
  assert.equal(apply(player, 'ship-upgrade', { system: 'shields' }).ok, false);
});

test('guided distress, Brace, claim, ship name, welcome crew and Skip survive each reload exactly once', () => {
  let player = fresh();
  player = reload(apply(player, 'splash-dismiss').player);
  assert.equal(player.tutorial.phase, 'station');
  player = reload(apply(player, 'station-assign', { id: boltId(player), station: 'shields' }).player);
  const fuel = player.wallet.fuel;
  player = reload(apply(player, 'tutorial-fight-start').player);
  assert.equal(player.tutorial.phase, 'fight');
  assert.equal(player.activeEncounter.kind, 'guided');
  assert.equal(player.wallet.fuel, fuel - 1);
  assert.equal(player.activeContract.stage, 'confrontation');
  assert.ok(player.activeEncounter.orderWindow, 'first pirate threat is visible after the single launch action');
  const threat = renderOverlays(player, { isHome: true, activeContractView: sessionModels(player, {}, now).activeContractView });
  assert.match(threat, /Brace/);
  assert.doesNotMatch(threat, /No order|Advance combat/, 'guided fight offers one captain action');
  assert.equal(apply(player, 'tutorial-fight-start').ok, false);
  assert.equal(apply(player, 'encounter-advance', encounterIdentity(player)).ok, false, 'first threat requires Brace');
  player = reload(apply(player, 'encounter-order', { ...encounterIdentity(player), order: 'brace' }).player);
  assert.equal(player.activeEncounter.orders.brace.used, true);
  for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) {
    player = reload(apply(player, 'encounter-advance', encounterIdentity(player)).player);
  }
  assert.equal(player.tutorial.phase, 'claim');
  assert.equal(player.activeContract.stage, 'return');
  assert.equal(player.wallet.fuel, fuel - 1);
  const beforeClaim = { ...player.wallet };
  const reward = player.activeContract.result.rewards;
  player = reload(apply(player, 'contract-claim', identity(player)).player);
  assert.equal(player.tutorial.phase, 'name');
  assert.equal(player.crewSlots, 3, 'the welcome recruit needs a visible open berth');
  assert.equal(player.flags.sparrowFirstRepair, true);
  assert.match(renderShipFeedback(contractShipSignals(player)), /Third berth open/);
  assert.equal(player.wallet.credits, beforeClaim.credits + reward.credits);
  assert.equal(player.wallet.reputation, beforeClaim.reputation + reward.reputation);
  assert.equal(apply(player, 'contract-claim', identity({ activeContract: { acceptanceId: 'old', revision: 0 } })).ok, false);
  player = reload(apply(player, 'tutorial-name', { name: '  ' }).player);
  assert.equal(player.tutorial.phase, 'pull');
  assert.equal(player.ship.name, 'Sparrow');
  assert.equal(apply(player, 'tutorial-name', { name: 'Again' }).ok, false);
  const prePull = player.crew.length;
  player = reload(apply(player, 'tutorial-welcome-pull', {}, { rng: () => 0.5 }).player);
  assert.equal(player.tutorial.phase, 'register');
  assert.equal(player.crew.length, prePull + 1);
  assert.equal(player.reserve.length, 0);
  assert.equal(player.crew.at(-1).templateId, 'merc_tink');
  assert.equal(player.gacha.history.at(-1).source, 'welcome');
  assert.equal(player.gacha.history.at(-1).rarity, 'uncommon');
  assert.equal(player.tutorial.suggestedStation, 'shields');
  assert.equal(apply(player, 'tutorial-welcome-pull').ok, false);
  assert.match(renderCrew(player, now), /Tink/);
  assert.equal(isFeatureUnlocked(player, 'shop'), false);
  player = reload(apply(player, 'tutorial-register-skip').player);
  assert.equal(player.tutorial.phase, 'done');
  assert.equal(player.tutorial.registered, false);
  assert.equal(player.gacha.pulls, 1);
  assert.equal(player.contractBoard.offers.length, 3, 'normal jobs become available');
  assert.ok(player.contractBoard.offers.some(offer => offer.profile === 'reliable'));
  assert.equal(isFeatureUnlocked(player, 'shop'), true);
  const nextJob = renderOverlays(player, { isHome: true });
  assert.match(nextJob, /See contracts/);
  assert.match(nextJob, /Away teams/);
});

test('registration completion requires confirmed Jest registration; failed save publishes no reward', () => {
  let player = fresh();
  player = reload(apply(player, 'splash-dismiss').player);
  player = reload(apply(player, 'station-assign', { id: boltId(player), station: 'shields' }).player);
  player = reload(apply(player, 'tutorial-fight-start').player);
  player = reload(apply(player, 'encounter-order', { ...encounterIdentity(player), order: 'brace' }).player);
  for (let i = 0; i < 12 && player.tutorial.phase === 'fight'; i++) player = reload(apply(player, 'encounter-advance', encounterIdentity(player)).player);
  player = reload(apply(player, 'contract-claim', identity(player)).player);
  player = reload(apply(player, 'tutorial-name', { name: 'Oddity' }).player);
  const failed = apply(player, 'tutorial-welcome-pull', {}, { save: () => false });
  assert.equal(failed.ok, false);
  assert.equal(failed.player.crew.length, 2);
  assert.equal(failed.player.gacha.pulls, 0);
  player = reload(apply(player, 'tutorial-welcome-pull').player);
  assert.equal(apply(player, 'tutorial-register-complete').ok, false);
  player = reload(apply(player, 'tutorial-register-complete', { registered: true }).player);
  assert.equal(player.tutorial.phase, 'done');
  assert.equal(player.tutorial.registered, true);
  assert.equal(player.ship.name, 'Oddity');
  assert.equal(player.crew.length, 3);
});

test('a forged guided win with a mismatched encounter identity cannot advance the tutorial', () => {
  const player = { ...fresh(), tutorial: { ...fresh().tutorial, phase: 'fight' },
    activeContract: { offerId: 'offer_tutorial_distress', profile: 'distress', stage: 'return',
      acceptanceId: 'route-a', result: { success: true } },
    activeEncounter: { kind: 'guided', acceptanceId: 'route-b', result: 'win', orders: { brace: { used: true } } } };
  assert.equal(advanceTutorialV4(player, 'guided_win'), player);
  const matching = { ...player, activeEncounter: { ...player.activeEncounter, acceptanceId: 'route-a' } };
  assert.equal(advanceTutorialV4(matching, 'guided_win').tutorial.phase, 'claim');
});

test('a saved pre-threat guided encounter can still reveal its first tell', () => {
  const html = renderEncounter({ kind: 'guided', beat: 0, braceUsed: false, revision: 0,
    acceptanceId: 'saved-route', orders: [], hull: 30, shield: 12, enemyHull: 25,
    outputs: {}, systems: {}, result: null });
  assert.match(html, /data-act="encounter-advance"/);
});

test('saved script-3 route and completed veteran retain their existing path', () => {
  let old = { ...fresh(), version: 7, tutorial: defaultTutorial(), contractBoard: null };
  old = prepareSession(reload(old), now);
  assert.equal(old.tutorial.script, 3);
  assert.equal(old.tutorial.phase, 'distress');
  const reviewed = apply(old, 'contract-review', { offer: 'offer_tutorial_distress' });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.player.tutorial.phase, 'launch');
  const veteran = reload({ ...old, tutorial: { ...old.tutorial, phase: 'done', completed: true }, stats: { ...old.stats, jumps: 4 }, wallet: { ...old.wallet, reputation: 23 } });
  assert.equal(veteran.tutorial.script, 3);
  assert.equal(veteran.tutorial.completed, true);
  assert.equal(veteran.wallet.reputation, 23);
});
