// New captains are pointed at the sector map once after the script-5 first session; veterans never are.
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { sessionAction, prepareSession } from '../src/systems/sessionLoop.js';
import { FTL_VERSION, MAX_FIGHT_BEATS } from '../src/systems/ftlCombat.js';
import { createSeededRng } from '../src/sim/contractEconomy.js';
import { exploreNudges, mapJumps, markExploreNudge, EXPLORE_NUDGE_FLAGS } from '../src/systems/exploreNudge.js';
import { laneCheck } from '../src/systems/sectorMap.js';
import { NODES } from '../src/data/sectors.js';
import { renderExploreCoach, renderExploreIntro, renderMissions } from '../src/ui/bridge.js';
import { renderEventCard } from '../src/ui/eventView.js';
import { renderMissionSwitcher } from '../src/ui/contractView.js';

const now = Date.UTC(2026, 9, 5, 12);
const rng = createSeededRng(11);
let player = createNewPlayer({ tutorialScript: 5, now, rng });
let ui = {};
const act = (a, d = {}) => {
  const r = sessionAction(player, ui, a, d, { now, rng });
  assert.ok(r?.ok, `${a}: ${r?.reason}`);
  player = r.player; ui = { ...ui, ...(r.ui || {}) };
  return r;
};
// The first session, through production transitions.
act('splash-dismiss');
act('captain-choose', { templateId: 'captain_gunner', name: 'Captain' });
assert.deepEqual(exploreNudges(player), { coach: false, mapIntro: false, eventHint: false }, 'nothing during the tutorial');
act('tutorial-first-hire');
const hired = player.crew.find(m => m.instanceId === player.tutorial.firstHireInstanceId);
act('station-assign', { id: hired.instanceId, station: hired.templateId === 'merc_bolt' ? 'shields' : 'weapons' });
act('tutorial-fight-start');
const ident = () => ({ acceptanceId: player.activeEncounter.acceptanceId, revision: player.activeEncounter.revision });
if (player.activeEncounter?.version === FTL_VERSION) act('encounter-command', { ...ident(), command: { type: 'target', room: 'weapons' } });
for (let b = 0; b < MAX_FIGHT_BEATS && player.tutorial.phase === 'fight'; b++) act('encounter-advance', ident());
act('contract-claim', { action: 'claim', revision: player.activeContract.revision, acceptanceId: player.activeContract.acceptanceId });
act('tutorial-name', { name: 'Sparrow' });
act('tutorial-welcome-pull');
act('tutorial-register-skip');
player = prepareSession(player, now);

// Fresh from the tutorial: Explore is not open yet (it opens after three contracts), so no pointer yet.
assert.equal(mapJumps(player), 0);
assert.deepEqual(exploreNudges(player), { coach: false, mapIntro: false, eventHint: true });
// Three contracts in (each claim also counts a jump): Explore opens and the pointers appear.
player = { ...player, stats: { ...player.stats, jumps: 3, contractsCompleted: 3 } };
assert.equal(mapJumps(player), 0, 'contract jumps are not map jumps');
assert.deepEqual(exploreNudges(player), { coach: true, mapIntro: true, eventHint: true });
const veteran = { ...player, stats: { ...player.stats, jumps: player.stats.jumps + 3 } };
assert.deepEqual(exploreNudges(veteran), { coach: false, mapIntro: false, eventHint: false }, 'veterans who used the map see nothing');
assert.deepEqual(exploreNudges({ ...player, tutorial: { ...player.tutorial, script: 4 } }), { coach: false, mapIntro: false, eventHint: false }, 'script 5 only');

// Coach mark: renders a non-modal pointer; opening Explore retires it (saved flag).
assert.match(renderExploreCoach(), /data-act="mission-view" data-view="explore"/);
assert.doesNotMatch(renderExploreCoach(), /modal|aria-modal/);
assert.match(renderMissionSwitcher('contracts', ['contracts', 'away', 'explore'], { fresh: ['explore'] }), /data-view="explore" aria-pressed="false" class="is-new">Explore<i class="nav-badge"/);
assert.match(renderMissions(player, now, { missionView: 'contracts', exploreNudges: exploreNudges(player) }), /class="is-new"/);
act('mission-view', { view: 'explore' });
assert.equal(player.flags[EXPLORE_NUDGE_FLAGS.coach], true);
assert.deepEqual(exploreNudges(player), { coach: false, mapIntro: true, eventHint: true });

// First visit card on the map, with the promised copy; dismissing it is saved.
const explore = renderMissions(player, now, { missionView: 'explore', exploreNudges: exploreNudges(player) });
assert.match(explore, /Jump along lanes; each beacon shows what you might find; events let your crew&#039;s skills change the outcome\.|Jump along lanes; each beacon shows what you might find; events let your crew's skills change the outcome\./);
assert.ok(explore.indexOf('explore-intro') < explore.indexOf('sector-map-view'), 'card sits above the map');
assert.match(renderExploreIntro(), /data-act="explore-nudge-dismiss" data-nudge="mapIntro"/);
const dismissed = sessionAction(player, ui, 'explore-nudge-dismiss', { nudge: 'mapIntro' }, { now, rng });
assert.equal(dismissed.player.flags[EXPLORE_NUDGE_FLAGS.mapIntro], true);
assert.equal(sessionAction(player, ui, 'explore-nudge-dismiss', { nudge: 'bogus' }, { now, rng }).ok, false);
assert.equal(markExploreNudge(dismissed.player, 'mapIntro'), dismissed.player, 'idempotent');

// First jump: the map is found (coach and card retire), and the first event card gets its one-line hint.
player = { ...player, wallet: { ...player.wallet, fuel: 10 } };
const dest = Object.values(NODES).find(n => n.id !== 'station_home' && laneCheck(player, n.id, now).ok && n.outcomes?.some(o => o.kind !== 'combat')).id;
const start = player;
for (let i = 0; i < 60 && !player.activeEvent; i++) {
  player = { ...start, wallet: { ...start.wallet, fuel: 10 } };
  act('travel-to', { node: dest });
}
assert.ok(player.activeEvent, 'an event opened');
assert.equal(player.flags.mapUsed, true);
assert.deepEqual(exploreNudges(player), { coach: false, mapIntro: false, eventHint: true });
const view = { kind: 'trade', nodeName: 'X', sectorName: 'Spur', title: 'T', text: 'Body', eventId: 'e', choices: [] };
assert.match(renderEventCard(view, { hint: true }), /class="event-hint"/);
assert.doesNotMatch(renderEventCard(view), /event-hint/);
const ev = player.activeEvent;
const { TRAVEL_EVENT_BY_ID } = await import('../src/data/events.js');
const { choiceStatus } = await import('../src/systems/travelEvents.js');
const choice = TRAVEL_EVENT_BY_ID[ev.templateId].choices.find(c => choiceStatus(player, c, now).available);
act('event-choose', { eventId: ev.eventId, choice: choice.id });
assert.equal(player.flags[EXPLORE_NUDGE_FLAGS.eventHint], true);
assert.deepEqual(exploreNudges(player), { coach: false, mapIntro: false, eventHint: false }, 'shown once');
console.log('explore_nudge.test.mjs OK');
