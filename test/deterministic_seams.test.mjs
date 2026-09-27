import assert from 'node:assert/strict';
import { createCrewInstance } from '../src/data/crewRoster.js';
import { createNewPlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction, claimContractReward, contractDayKey } from '../src/systems/contracts.js';
import { makeTimedJob, wallClockProgress } from '../src/shared/timer.js';
import { abortPayoutFrac, resolveExpedition } from '../src/systems/expedition.js';
import { sessionAction, sessionModels } from '../src/systems/sessionLoop.js';

const now = Date.UTC(2030, 8, 22, 12);
const makeRng = () => {
  const values = [0.25, 0.5];
  return () => values.shift() ?? 0.75;
};

// A missing clock or RNG injection changes the saved player and crew identity.
const a = createNewPlayer({ captainName: 'Sim', tutorialScript: 4, now, rng: makeRng() });
const b = createNewPlayer({ captainName: 'Sim', tutorialScript: 4, now, rng: makeRng() });
assert.deepEqual(a, b);
assert.equal(a.createdAt, now);
assert.equal(a.fuelClaimAt, now);
assert.notEqual(a.crew[0].instanceId, a.crew[1].instanceId);
assert.equal(createCrewInstance('merc_rex', { instanceId: 'fixed' }).instanceId, 'fixed');

// Contract previews and commits must agree when simulated time crosses an injury deadline.
const board = generateContractBoard(a, now);
const offer = board.offers.find((candidate) => candidate.profile === 'reliable');
const accepted = acceptContract({ ...a, contractBoard: board }, offer.id, now);
assert.equal(accepted.ok, true);
assert.equal(accepted.player.activeContract.acceptedAt, now);
const injured = {
  ...accepted.player,
  crew: accepted.player.crew.map((crew) => ({ ...crew, status: 'injured', injuredUntil: now + 1000 })),
};
assert.equal(previewContractAction(injured, { id: 'launch' }, now).reason, 'no_ready_crew');
const launch = previewContractAction(injured, { id: 'launch' }, now + 1000);
assert.equal(launch.ok, true);
const launched = commitContractAction(injured, launch, { now: now + 1000, rng: () => 0 });
assert.equal(launched.ok, true);
const secure = previewContractAction(launched.player, { id: 'secure' }, now + 1000);
const returned = commitContractAction(launched.player, secure, { now: now + 1000, rng: () => 0 });
assert.equal(returned.ok, true);
const claimedAt = now + 86_400_000;
const claimed = claimContractReward(returned.player, claimedAt);
assert.equal(claimed.ok, true);
assert.equal(claimed.player.dailyLoop.dayKey, contractDayKey(claimedAt));
assert.equal(claimed.analytics.elapsedSeconds, 86_400);

// The session entry points must forward their supplied clock to those transitions.
const sessionAccepted = sessionAction({ ...a, tutorial: { script: 3, completed: true, phase: 'done' }, contractBoard: board }, {}, 'contract-accept', { offer: offer.id }, { now, rng: () => 0 });
assert.equal(sessionAccepted.ok, true);
assert.equal(sessionAccepted.player.activeContract.acceptedAt, now);
const sessionInjured = { ...sessionAccepted.player, crew: injured.crew };
const models = sessionModels(sessionInjured, {}, now + 1000);
assert.equal(models.contractPreviews.launch.ok, true);
assert.equal(sessionAction(sessionInjured, models, 'contract-action', {
  action: 'launch', revision: sessionInjured.activeContract.revision, acceptanceId: sessionInjured.activeContract.acceptanceId,
}, { now: now + 1000, rng: () => 0 }).ok, true);

const job = makeTimedJob({ id: 'exp_test', kind: 'expedition', minutes: 60, startedAt: now, payload: { planetId: 'dustfall', crewInstanceIds: [], successChance: 1 } });
assert.equal(wallClockProgress(job, now + 59 * 60000).complete, false);
assert.equal(resolveExpedition(job, { now: now + 59 * 60000, rng: () => 0, player: a }).ready, false);
assert.equal(resolveExpedition(job, { now: now + 60 * 60000, rng: () => 0, player: a }).ready, true);
assert.equal(abortPayoutFrac(job, now + 29 * 60000), 0);
assert.equal(abortPayoutFrac(job, now + 30 * 60000), 0.25);
console.log('deterministic_seams.test.mjs OK');
