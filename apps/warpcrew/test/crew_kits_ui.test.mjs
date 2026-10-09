// The fight screen shows each crew member's signature move: it charges, glows when ready and is a tap target.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNewPlayer } from '../src/systems/player.js';
import { generateContractBoard, acceptContract, previewContractAction, commitContractAction } from '../src/systems/contracts.js';
import { sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { renderFtlControls } from '../src/ui/ftlView.js';

const now = Date.UTC(2030, 8, 22, 12);
const action = (player, id) => {
  const preview = previewContractAction(player, { id }, now);
  assert.equal(preview.ok, true, `${id}: ${preview.reason}`);
  const committed = commitContractAction(player, preview, { now, rng: () => 0.5 });
  assert.equal(committed.ok, true, `${id}: ${committed.reason}`);
  return committed.player;
};
function fight() {
  let player = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
  player = { ...player, tutorial: { ...player.tutorial, completed: true, phase: 'done' }, wallet: { ...player.wallet, fuel: 10 } };
  player = { ...player, contractBoard: generateContractBoard(player, now) };
  const offer = player.contractBoard.offers.find(candidate => candidate.profile === 'reliable');
  player = acceptContract(player, offer.id, now).player;
  return action(action(player, 'launch'), 'push');
}
const view = player => sessionModels(player, {}, now).activeContractView.encounter;

test('every crew member shows their move; a charged move is a tap target', () => {
  let player = fight();
  assert.ok(player.activeEncounter.fx, 'a contract fight is a kit fight');
  let model = view(player);
  assert.equal(model.abilities, true);
  assert.equal(model.auto, true, 'Auto is on by default');
  assert.ok(model.crew.every(member => member.ability && member.ability.move && member.ability.text));
  let html = renderFtlControls(model);
  assert.match(html, /class="ftl-auto is-on"/);
  for (const member of model.crew) assert.ok(html.includes(member.ability.move), `${member.ability.move} is on screen`);
  assert.equal((html.match(/class="ftl-ability[^"]*"[^>]*disabled/g) || []).length, model.crew.length, 'half-charged moves are not tappable yet');

  // Charge the first move: it glows and can be tapped.
  const charged = structuredClone(player);
  charged.activeEncounter.crew[0].charge = 100;
  model = view(charged);
  html = renderFtlControls(model);
  const ready = html.match(/<button type="button" class="ftl-ability is-ready"[^>]*>/);
  assert.ok(ready, 'a ready move glows');
  assert.ok(!/\sdisabled(\s|>)/.test(ready[0]), 'and is enabled');
  assert.match(ready[0], new RegExp(`data-crew-id="${charged.activeEncounter.crew[0].id}"`));

  // Tapping it queues the move through the session; the button shows it is going off.
  const tapped = sessionAction(charged, {}, 'encounter-command', {
    acceptanceId: charged.activeEncounter.acceptanceId, revision: charged.activeEncounter.revision,
    command: { type: 'ability', crewId: charged.activeEncounter.crew[0].id },
  }, { now });
  assert.equal(tapped.ok, true, tapped.reason);
  assert.match(renderFtlControls(view(tapped.player)), /class="ftl-ability is-queued"/);
});

test('switching Auto off sticks for later fights', () => {
  const player = fight();
  const off = sessionAction(player, {}, 'encounter-command', {
    acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision,
    command: { type: 'auto', auto: false },
  }, { now });
  assert.equal(off.ok, true, off.reason);
  assert.equal(off.player.activeEncounter.intent.auto, false);
  assert.equal(off.player.flags.manualAbilities, true, 'the captain prefers manual moves');
  assert.match(renderFtlControls(view(off.player)), /class="ftl-auto"[^>]*data-auto="true"/);
});
