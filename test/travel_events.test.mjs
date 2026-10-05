import assert from 'node:assert/strict';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { migratePlayer } from '../src/systems/player.js';
import { NODES, STORY_BEATS } from '../src/data/sectors.js';
import { TRAVEL_EVENTS, ROUTE_EVENTS, TRAVEL_EVENT_BY_ID } from '../src/data/events.js';
import { catalogById } from '../src/data/crewRoster.js';
import { eventCandidates, validTravelEvent, normalizeEventState, eventView, rollOutcome, eventReward, EVENT_VERSION } from '../src/systems/travelEvents.js';
import { validTravelFight } from '../src/systems/travelFight.js';
import { sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { renderEventCard, renderEventResult } from '../src/ui/eventView.js';
import { auditExploreEvents } from '../src/sim/contractEconomy.js';

const now = Date.UTC(2030, 8, 22, 12);
const reload = player => migratePlayer(JSON.parse(JSON.stringify(player)));
const act = (player, name, data = {}, options = {}) => sessionAction(player, {}, name, data, { now, ...options });

// 1. Content: counts, shape, voice, and no placeholder text.
assert.ok(TRAVEL_EVENTS.length >= 24, `at least 24 travel events (${TRAVEL_EVENTS.length})`);
assert.ok(ROUTE_EVENTS.length >= 6, `at least 6 route events (${ROUTE_EVENTS.length})`);
assert.equal(new Set(TRAVEL_EVENTS.map(e => e.id)).size, TRAVEL_EVENTS.length);
assert.equal(new Set(ROUTE_EVENTS.map(e => e.id)).size, ROUTE_EVENTS.length);
const sentences = text => text.split(/(?<=[.!?])\s+(?=[A-Z"])/).filter(Boolean).length;
const placeholder = /\b(TODO|TBD|lorem|placeholder|FIXME)\b|\{(?!crew\})/i;
const roles = new Set(['pilot', 'gunner', 'scout', 'engineer', 'medic', 'security', 'trader']);
const copyOf = ev => [ev.title, ev.text, ...ev.choices.flatMap(c => [c.label, ...(c.outcomes || []).map(o => o.text)])].join('\n');
const nodeSectors = new Set(Object.values(NODES).map(n => n.sector));
for (const ev of TRAVEL_EVENTS) {
  assert.ok(sentences(ev.text) >= 2 && sentences(ev.text) <= 4, `${ev.id}: two to four sentences (${sentences(ev.text)})`);
  assert.ok(ev.choices.length >= 2 && ev.choices.length <= 3, `${ev.id}: two or three choices`);
  assert.doesNotMatch(copyOf(ev), placeholder, `${ev.id}: no placeholder text`);
  for (const sector of ev.sectors || []) assert.ok(nodeSectors.has(sector), `${ev.id}: sector ${sector}`);
  for (const id of [...(ev.nodes || []), ...(ev.notNodes || [])]) assert.ok(NODES[id], `${ev.id}: node ${id}`);
  for (const choice of ev.choices) {
    if (choice.need?.role) assert.ok(roles.has(choice.need.role), `${ev.id}/${choice.id}: role`);
    if (choice.need?.captain) assert.ok(catalogById(choice.need.captain), `${ev.id}/${choice.id}: captain`);
    assert.ok(choice.outcomes.length >= 1);
    for (const outcome of choice.outcomes) {
      assert.ok(outcome.w > 0 && typeof outcome.text === 'string' && outcome.text.length > 10, `${ev.id}/${choice.id}: outcome`);
      if (outcome.pay != null) assert.ok(outcome.pay > 0 && outcome.pay <= 1, `${ev.id}/${choice.id}: pay is a fraction of the base`);
      if (outcome.hire) assert.ok(catalogById(outcome.hire)?.hireCost && choice.cost?.credits > 0, `${ev.id}/${choice.id}: hire costs credits`);
      if (outcome.story) assert.ok(ev.kinds.every(kind => kind === 'story'), `${ev.id}: story results only on story events`);
      if (outcome.text.includes('{crew}')) assert.ok(choice.need, `${ev.id}/${choice.id}: {crew} needs a doer`);
    }
  }
  // Story events keep the story reachable: one free choice with no requirement that can set it.
  if (ev.kinds.includes('story')) {
    assert.ok(ev.choices.some(c => !c.need && !c.cost && c.outcomes.some(o => o.story)), `${ev.id}: free path to the story`);
  }
}
// Gates unlock sectors, so their events always have a free choice that sets the story every time.
for (const ev of TRAVEL_EVENTS.filter(e => e.nodes?.includes('veil_gate'))) {
  assert.ok(ev.choices.some(c => !c.need && !c.cost && c.outcomes.every(o => o.story)), `${ev.id}: gate always opens on a free choice`);
}
for (const ev of ROUTE_EVENTS) {
  assert.ok(sentences(ev.text) >= 2 && sentences(ev.text) <= 4, `${ev.id}: two to four sentences`);
  assert.deepEqual(ev.choices.map(c => c.route).sort(), ['push', 'secure'], `${ev.id}: one choice per route`);
  assert.doesNotMatch(copyOf(ev), placeholder);
}
for (const profile of ['reliable', 'risky', 'strange']) {
  assert.ok(ROUTE_EVENTS.filter(e => e.profiles.includes(profile)).length >= 3, `${profile}: at least three route events`);
}

// 2. Coverage: every beacon's every non-combat arrival has at least two events.
for (const node of Object.values(NODES)) {
  for (const outcome of node.outcomes || []) {
    if (outcome.kind === 'combat') continue;
    assert.ok(eventCandidates(node, outcome).length >= 2, `${node.id}/${outcome.kind}${outcome.flag ? `/${outcome.flag}` : ''}: two or more events`);
  }
}

// A settled captain at Spur Anchor with the starter crew aboard and a free berth.
let base = completeFreshTutorial();
base = { ...base, location: 'station_home', activeContract: null, activeEncounter: null, activeExpedition: null,
  crew: base.crew.map(c => ({ ...c, status: 'ready', injuredUntil: 0 })), wallet: { ...base.wallet, fuel: 10, credits: 500 } };
const roleOf = role => base.crew.find(c => c.role === role);
assert.ok(roleOf('pilot') && roleOf('engineer') && roleOf('gunner'));

/** Saved event exactly as openTravelEvent would write it. */
function withEvent(player, nodeId, outcomeIndex, templateId, seed = 12345) {
  const outcome = NODES[nodeId].outcomes[outcomeIndex];
  const eventBase = { kind: outcome.kind };
  for (const key of ['credits', 'medals', 'reputation']) if (outcome[key] != null) eventBase[key] = outcome[key];
  if (outcome.kind === 'story') eventBase.flag = outcome.flag;
  const activeEvent = { version: EVENT_VERSION, eventId: `event:${nodeId}:9:${seed}`, templateId, nodeId, fromNodeId: player.location,
    base: eventBase, seed, fuelSpent: 1, openedAt: now };
  assert.equal(validTravelEvent({ ...player, activeEvent }), true, `${templateId} fits ${nodeId}`);
  return { ...player, activeEvent };
}

// 3. A non-combat jump opens a saved event: fuel paid, arrival deferred, nothing paid yet.
const jumped = act(base, 'travel-to', { node: 'outpost_trade' }, { rng: () => 0.1 });
assert.equal(jumped.ok, true, jumped.reason);
let player = jumped.player;
const opened = player.activeEvent;
assert.equal(opened.nodeId, 'outpost_trade');
assert.deepEqual(opened.base, { kind: 'trade', credits: 100, reputation: 4 });
assert.equal(player.wallet.fuel, base.wallet.fuel - opened.fuelSpent);
assert.equal(player.wallet.credits, base.wallet.credits);
assert.equal(player.location, 'station_home');
assert.equal(player.stats.jumps, base.stats.jumps);
assert.deepEqual(player.stats.visits, base.stats.visits);
assert.ok(jumped.events.some(e => e.event === 'travel_event_opened'));
assert.equal(jumped.effect.kind, 'event-open');
// Same jump from the same save opens the same event (seeded by save identity and jump count).
assert.deepEqual(act(base, 'travel-to', { node: 'outpost_trade' }, { rng: () => 0.1 }).player.activeEvent, opened);

// 4. Reload mid-event shows the same card.
const restored = reload(player);
assert.deepEqual(restored.activeEvent, opened);
assert.deepEqual(eventView(restored, now), eventView(player, now));
const view = sessionModels(player, {}, now).activeEventView;
assert.equal(view.eventId, opened.eventId);
assert.equal(view.choices.length, TRAVEL_EVENT_BY_ID[opened.templateId].choices.length);

// 5. One thing at a time.
assert.equal(act(player, 'travel-to', { node: 'lane_a' }).reason, 'event_active');
assert.equal(act(player, 'contract-review', { offer: player.contractBoard.offers[0].id }).reason, 'event_active');
assert.equal(act(player, 'contract-accept', { offer: player.contractBoard.offers[0].id }).reason, 'event_active');

// 6. Resolve once: pays, arrives, clears. A repeat or stale tap pays nothing.
const choice = view.choices.find(c => c.available && !c.cost);
assert.equal(act(player, 'event-choose', { eventId: 'event:outpost_trade:1:1', choice: choice.id }).reason, 'stale_event');
assert.equal(act(player, 'event-choose', { eventId: opened.eventId, choice: 'nope' }).reason, 'unknown_choice');
const resolved = act(player, 'event-choose', { eventId: opened.eventId, choice: choice.id });
assert.equal(resolved.ok, true, resolved.reason);
const after = resolved.player;
assert.equal(after.activeEvent, null);
assert.equal(after.location, 'outpost_trade');
assert.equal(after.stats.jumps, base.stats.jumps + 1);
assert.equal(after.stats.visits.outpost_trade, (base.stats.visits.outpost_trade || 0) + 1);
const outcome = rollOutcome(opened, TRAVEL_EVENT_BY_ID[opened.templateId].choices.find(c => c.id === choice.id));
const expected = eventReward(player, opened, outcome.pay || 0);
assert.equal(after.wallet.credits - player.wallet.credits, expected.credits);
assert.equal(after.wallet.reputation - player.wallet.reputation, expected.reputation);
assert.ok(expected.credits <= 100, 'never above the instant trade value');
assert.ok(resolved.ui.eventResult.title);
assert.equal(resolved.effect.kind, 'travel');
assert.equal(act(after, 'event-choose', { eventId: opened.eventId, choice: choice.id }).reason, 'no_active_event');
assert.equal(act(reload(after), 'event-choose', { eventId: opened.eventId, choice: choice.id }).reason, 'no_active_event');
// Deterministic: the same choice from the same state lands the same way (reload cannot re-roll).
assert.deepEqual(act(reload(player), 'event-choose', { eventId: opened.eventId, choice: choice.id }).player, after);
assert.equal(act(after, 'event-dismiss').ui.eventResult, null);

// 7. Tampered or torn events are dropped on load with no payout.
const tamper = (patch, reason = 'invalid_event_state') => {
  const broken = { ...player, activeEvent: { ...opened, ...patch } };
  const loaded = reload(broken);
  assert.equal(loaded.activeEvent, null, JSON.stringify(patch));
  assert.equal(loaded.wallet.credits, player.wallet.credits);
  assert.equal(loaded.recoveryEvents.at(-1).event, 'travel_event_recovered');
  assert.equal(loaded.recoveryEvents.at(-1).reason, reason);
};
tamper({ base: { ...opened.base, credits: 5000 } });
tamper({ templateId: 'not_an_event' });
tamper({ templateId: 'dead_band' }, 'invalid_event_state');
tamper({ seed: opened.seed + 1 });
tamper({ nodeId: 'lane_a' });
tamper({ version: 99 });
tamper({ fuelSpent: -1 });
const withContract = { ...player, activeContract: { id: 'x' } };
assert.equal(normalizeEventState(withContract).activeEvent, null);
assert.equal(normalizeEventState(withContract).recoveryEvents.at(-1).reason, 'contract_active');
assert.equal(normalizeEventState(player), player, 'a valid event is untouched');

// 8. Role, captain and cost gating, shown with who does it or why not.
let gated = withEvent(base, 'scrapyard', 0, 'hot_reactor');
let card = eventView(gated, now);
const safe = card.choices.find(c => c.id === 'safe');
assert.equal(safe.tag, 'Engineer');
assert.equal(safe.doer, roleOf('engineer').name);
assert.equal(safe.available, true);
const noEngineer = { ...gated, crew: gated.crew.map(c => c.role === 'engineer' ? { ...c, status: 'expedition' } : c) };
const away = eventView(noEngineer, now).choices.find(c => c.id === 'safe');
assert.equal(away.available, false);
assert.equal(away.reason, `${roleOf('engineer').name} is away`);
assert.equal(act(noEngineer, 'event-choose', { eventId: gated.activeEvent.eventId, choice: 'safe' }).reason, 'choice_unavailable');
gated = withEvent(base, 'outpost_trade', 0, 'short_weight');
assert.equal(eventView(gated, now).choices.find(c => c.id === 'call').reason, 'No Trader aboard');
gated = withEvent(base, 'forge_moon', 1, 'foundry_voice');
assert.equal(eventView(gated, now).choices.find(c => c.id === 'machine').reason, 'Needs a droid captain');
gated = withEvent({ ...base, wallet: { ...base.wallet, fuel: 0 } }, 'scrapyard', 0, 'mined_debris');
assert.equal(eventView(gated, now).choices.find(c => c.id === 'creep').reason, 'Needs 1 fuel');
// Odds on the card are the real weights and the real numbers.
gated = withEvent(base, 'scrapyard', 0, 'hot_reactor');
card = eventView(gated, now);
assert.deepEqual(card.choices.find(c => c.id === 'fast').odds.map(o => o.pct), [65, 35]);
assert.match(card.choices.find(c => c.id === 'fast').odds[1].summary, /−8 hull/);
let html = renderEventCard(card);
assert.match(html, /role="dialog"/);
assert.match(html, /data-act="event-choose" data-event-id="[^"]+" data-choice="safe"/);
assert.match(html, /65%/);
assert.match(html, /Engineer · /);
html = renderEventCard(eventView(noEngineer, now));
assert.match(html, /data-choice="safe" disabled/);
assert.match(html, /is away/);

// 9. Engineer path pays the full salvage, safely; it equals the instant value before events.
const engineered = act(gated, 'event-choose', { eventId: gated.activeEvent.eventId, choice: 'safe' });
assert.equal(engineered.ok, true);
assert.deepEqual(engineered.player.wallet.credits - gated.wallet.credits, eventReward(gated, gated.activeEvent, 1).credits);
assert.match(engineered.ui.eventResult.text, new RegExp(roleOf('engineer').name));

// 10. Hull damage stamps the dock-repair clock; injuries hit one fighting crew member.
{
  // Find a seed where "Go straight in" hits a live mine.
  let hurt = null;
  for (let seed = 1; seed < 200 && !hurt; seed++) {
    const p = withEvent(base, 'scrapyard', 0, 'mined_debris', seed);
    if (rollOutcome(p.activeEvent, TRAVEL_EVENT_BY_ID.mined_debris.choices.find(c => c.id === 'straight')).hull) hurt = p;
  }
  const res = act(hurt, 'event-choose', { eventId: hurt.activeEvent.eventId, choice: 'straight' });
  assert.equal(res.player.ship.hull, Math.max(1, hurt.ship.hull - 12));
  assert.equal(res.player.ship.hullRepairAt, now);
  assert.equal(res.ui.eventResult.hullLoss, hurt.ship.hull - res.player.ship.hull);
  let injured = null;
  for (let seed = 1; seed < 200 && !injured; seed++) {
    const p = withEvent(base, 'outpost_trade', 0, 'short_weight', seed);
    if (rollOutcome(p.activeEvent, TRAVEL_EVENT_BY_ID.short_weight.choices.find(c => c.id === 'lean')).injure) injured = p;
  }
  const hit = act(injured, 'event-choose', { eventId: injured.activeEvent.eventId, choice: 'lean' }).player;
  assert.equal(hit.crew.filter(c => c.status === 'injured').length, 1);
  assert.ok(hit.crew.find(c => c.status === 'injured').injuredUntil > now);
}

// 11. A fight outcome opens the existing v3 travel fight; arrival happens once, on the claim.
{
  const p = withEvent(base, 'scrapyard', 0, 'claim_jumpers');
  const res = act(p, 'event-choose', { eventId: p.activeEvent.eventId, choice: 'take' });
  assert.equal(res.ok, true, res.reason);
  let fightPlayer = res.player;
  assert.equal(fightPlayer.activeEvent, null);
  assert.equal(fightPlayer.activeTravelFight.encounterId, 'scrapper_gang', 'the beacon\'s own fight');
  assert.equal(fightPlayer.activeTravelFight.fuelSpent, 0, 'the jump was already paid');
  assert.equal(fightPlayer.activeEncounter.version, 3);
  assert.equal(fightPlayer.wallet.fuel, p.wallet.fuel);
  assert.equal(fightPlayer.location, 'station_home');
  assert.equal(fightPlayer.stats.jumps, p.stats.jumps);
  assert.equal(validTravelFight(reload(fightPlayer)), true);
  assert.equal(res.ui.tab, 'ship');
  for (let i = 0; i < 300 && fightPlayer.activeTravelFight.stage === 'fight'; i++) {
    const enc = fightPlayer.activeEncounter;
    const order = enc.phase === 'downed' ? 'concede' : null;
    fightPlayer = act(fightPlayer, order ? 'encounter-order' : 'encounter-advance', { acceptanceId: enc.acceptanceId, revision: enc.revision, order }).player;
  }
  const claimed = act(fightPlayer, 'travel-claim', { acceptanceId: fightPlayer.activeTravelFight.fightId, revision: fightPlayer.activeTravelFight.revision });
  assert.equal(claimed.ok, true, claimed.reason);
  assert.equal(claimed.player.location, 'scrapyard');
  assert.equal(claimed.player.stats.jumps, p.stats.jumps + 1);
  assert.equal(claimed.player.stats.visits.scrapyard, (p.stats.visits.scrapyard || 0) + 1);
}

// 12. Hire: the merc joins for the signing fee when a berth is free; never twice.
{
  const p = withEvent(base, 'outpost_trade', 1, 'stowaway');
  const res = act(p, 'event-choose', { eventId: p.activeEvent.eventId, choice: 'sign' });
  assert.equal(res.ok, true, res.reason);
  assert.ok(res.player.crew.some(c => c.templateId === 'merc_juno'));
  assert.equal(res.player.wallet.credits, p.wallet.credits - 120 + eventReward(p, p.activeEvent, 1).credits);
  assert.equal(res.ui.eventResult.hired, 'Juno Kett');
  const again = withEvent(res.player, 'outpost_trade', 1, 'stowaway');
  assert.match(eventView(again, now).choices.find(c => c.id === 'sign').reason, /already crews for you/);
  const full = withEvent({ ...base, crewSlots: base.crew.length }, 'outpost_trade', 1, 'stowaway');
  assert.equal(eventView(full, now).choices.find(c => c.id === 'sign').reason, 'No free berth');
}

// 13. Story: the beat lands with its usual rewards; an already logged beat stays instant scrap.
{
  const p = withEvent(base, 'lane_a', 3, 'dead_band');
  const res = act(p, 'event-choose', { eventId: p.activeEvent.eventId, choice: 'follow' });
  assert.equal(res.player.flags.rumor_swarm, true);
  assert.equal(res.player.wallet.credits - p.wallet.credits, STORY_BEATS.rumor_swarm.rewards.credits);
  assert.equal(res.ui.eventResult.beat.title, STORY_BEATS.rumor_swarm.title);
  const seen = { ...base, flags: { ...base.flags, rumor_swarm: true } };
  const instant = act(seen, 'travel-to', { node: 'lane_a' }, { rng: () => 0.95 });
  assert.equal(instant.ok, true);
  assert.equal(instant.player.activeEvent ?? null, null, 'logged beats do not open an event');
  assert.equal(instant.player.location, 'lane_a');
  const sold = act(p, 'event-choose', { eventId: p.activeEvent.eventId, choice: 'sell' }).player;
  assert.equal(sold.flags.rumor_swarm, undefined, 'selling the lead leaves the story for later');
}

// 14. Result card.
const resultHtml = renderEventResult({ title: 'T', choiceLabel: 'C', text: 'x', nodeName: 'N', rewardLabel: '90cr', hullLoss: 8, injured: 'Bolt', hired: null, beat: null });
assert.match(resultHtml, /\+ 90cr · −8 hull · Bolt injured/);
assert.match(resultHtml, /data-act="event-dismiss"/);
assert.doesNotMatch(renderEventResult({ title: '<b>', choiceLabel: '', text: '<img src=x>', nodeName: '' }), /<img src=x>|<b>/, 'escaped');

// 15. The simulator's scripted policies never find a result above the instant value.
const audit = auditExploreEvents();
assert.deepEqual(audit.breaches, []);
assert.ok(audit.templates >= 24);
for (const policy of ['cautious', 'balanced', 'ambitious']) {
  assert.ok(audit.byPolicy[policy].creditRatio <= 1 && audit.byPolicy[policy].creditRatio >= 0.6, `${policy} credit ratio`);
}

console.log('travel_events.test.mjs OK');
