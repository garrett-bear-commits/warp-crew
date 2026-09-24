import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction, persistSessionTransition, sessionModels } from '../src/systems/sessionLoop.js';
import { renderShipEncounter } from '../src/ui/contractView.js';

const now = Date.UTC(2030, 8, 23, 12);
const reload = value => migratePlayer(JSON.parse(JSON.stringify(value)));
const identity = player => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });

test('a committed v5 target order lets crew finish every captain fight without manual beat taps or duplicate rewards', async () => {
  // The break caught: the old timer only recognizes script-4 Brace, leaving v5
  // at a text-only Continue fight button after the one intended captain order.
  const { createGuidedBeatScheduler } = await import('../src/ui/guidedBeatScheduler.js').catch(() => ({}));
  assert.equal(typeof createGuidedBeatScheduler, 'function');

  for (const captain of ['captain_cyborg', 'captain_gunner', 'captain_alien', 'captain_droid']) {
    let player = prepareSession(createNewPlayer({ now, rng: () => 0.1 }), now);
    let saved = player;
    let saveCount = 0;
    let failNextSave = false;
    const captures = [];
    const commit = (action, data = {}) => {
      const before = player;
      const transition = sessionAction(player, {}, action, data, { now, rng: () => 0.1 });
      assert.ok(transition, `${action} must use the real session boundary`);
      if (!transition.ok) return transition;
      return persistSessionTransition(transition, {
        save: candidate => {
          assert.equal(player, before, 'the live state must not publish before its save');
          if (failNextSave) { failNextSave = false; return false; }
          saved = reload(candidate);
          saveCount += 1;
          return true;
        },
        publish: () => { player = saved; },
        capture: (event, fields) => captures.push({ event, fields }),
        animate: () => {},
      });
    };

    commit('splash-dismiss');
    commit('captain-choose', { templateId: captain, name: 'Aster' });
    commit('tutorial-first-hire');
    const station = player.crew.find(member => member.instanceId === player.tutorial.firstHireInstanceId).templateId === 'merc_bolt' ? 'shields' : 'weapons';
    commit('station-assign', { id: player.tutorial.firstHireInstanceId, station });
    commit('tutorial-fight-start');

    const timers = new Map();
    let nextTimerId = 0;
    let busy = false;
    const ui = { guidedBeatSaveFailed: null };
    let scheduler;
    scheduler = createGuidedBeatScheduler({
      getPlayer: () => player,
      isBattlePlaying: () => busy,
      onSaveFailure: failedIdentity => { ui.guidedBeatSaveFailed = failedIdentity; },
      advance: data => {
        const result = commit('encounter-advance', data);
        if (result.ok) assert.equal(scheduler.schedule(), false, 'committed render cannot queue while its beat is in flight');
        return result;
      },
      setTimer: callback => { const id = ++nextTimerId; timers.set(id, callback); return id; },
      clearTimer: id => timers.delete(id),
      delay: 1,
    });
    const tick = async () => {
      assert.equal(timers.size, 1, 'at most one crew beat is pending');
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      await callback();
    };
    assert.equal(scheduler.schedule(), false, 'no automatic beat before the order');
    commit('encounter-order', { ...identity(player), order: 'target_weapons' });
    const postOrderModel = sessionModels(player, {}, now).activeContractView;
    assert.equal(postOrderModel.encounter.targetWeaponsUsed, true);
    const postOrder = renderShipEncounter(postOrderModel);
    assert.doesNotMatch(postOrder, /data-act="encounter-advance"|Continue fight/);
    assert.match(postOrder, /Crew engaging/);
    assert.match(postOrder, /Pirate weapons disabled/);
    assert.doesNotMatch(postOrder, /Incoming fire/);
    assert.equal(scheduler.schedule(), true);
    assert.equal(scheduler.schedule(), false, 're-render cannot queue a second beat');

    busy = true;
    await tick();
    assert.equal(timers.size, 1, 'animation defers without advancing');
    busy = false;
    const beforeFailedBeat = player.activeEncounter.revision;
    const beforeFailedSave = saveCount;
    failNextSave = true;
    await tick();
    assert.equal(player.activeEncounter.revision, beforeFailedBeat, 'failed save cannot publish a beat');
    assert.equal(saveCount, beforeFailedSave);
    assert.equal(timers.size, 0, 'failed save does not spin duplicate timers');
    const retry = renderShipEncounter(sessionModels(player, ui, now).activeContractView);
    assert.match(retry, /Retry fight progress/);
    assert.match(retry, /data-act="encounter-advance"/);
    assert.match(retry, new RegExp(`data-revision="${beforeFailedBeat}"`));
    assert.doesNotMatch(retry, /Crew engaging/);

    if (captain === 'captain_cyborg') {
      failNextSave = true;
      assert.equal(commit('encounter-advance', identity(player)).reason, 'save_failed');
      assert.match(renderShipEncounter(sessionModels(player, ui, now).activeContractView), /Retry fight progress/);
      assert.equal(commit('encounter-advance', identity(player)).ok, true);
      assert.doesNotMatch(renderShipEncounter(sessionModels(player, ui, now).activeContractView), /Retry fight progress/,
        'an old retry identity cannot appear after a committed beat');
      assert.equal(scheduler.schedule(), true, 'successful retry returns to automatic crew beats');
    } else {
      player = reload(saved);
      ui.guidedBeatSaveFailed = null;
      assert.equal(scheduler.schedule(), true, 'a reloaded committed order resumes crew combat');
    }
    for (let beats = 0; player.tutorial.phase === 'fight' && beats < 12; beats++) await tick();
    assert.equal(player.tutorial.phase, 'claim', captain);
    assert.equal(player.activeEncounter.result, 'win', captain);
    assert.equal(timers.size, 0, 'victory stops automatic beats');
    assert.equal(captures.filter(item => item.event === 'contract_resolved').length, 1);
    const wallet = { ...player.wallet };
    const claimData = { acceptanceId: player.activeContract.acceptanceId, revision: player.activeContract.revision };
    assert.equal(commit('contract-claim', claimData).ok, true);
    const afterClaim = { ...player.wallet };
    assert.notDeepEqual(afterClaim, wallet);
    assert.equal(commit('contract-claim', claimData).ok, false);
    assert.deepEqual(player.wallet, afterClaim, 'claim pays only once');
    scheduler.cancel();
  }
});

