import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { ensureContractBoard, acceptContract, previewContractAction, commitContractAction, claimContractReward } from '../src/systems/contracts.js';
import { prepareSession, sessionAction, sessionModels, persistSessionTransition } from '../src/systems/sessionLoop.js';
import { NODES } from '../src/data/sectors.js';

const now = new Date(2026, 8, 21, 12).getTime();
const reload = player => prepareSession(migratePlayer(JSON.parse(JSON.stringify(player))), now);
const veteran = () => ({ ...createNewPlayer(), tutorial: { script: 3, completed: true, phase: 'done' } });
const identity = player => ({ revision: player.activeContract.revision, acceptanceId: player.activeContract.acceptanceId });
function step(player, id, orderId = 'brace', rng = () => 0) {
  const result = commitContractAction(player, previewContractAction(player, { id, orderId }), { rng });
  assert.equal(result.ok, true, result.reason);
  return result.player;
}
function accepted(profile = 'risky', destinationId = null, day = now) {
  let player = ensureContractBoard(veteran(), day).player;
  const offer = player.contractBoard.offers.find(offer => offer.profile === profile);
  if (destinationId) offer.destinationId = destinationId;
  return acceptContract(player, offer.id).player;
}
function tutorialAt(stage) {
  let player = prepareSession(createNewPlayer(), now);
  for (const [act, data] of [['contract-review', { offer: 'offer_tutorial_distress' }], ['contract-accept', { offer: 'offer_tutorial_distress' }]]) {
    player = sessionAction(player, {}, act, data, { now }).player;
  }
  if (stage !== 'briefing') player = sessionAction(player, {}, 'contract-action', { action: 'launch', ...identity(player) }, { now }).player;
  if (stage === 'return') player = sessionAction(player, {}, 'contract-order', { order: 'brace', ...identity(player) }, { now }).player;
  return player;
}

test('completed offers survive day A to B to A, reload, and stale-result replay', () => {
  let player = step(step(step(accepted(), 'launch'), 'push'), 'order');
  const resolved = player.activeContract;
  player = claimContractReward(player).player;
  const wallet = { ...player.wallet };
  const stats = structuredClone(player.stats);
  player = ensureContractBoard(player, now + 86400000).player;
  player = migratePlayer(JSON.parse(JSON.stringify(player)));
  player = ensureContractBoard(player, now).player;
  assert.ok(player.contractBoard.completedOfferIds.includes(resolved.offerId), 'day rollover must retain completed identity');
  assert.equal(acceptContract(player, resolved.offerId).reason, 'offer_completed');
  assert.equal(claimContractReward({ ...player, activeContract: resolved }).reason, 'already_claimed');
  assert.deepEqual(player.wallet, wallet);
  assert.deepEqual(player.stats, stats);
  assert.equal(player.contractBoard.dayKey, '2026-09-21', 'clock recovery may reopen that local day');
});

test('saved tutorial return remains claimable after encounter catalog loss', () => {
  const player = tutorialAt('return');
  player.activeContract.encounterId = 'removed_encounter';
  const restored = reload(player);
  assert.equal(restored.activeContract?.stage, 'return', 'stored result no longer needs encounter content');
  const claimed = sessionAction(restored, {}, 'contract-claim', identity(restored), { now });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.player.wallet.credits, 200);
  assert.equal(claimed.player.tutorial.phase, 'recruit');
  assert.equal(sessionAction(claimed.player, {}, 'contract-claim', identity(restored), { now }).ok, false);
});

