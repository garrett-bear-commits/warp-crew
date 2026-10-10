import { finishCrewFight } from './helpers/crewFight.mjs';
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { ensureContractBoard, contractRewardBand, acceptContract, previewContractAction, commitContractAction, tutorialDistressOffer } from '../src/systems/contracts.js';
import { formatRewardBand, readyContractCrew, resolveContractCombatPayout } from '../src/systems/contractRewards.js';

const now = Date.UTC(2026, 8, 22, 12);
let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, story: { ...player.story, chapter: 1 }, wallet: { ...player.wallet, fuel: 10 } };
player = ensureContractBoard(player, now).player;
const before = JSON.stringify(player);
for (const profile of ['reliable', 'risky', 'strange']) {
  const offer = player.contractBoard.offers.find(x => x.profile === profile);
  const band = contractRewardBand(player, offer, { now });
  assert.equal(band.available, true, profile);
  assert.ok(band.paths.length > 0);
  assert.ok(band.paths.every(path => Object.values(path).every(Number.isFinite)));
  assert.equal(formatRewardBand(band), band.label);
  const accepted = acceptContract(player, offer.id, now).player;
  assert.deepEqual(contractRewardBand(JSON.parse(JSON.stringify(accepted)), accepted.activeContract, { now }), band);
}
assert.equal(JSON.stringify(player), before, 'band mutated player');
assert.equal(formatRewardBand({ available: true, currencies: { credits: { min: 120, max: 120, presentOnAllPaths: true }, medals: { min: 0, max: 8, presentOnAllPaths: false }, reputation: { min: 0, max: 4, presentOnAllPaths: true } } }), '120 credits · up to 8 medals · 0–4 reputation');
const unavailable = { available: false, label: 'Reward unavailable', currencies: {}, paths: [] };
for (const routeContent of [null, {}, { ...player.contractBoard.offers[0].routeContent, routeOutcome: { kind: 'combat', encounter: 'missing' } }]) {
  const offer = { ...player.contractBoard.offers[0], routeContent };
  assert.deepEqual(contractRewardBand(player, offer, { now }), unavailable);
  assert.equal(acceptContract({ ...player, contractBoard: { ...player.contractBoard, offers: [offer] } }, offer.id, now).ok, false);
}
assert.deepEqual(contractRewardBand({ ...player, wallet: { ...player.wallet, fuel: 0 } }, player.contractBoard.offers[0], { now }), unavailable);
let tutorial = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
const distress = tutorialDistressOffer(tutorial);
tutorial = { ...tutorial, contractBoard: { dayKey: 'tutorial', offers: [distress], completedOfferIds: [] } };
const tutorialBand = contractRewardBand(tutorial, distress, { now });
assert.equal(tutorialBand.paths.length, 1);
assert.equal(tutorialBand.label, '120 credits · 8 medals · 4 reputation');
const risky = player.contractBoard.offers.find(x => x.profile === 'risky');
const band = contractRewardBand(player, risky, { now });
const modified = { ...player, ship: { ...player.ship, systems: { ...player.ship.systems, weapons: 9 } } };
assert.notDeepEqual(contractRewardBand(modified, risky, { now }).currencies, band.currencies);
const repeated = { ...player, stats: { ...player.stats, visits: { [risky.destinationId]: 9 } } };
assert.ok(contractRewardBand(repeated, risky, { now }).currencies.credits.max < band.currencies.credits.max);
const crew = [{ instanceId: 'expired', power: 30, status: 'injured', injuredUntil: now }, { instanceId: 'away', power: 100, status: 'expedition' }, { instanceId: 'injured', power: 90, status: 'injured', injuredUntil: now + 1 }, { instanceId: 'ready', power: 20, status: 'ready' }];
assert.deepEqual(readyContractCrew({ crew, crewSlots: 1 }, now).map(x => x.instanceId), ['expired']);
const contract = { profile: 'risky', encounterId: 'eclipse_throne', destinationId: risky.destinationId };
const win = resolveContractCombatPayout(player, contract, 'board', { rng: () => 0, now });
const fail = resolveContractCombatPayout(player, contract, 'board', { rng: () => 1, now });
assert.deepEqual(win.result.rewards, { credits: 525, medals: 45, reputation: 18, gems: 8, fuel: 0 });
assert.deepEqual(fail.result.rewards, { credits: 92, medals: 9, reputation: 0, gems: 0, fuel: 0 });
assert.ok(fail.player.crew.find(x => x.instanceId === fail.result.injuredCrewId).injuredUntil > now);
assert.equal(win.player.stats.combatsWon, (player.stats.combatsWon || 0) + 1);

