import assert from 'node:assert/strict';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { migratePlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { routeEventFor, routeChoiceMatches } from '../src/systems/travelEvents.js';
import { ROUTE_EVENTS } from '../src/data/events.js';
import { renderOverlays } from '../src/ui/bridge.js';

const now = Date.UTC(2030, 8, 22, 12);
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));

// The card a contract shows is fixed by the contract and fits its profile; the tutorial distress call has none.
assert.equal(routeEventFor({ profile: 'distress', routeSeed: 1, acceptanceId: 'a' }), null);
for (const profile of ['reliable', 'risky', 'strange']) {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const contract = { profile, routeSeed: seed, acceptanceId: `c:${seed}` };
    const event = routeEventFor(contract);
    assert.ok(event.profiles.includes(profile));
    assert.equal(routeEventFor({ ...contract }), event, 'deterministic');
    seen.add(event.id);
  }
  assert.ok(seen.size >= 3, `${profile}: several events rotate (${seen.size})`);
}
assert.ok(ROUTE_EVENTS.length >= 6);

// A real contract reaches its route choice and shows an event card with real stakes.
let base = completeFreshTutorial();
base = prepareSession({ ...base, activeContract: null, activeEncounter: null, activeExpedition: null,
  crew: base.crew.map(c => ({ ...c, status: 'ready', injuredUntil: 0 })), wallet: { ...base.wallet, fuel: 10 } }, now);
let tested = 0;
const ident = player => ({ acceptanceId: player.activeContract.acceptanceId, revision: player.activeContract.revision });
for (const profile of ['reliable', 'risky', 'strange']) {
  const offer = base.contractBoard.offers.find(o => o.profile === profile);
  if (!offer) continue;
  tested += 1;
  let player = sessionAction(base, {}, 'contract-accept', { offer: offer.id }, { now }).player;
  player = sessionAction(player, {}, 'contract-action', { action: 'launch', ...ident(player) }, { now }).player;
  assert.equal(player.activeContract.stage, 'choice');
  const models = sessionModels(player, {}, now);
  const card = models.routeEvent;
  assert.ok(card, `${profile}: route event`);
  assert.equal(models.activeContractView.routeEvent, card);
  assert.equal(card.id, routeEventFor(player.activeContract).id);
  assert.deepEqual(card.choices.map(c => c.route).sort(), ['push', 'secure']);
  for (const choice of card.choices) {
    assert.match(choice.stakes, /^(Fight: .+ · (Favorable|Even|Dangerous|Deadly) · win .+|Pays .+|Story lead · .+)$/, `${profile}/${choice.id}: ${choice.stakes}`);
    assert.equal(choice.fuel, models.contractPreviews[choice.route].cost.fuel);
    // A fight is promised exactly when the action leads to a confrontation.
    assert.equal(choice.fight, models.contractPreviews[choice.route].consequence.nextStage === 'confrontation');
  }
  // Reload shows the same card.
  assert.deepEqual(sessionModels(reload(player), {}, now).routeEvent, card);
  // The ship overlay shows the card, bound to the contract identity.
  const html = renderOverlays(player, { isHome: true, selectedRoom: null, activeContractView: models.activeContractView });
  assert.match(html, /aria-label="Route choice"/);
  assert.ok(html.includes(card.title.replaceAll("'", '&#39;').replaceAll('"', '&quot;')));
  assert.doesNotMatch(html, /Signal ahead/);
  for (const choice of card.choices) {
    assert.match(html, new RegExp(`data-action="${choice.route}" data-choice="${choice.id}" data-revision="${player.activeContract.revision}"`));
  }
  // A choice must belong to this event and match its action.
  const secure = card.choices.find(c => c.route === 'secure');
  const push = card.choices.find(c => c.route === 'push');
  assert.equal(routeChoiceMatches(player.activeContract, push.id, 'secure'), false);
  assert.equal(sessionAction(player, {}, 'contract-action', { action: 'secure', choice: push.id, ...ident(player) }, { now }).reason, 'stale_contract_action');
  assert.equal(sessionAction(player, {}, 'contract-action', { action: 'secure', choice: 'made_up', ...ident(player) }, { now }).reason, 'stale_contract_action');
  const chosen = sessionAction(player, {}, 'contract-action', { action: 'secure', choice: secure.id, ...ident(player) }, { now });
  assert.equal(chosen.ok, true, chosen.reason);
  const analytics = chosen.events.find(e => e.event === 'contract_action');
  assert.equal(analytics.fields.routeEvent, card.id);
  assert.equal(analytics.fields.choice, secure.id);
  // Same result as the bare action: route events change presentation, not outcomes.
  const bare = sessionAction(player, {}, 'contract-action', { action: 'secure', ...ident(player) }, { now });
  assert.deepEqual(bare.player, chosen.player);
  // A choice id is refused once the contract has moved past its route choice.
  assert.equal(sessionAction(chosen.player, {}, 'contract-action', { action: 'secure', choice: secure.id, ...ident(chosen.player) }, { now }).ok, false);
}

assert.equal(tested, 3, 'all three profiles exercised');
console.log('route_events.test.mjs OK');