test('invalid pre-result tutorial routes recover playably without repeating launch spend', () => {
  for (const stage of ['briefing', 'choice', 'confrontation']) {
    let player = tutorialAt(stage === 'briefing' ? 'briefing' : 'confrontation');
    player.activeContract.stage = stage;
    player.activeContract.encounterId = 'removed_encounter';
    const fuel = player.wallet.fuel;
    player = reload(player);
    assert.equal(player.activeContract, null);
    assert.equal(player.tutorial.phase, 'distress', `${stage}: restart playable review`);
    player = sessionAction(player, {}, 'contract-review', { offer: 'offer_tutorial_distress' }, { now }).player;
    player = sessionAction(player, {}, 'contract-accept', { offer: 'offer_tutorial_distress' }, { now }).player;
    player = sessionAction(player, {}, 'contract-action', { action: 'launch', ...identity(player) }, { now }).player;
    assert.equal(player.wallet.fuel, stage === 'briefing' ? fuel - 1 : fuel, `${stage}: paid launch cannot repeat`);
    player = reload(player);
    player = sessionAction(player, {}, 'contract-order', { order: 'brace', ...identity(player) }, { now }).player;
    player = sessionAction(player, {}, 'contract-claim', identity(player), { now }).player;
    assert.equal(player.wallet.credits, 200);
    assert.equal(player.tutorial.phase, 'recruit');
    assert.equal(claimContractReward(reload(player)).reason, 'already_claimed');
  }
});

test('Risky branches snapshot low and high authored destination encounters and disclose fallback', () => {
  // Danger Belt authors Eclipse Probe (20) and Pirate Wing (22).
  const player = step(accepted('risky', 'danger_belt'), 'launch');
  const secure = previewContractAction(player, { id: 'secure' });
  const push = previewContractAction(player, { id: 'push' });
  assert.equal(secure.consequence.encounterId, 'swarm_probe');
  assert.equal(push.consequence.encounterId, 'pirate_wing');
  const secured = step(reload(player), 'secure');
  const pushed = step(reload(player), 'push');
  assert.equal(secured.activeContract.stage, 'confrontation');
  assert.equal(pushed.activeContract.stage, 'confrontation');
  assert.equal(secured.activeContract.encounterId, 'swarm_probe');
  assert.equal(pushed.activeContract.encounterId, 'pirate_wing');
  assert.ok(previewContractAction(secured, { id: 'order', orderId: 'brace' }).consequence.chance > previewContractAction(pushed, { id: 'order', orderId: 'brace' }).consequence.chance);
  assert.ok(step(secured, 'order').activeContract.result.rewards.credits < step(pushed, 'order').activeContract.result.rewards.credits);
  const actions = sessionModels(player).activeContractView.actions;
  assert.match(actions[0].consequence, /Eclipse Probe/);
  assert.match(actions[1].consequence, /Pirate Wing/);
  for (const node of Object.values(NODES).filter(node => node.outcomes?.filter(o => o.kind === 'combat').length === 1)) {
    const single = step(accepted('risky', node.id), 'launch');
    const branches = sessionModels(single).activeContractView.actions;
    assert.match(branches[0].consequence, /same encounter/i, node.id);
    assert.match(branches[1].consequence, /same encounter/i, node.id);
    assert.doesNotMatch(branches.map(b => b.consequence).join(' '), /stronger|lower.risk/i);
  }
});

test('contract claims apply route, win, and participant XP progression once with tutorial exceptions', () => {
  for (const success of [true, false]) {
    let player = step(step(accepted(), 'launch'), 'push');
    const participants = player.crew.map(c => c.instanceId);
    player = step(player, 'order', 'brace', () => success ? 0 : 1);
    assert.equal(player.stats.combatsWon, success ? 1 : 0, 'combat progression commits with combat resolution');
    assert.deepEqual(player.crew.map(c => c.xp), success ? [10, 10] : [0, 0], 'participants earn XP before later crew management');
    const oldIdentity = identity(player);
    const beforeClaim = structuredClone(player.stats);
    player = reload(player);
    const claimed = sessionAction(player, {}, 'contract-claim', identity(player), { now });
    assert.equal(claimed.player.stats.jumps, 1, 'one completed route counts as one jump');
    assert.equal(claimed.player.stats.combatsWon, success ? 1 : 0, 'only victory advances win progress');
    assert.deepEqual(claimed.player.crew.filter(c => participants.includes(c.instanceId)).map(c => c.xp), success ? [10, 10] : [0, 0]);
    assert.equal(sessionAction(claimed.player, {}, 'contract-claim', oldIdentity, { now }).ok, false);
    assert.deepEqual(player.stats, beforeClaim, 'claim does not mutate its input');
  }
  let tutorial = tutorialAt('return');
  tutorial = sessionAction(reload(tutorial), {}, 'contract-claim', identity(tutorial), { now }).player;
  assert.equal(tutorial.stats.jumps, 1);
  assert.equal(tutorial.stats.combatsWon, 0, 'scripted contract victory is excluded from earned wins');
  assert.deepEqual(tutorial.crew.map(c => c.xp), [0, 0]);
  let reliable = step(step(accepted('reliable'), 'launch'), 'secure');
  reliable = claimContractReward(reliable).player;
  assert.equal(reliable.stats.jumps, 1);
  assert.equal(reliable.stats.combatsWon, 0);
});