test('a v2 guided window without the committed target order never claims crew is engaging', () => {
  const waiting = renderShipEncounter({ acceptanceId: 'saved-fight', revision: 1, encounter: {
    version: 2, kind: 'guided', beat: 1, result: null, targetWeaponsUsed: false,
    hull: 30, shield: 12, enemyHull: 25, target: 'weapons', orders: [],
  } });
  assert.doesNotMatch(waiting, /Crew engaging|data-act="encounter-advance"/);
});

test('saved script-4 Brace still gates the legacy guided timer', async () => {
  const { createGuidedBeatScheduler } = await import('../src/ui/guidedBeatScheduler.js');
  let player = prepareSession(createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 }), now);
  const act = (action, data = {}) => {
    const transition = sessionAction(player, {}, action, data, { now, rng: () => 0.1 });
    assert.equal(transition.ok, true);
    const committed = persistSessionTransition(transition, {
      save: () => true,
      publish: result => { player = reload(result.player); },
      capture: () => {},
      animate: () => {},
    });
    return committed;
  };
  act('splash-dismiss');
  const bolt = player.crew.find(member => member.templateId === 'merc_bolt');
  act('station-assign', { id: bolt.instanceId, station: 'shields' });
  act('tutorial-fight-start');
  let pending = null;
  const scheduler = createGuidedBeatScheduler({
    getPlayer: () => player,
    isBattlePlaying: () => false,
    advance: data => act('encounter-advance', data),
    setTimer: callback => { pending = callback; return 1; },
    clearTimer: () => { pending = null; },
  });
  assert.equal(scheduler.schedule(), false, 'script 4 waits for Brace');
  act('encounter-order', { ...identity(player), order: 'brace' });
  const beat = player.activeEncounter.beat;
  assert.equal(scheduler.schedule(), true);
  await pending();
  assert.equal(player.activeEncounter.beat, beat + 1);
  scheduler.cancel();
});