// A saved high-end encounter distinguishes a present failure zero from omitted gems.
const throne = { ...risky, routeContent: { ...risky.routeContent, routeOutcome: { kind: 'combat', encounter: 'eclipse_throne' }, secureOutcome: { kind: 'combat', encounter: 'eclipse_throne' }, encounterId: 'eclipse_throne' } };
const thronePlayer = { ...player, contractBoard: { ...player.contractBoard, offers: [throne] } };
const throneBand = contractRewardBand(thronePlayer, throne, { now });
// Crew fights have no lucky roll: a starter crew cannot beat the end boss, so only salvage is possible.
assert.equal(throneBand.label, '92 credits · 9 medals');
assert.equal(throneBand.paths.length, 1, 'every losing policy settles to the same salvage');
// Balance pass 2026-10-09: the throne's threat comes from the reference crew (Deadly for a day-1 captain), not
// from this crew, so "strong enough" now means a crew and ship that can actually win that fight.
const veterans = [...thronePlayer.crew, ...['merc_kira', 'merc_tink'].map(id => ({ ...thronePlayer.crew[0], instanceId: `${id}_vet`, templateId: id,
  role: id === 'merc_kira' ? 'gunner' : 'engineer' }))].map(member => ({ ...member, power: 60 }));
const veteranCrew = { ...thronePlayer, crew: veterans, crewSlots: 4,
  ship: { ...thronePlayer.ship, systems: { ...thronePlayer.ship.systems, shields: 6, weapons: 6, engines: 6, sensors: 5 } },
  stationAssignments: { ...thronePlayer.stationAssignments, merc_kira_vet: 'weapons', merc_tink_vet: 'engineering' } };
const veteranBand = contractRewardBand(veteranCrew, throne, { now });
assert.ok(veteranBand.currencies.credits.max > 92, 'a crew strong enough to win sees the victory payout');
const twoFuel = { ...thronePlayer, wallet: { ...player.wallet, fuel: 2 } };
let active = acceptContract(twoFuel, throne.id, now).player;
for (const id of ['launch', 'push']) {
  const committed = commitContractAction(active, previewContractAction(active, { id }, now), { now });
  assert.equal(committed.ok, true);
  active = committed.player;
}
assert.equal(previewContractAction(active, { id: 'order', orderId: 'burn' }, now).ok, false);
assert.deepEqual(contractRewardBand(twoFuel, throne, { now }), throneBand, 'disabled Burn adds no payout path');
assert.deepEqual(contractRewardBand(active, active.activeContract, { now }), throneBand, 'accepted routes do not repay launch/choice costs');
const mutatedBoard = { ...active, contractBoard: { ...active.contractBoard, offers: [{ ...throne, routeContent: null }] } };
assert.deepEqual(contractRewardBand(mutatedBoard, active.activeContract, { now }), throneBand, 'saved accepted identity survives board changes');
const finished = finishCrewFight(active, now);
assert.equal(finished.activeContract.stage, 'return');
assert.deepEqual(finished.activeContract.result.rewards, throneBand.paths[0], 'the settled fight pays what the band promised');
assert.deepEqual(contractRewardBand(finished, finished.activeContract, { now }), unavailable, 'resolved result is displayed separately');
const bad = { ...throne, routeContent: { ...throne.routeContent, encounterId: null } };
assert.deepEqual(contractRewardBand(player, bad, { now }), unavailable, 'inconsistent combat identity is invalid');
// Reject unknown story catalog IDs before fallback rewards can invent a band.
const storyOffer = { ...player.contractBoard.offers.find(x => x.profile === 'strange') };
storyOffer.routeContent = { ...storyOffer.routeContent, encounterId: null, storyFlag: 'rumor_swarm', routeOutcome: { kind: 'story', flag: 'rumor_swarm' }, secureOutcome: { kind: 'story', flag: 'rumor_swarm' } };
const storyPlayer = { ...player, contractBoard: { ...player.contractBoard, offers: [storyOffer] } };
const storyAccepted = acceptContract(storyPlayer, storyOffer.id, now).player;
const invalidStoryResults = [];
for (const flag of ['not_a_real_story', 'toString']) {
  const content = { ...storyOffer.routeContent, storyFlag: flag, routeOutcome: { kind: 'story', flag }, secureOutcome: { kind: 'story', flag } };
  const invalidOffer = { ...storyOffer, routeContent: content };
  const invalidActive = { ...storyAccepted.activeContract, ...content };
  for (const [name, subject, offer] of [
    ['board', storyPlayer, invalidOffer],
    ['accepted', { ...storyAccepted, activeContract: invalidActive }, invalidActive],
  ]) {
    const actual = contractRewardBand(subject, offer, { now });
    if (JSON.stringify(actual) !== JSON.stringify(unavailable)) invalidStoryResults.push({ name, flag, label: actual.label });
  }
}
assert.deepEqual(invalidStoryResults, [], 'malformed board and accepted story identities must be unavailable');
const completedStoryPlayer = { ...storyPlayer, flags: { ...storyPlayer.flags, rumor_swarm: true } };
assert.equal(contractRewardBand(completedStoryPlayer, storyOffer, { now }).label, '40 credits · 3 reputation', 'known completed story retains production fallback');
assert.equal(contractRewardBand({ ...storyAccepted, flags: completedStoryPlayer.flags }, storyAccepted.activeContract, { now }).label, '40 credits · 3 reputation');
console.log('contract_rewards.test.mjs OK');