test('offer beat ranges and resolution telemetry match committed route branches across days', () => {
  for (let day = 0; day < 20; day++) for (const profile of ['reliable', 'risky', 'strange']) {
    const initial = accepted(profile, null, now + day * 86400000);
    const offer = initial.contractBoard.offers.find(o => o.profile === profile);
    const actual = [];
    for (const choice of ['secure', 'push']) {
      let player = step(initial, 'launch');
      let beats = 1;
      let result = sessionAction(player, {}, 'contract-action', { action: choice, ...identity(player) }, { now, rng: () => 0 });
      beats++;
      player = result.player;
      if (player.activeContract.stage === 'confrontation') {
        result = sessionAction(player, {}, 'contract-order', { order: 'brace', ...identity(player) }, { now, rng: () => 0 });
        beats++;
      }
      assert.equal(result.events.find(e => e.event === 'contract_resolved').fields.beats, beats, `${profile} ${day} ${choice}: telemetry counts committed beats`);
      actual.push(beats);
    }
    assert.equal(offer.beats, Math.max(...actual), `${profile}: maximum expected beats`);
    assert.equal(offer.beatLabel, actual[0] === actual[1] ? `${actual[0]} beats` : '2–3 beats', `${profile}: branch-aware card`);
  }
});

test('existing saved boards repair displayed beat lengths without rerolling their offer identity', () => {
  let player = ensureContractBoard(veteran(), now).player;
  const before = structuredClone(player.contractBoard.offers);
  player.contractBoard.offers = player.contractBoard.offers.map(offer => ({ ...offer, routeContent: undefined, beats: 99, beatLabel: '99 beats' }));
  player = ensureContractBoard(migratePlayer(JSON.parse(JSON.stringify(player))), now).player;
  assert.deepEqual(player.contractBoard.offers.map(o => [o.id, o.destinationId, o.title, o.brief]), before.map(o => [o.id, o.destinationId, o.title, o.brief]));
  assert.deepEqual(player.contractBoard.offers.map(o => o.beatLabel), before.map(o => o.beatLabel), 'legacy board length must match its deterministic content');
});

test('production launch and Jen descriptors show the ship only after durable publication', () => {
  const player = tutorialAt('briefing');
  const launch = sessionAction(player, {}, 'contract-action', { action: 'launch', ...identity(player) }, { now });
  assert.equal(launch.ui.tab, 'ship', 'launch displays the Sparrow');
  assert.equal(launch.effect.kind, 'launch');
  let returned = tutorialAt('return');
  returned = sessionAction(returned, {}, 'contract-claim', identity(returned), { now }).player;
  const recruit = sessionAction(returned, {}, 'tutorial-draw', {}, { now });
  assert.equal(recruit.effect?.kind, 'crew-arrival');
  assert.equal(recruit.effect.crewInstanceId, recruit.player.crew.find(c => c.templateId === 'merc_jen').instanceId);
  assert.equal(recruit.ui.tab, 'ship');
  for (const transition of [launch, recruit]) {
    const sequence = [];
    const callbacks = { save: () => false, publish: () => sequence.push('publish'), animate: () => sequence.push('animate') };
    persistSessionTransition(transition, callbacks);
    assert.deepEqual(sequence, [], 'save failure cannot expose presentation');
    persistSessionTransition(transition, { ...callbacks, save: () => { sequence.push('save'); return true; } });
    assert.deepEqual(sequence, ['save', 'publish', 'animate']);
  }
});
