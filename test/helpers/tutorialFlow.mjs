import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../../src/systems/player.js';
import { PHASES, currentTutorialStep, noteTutorialEvent, grantTutorialRecruit, isFeatureUnlocked, advanceTutorial, beginJoinPrompt } from '../../src/systems/tutorial.js';
import { tutorialDistressOffer, reviewContractOffer, acceptContract, previewContractAction, commitContractAction, claimContractReward, abandonContract, ensureContractBoard } from '../../src/systems/contracts.js';
import { previewExpedition, startExpedition } from '../../src/systems/expedition.js';

// Catches a tutorial that advances on old/UI-only events, teaches random combat,
// pays twice, skips real recruitment/away launch, or exposes paid/login prompts.
export function completeFreshTutorial() {
  assert.deepEqual(PHASES.map((phase) => phase.id), ['distress', 'launch', 'order', 'return', 'recruit', 'choose', 'away', 'done']);
  for (const phase of PHASES) {
    assert.notEqual(phase.modal, 'join');
    assert.doesNotMatch([phase.title, phase.body, phase.cta].join(' '), /Register|gems|shop|buy|another device|cross.device/i);
  }
  let player = createNewPlayer();
  const initialWallet = { ...player.wallet };
  function phase(expected) {
    assert.equal(player.tutorial.phase, expected);
    assert.equal(currentTutorialStep(player)?.id ?? 'done', expected);
    if (expected !== 'done') {
      for (const feature of ['shop', 'gacha', 'hud_gems', 'nav_shop']) assert.equal(isFeatureUnlocked(player, feature), false);
    }
    player = migratePlayer(JSON.parse(JSON.stringify(player)));
    assert.equal(player.tutorial.phase, expected, 'reload continuation');
  }
  function event(name, expected, payload = {}) {
    const noted = noteTutorialEvent(player, name, payload);
    assert.equal(noted.advanced, true, name);
    player = noted.player;
    phase(expected);
    assert.equal(noteTutorialEvent(player, name, payload).advanced, false, `${name} replay`);
  }
  phase('distress');
  assert.deepEqual(grantTutorialRecruit(player).player, player, 'recruit cannot skip the distress payout');
  for (const oldEvent of ['combat_done', 'combat_ready', 'recruited', 'contract_launched', 'combat_order_done', 'contract_claimed', 'contract_accepted', 'expedition_start', 'tutorial_complete', 'jest_prompted']) {
    assert.equal(noteTutorialEvent(player, oldEvent).advanced, false, `ignore ${oldEvent}`);
  }
  assert.equal(advanceTutorial(player).tutorial.phase, 'distress', 'UI tap cannot skip an action');
  assert.equal(beginJoinPrompt(player).tutorial.phase, 'distress', 'optional login cannot change tutorial phase');
  const offer = tutorialDistressOffer(player);
  player = { ...player, contractBoard: { dayKey: 'tutorial', offers: [offer], completedOfferIds: [] } };
  const review = reviewContractOffer(player, offer.id);
  assert.equal(review.ok, true);
  assert.equal(review.cost.fuel, 1, 'review shows the single paid distress launch');
  event('contract_reviewed', 'launch', { offerId: offer.id });
  const accepted = acceptContract(player, offer.id);
  assert.equal(accepted.ok, true);
  player = accepted.player;
  assert.equal(player.activeContract.encounterId, 'pirate_scout');
  assert.deepEqual(player.wallet, initialWallet, 'review and accept spend nothing');
  assert.equal(abandonContract(player, 0, player.activeContract.acceptanceId).ok, false, 'cannot abandon tutorial fight');
  const launch = commitContractAction(player, previewContractAction(player, { id: 'launch' }));
  assert.equal(launch.ok, true);
  player = launch.player;
  assert.equal(player.activeContract.stage, 'confrontation');
  event('contract_launched', 'order');
  for (const orderId of ['burn', 'board']) assert.equal(previewContractAction(player, { id: 'order', orderId }).ok, false);
  const brace = previewContractAction(player, { id: 'order', orderId: 'brace' });
  assert.equal(brace.consequence.chance, 1);
  const resolved = commitContractAction(player, brace, { rng: () => 0.999 });
  assert.equal(resolved.ok, true);
  player = resolved.player;
  assert.deepEqual(player.activeContract.result.rewards, { credits: 120, medals: 8, reputation: 4, gems: 0, fuel: 0 });
  assert.equal(player.wallet.credits, initialWallet.credits, 'payout waits for claim');
  event('combat_order_done', 'return');
  const claim = claimContractReward(player);
  assert.equal(claim.ok, true);
  player = claim.player;
  assert.equal(player.wallet.credits, initialWallet.credits + 120);
  assert.equal(player.wallet.medals, initialWallet.medals + 8);
  assert.equal(player.wallet.reputation, initialWallet.reputation + 4);
  assert.ok(initialWallet.fuel - player.wallet.fuel <= 2);
  assert.equal(player.flags.sparrowFirstRepair, true);
  assert.equal(claimContractReward(player).ok, false);
  event('contract_claimed', 'recruit', { rewards: claim.result.rewards });
  assert.equal(player.crewSlots, 3);
  assert.equal(noteTutorialEvent(player, 'recruited').advanced, false, 'recruit needs actual crew grant');
  player = grantTutorialRecruit(player).player;
  assert.equal(player.crew.filter((member) => member.templateId === 'merc_jen').length, 1);
  event('recruited', 'choose');
  const repeatedRecruit = grantTutorialRecruit(player).player;
  assert.equal(repeatedRecruit.tutorial.phase, 'choose', 'recruit replay cannot rewind');
  assert.equal(repeatedRecruit.crew.length, 3);
  assert.equal(player.story.chapter, 1, 'normal daily board has chapter-one content');
  player = ensureContractBoard(player).player;
  assert.deepEqual(player.contractBoard.offers.map((candidate) => candidate.profile), ['reliable', 'risky', 'strange']);
  const next = acceptContract(player, player.contractBoard.offers[0].id);
  assert.equal(next.ok, true);
  player = next.player;
  event('contract_accepted', 'away');
  assert.equal(isFeatureUnlocked(player, 'expeditions'), true);
  assert.equal(noteTutorialEvent(player, 'expedition_start').advanced, false, 'away needs committed job');
  const expedition = previewExpedition(player, 'dustfall');
  assert.ok(expedition.crew.length > 0);
  const crewInstanceIds = expedition.crew.map((member) => member.instanceId);
  const job = startExpedition({ planetId: 'dustfall', crewInstanceIds, successChance: expedition.chance, roleHit: expedition.roleHit });
  player = { ...player, activeExpedition: job, crew: player.crew.map((member) => crewInstanceIds.includes(member.instanceId) ? { ...member, status: 'expedition' } : member) };
  event('expedition_start', 'done', { planetId: 'dustfall' });
  assert.equal(player.tutorial.completed, true);
  assert.equal(player.tutorial.ordersBeat, 'done');
  assert.equal(player.crewSlots, 4);
  assert.equal(currentTutorialStep(player), null);
  assert.equal(isFeatureUnlocked(player, 'shop'), true);
  return player;
}
