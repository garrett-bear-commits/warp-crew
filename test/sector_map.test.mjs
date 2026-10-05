import assert from 'node:assert/strict';
import { completeFreshTutorial } from './helpers/tutorialFlow.mjs';
import { createNewPlayer } from '../src/systems/player.js';
import { NODES, visibleNodes } from '../src/data/sectors.js';
import { SECTOR_MAPS, LANES, laneNeighbors, MAP_WIDTH, MAP_HEIGHT } from '../src/data/sectorMaps.js';
import { laneCheck, riskRead, sectorMapModel, sectorOf } from '../src/systems/sectorMap.js';
import { sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { renderSectorMap } from '../src/ui/sectorMapView.js';
import { renderMissions } from '../src/ui/bridge.js';

const DAY = 86400000;
const now = Date.UTC(2030, 8, 22, 12);

// 1. Map data: every beacon placed on its own sector's map, inside the box; lanes valid and unique.
for (const node of Object.values(NODES)) {
  assert.ok(SECTOR_MAPS[node.sector]?.beacons[node.id], `${node.id} is placed on the ${node.sector} map`);
}
for (const map of Object.values(SECTOR_MAPS)) {
  for (const [id, pos] of Object.entries(map.beacons)) {
    assert.ok(NODES[id], `${map.id}: ${id} is a real beacon`);
    assert.ok(pos.x >= 0 && pos.x <= MAP_WIDTH && pos.y >= 0 && pos.y <= MAP_HEIGHT, `${map.id}: ${id} inside the map`);
    if (NODES[id].sector !== map.id) {
      // Border beacons are only there because a lane reaches them from this sector.
      assert.ok(laneNeighbors(id).some(other => NODES[other].sector === map.id), `${map.id}: border ${id} has a lane into the sector`);
    }
  }
  // No two beacons on top of each other.
  const spots = Object.values(map.beacons);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= 14, `${map.id}: beacons ${i} and ${j} are spaced`);
  }
}
const laneKeys = new Set();
for (const [a, b] of LANES) {
  assert.ok(NODES[a] && NODES[b] && a !== b, `lane ${a}-${b}`);
  const key = [a, b].sort().join('|');
  assert.ok(!laneKeys.has(key), `duplicate lane ${key}`);
  laneKeys.add(key);
  // A lane between sectors must be drawable on both maps.
  for (const sector of new Set([NODES[a].sector, NODES[b].sector])) {
    assert.ok(SECTOR_MAPS[sector].beacons[a] && SECTOR_MAPS[sector].beacons[b], `lane ${a}-${b} drawn on the ${sector} map`);
  }
}

// 2. Every career day: everything visible is reachable from Spur Anchor along visible lanes.
function reachableFromHome(player, at) {
  const visible = new Set(visibleNodes(player, at).map(n => n.id));
  const seen = new Set(['station_home']);
  const queue = ['station_home'];
  while (queue.length) {
    const id = queue.shift();
    for (const next of laneNeighbors(id)) if (visible.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return { visible, seen };
}
const fresh = { ...createNewPlayer({ tutorialScript: 4, now }), tutorial: { script: 4, completed: true, phase: 'done' } };
const unlockSteps = [
  {},
  { rumor_swarm: true },
  { veil_opened: true },
  { veil_opened: true, forge_gift: true },
  { veil_opened: true, ember_opened: true },
  { veil_opened: true, ember_opened: true, hollow_opened: true },
  { veil_opened: true, ember_opened: true, hollow_opened: true, crown_opened: true },
];
for (const flags of unlockSteps) {
  for (let day = 0; day < 8; day++) {
    const player = { ...fresh, flags: { ...fresh.flags, ...flags }, story: { ...fresh.story, chapter: Object.keys(flags).length + 1 } };
    const { visible, seen } = reachableFromHome(player, now + day * DAY);
    for (const id of visible) assert.ok(seen.has(id), `day ${day + 1} ${JSON.stringify(flags)}: ${id} reachable from Spur Anchor`);
  }
}

// 3. Jump rule.
const veteran = { ...completeFreshTutorial(), location: 'station_home', activeContract: null, activeEncounter: null, activeExpedition: null };
const vet = { ...veteran, crew: veteran.crew.map(c => ({ ...c, status: 'ready', injuredUntil: 0 })), wallet: { ...veteran.wallet, fuel: 10 },
  createdAt: now - 7 * DAY };
assert.deepEqual(laneCheck(vet, 'lane_a', now), { ok: true, via: 'lane' });
assert.equal(laneCheck(vet, 'ice_spur', now).reason, 'no_lane');
assert.equal(laneCheck(vet, 'station_home', now).reason, 'already_here');
assert.equal(laneCheck(vet, 'swarm_scar', now).reason, 'locked_node', 'Veil interior hidden before the gate');
const far = { ...vet, location: 'ice_spur' };
assert.equal(laneCheck(far, 'station_home', now).reason, 'no_lane', 'home is a normal beacon when the ship is fine');
assert.equal(laneCheck({ ...far, ship: { ...far.ship, hull: 8 } }, 'station_home', now).via, 'limp_home', 'a crippled ship can always limp home');
assert.equal(laneCheck({ ...vet, location: 'nowhere_node' }, 'station_home', now).via, 'stranded', 'a ship off the charts can go home');
// Sessions refuse a jump off the lanes before spending anything.
const offLane = sessionAction(vet, {}, 'travel-to', { node: 'ice_spur' }, { now, rng: () => 0.1 });
assert.equal(offLane.ok, false);
assert.equal(offLane.reason, 'no_lane');
assert.equal(offLane.player.wallet.fuel, vet.wallet.fuel);

// 4. Honest risk read: fight family, threat label against the crew aboard, fight share.
const belt = riskRead(vet, NODES.danger_belt, now);
assert.equal(belt.family, 'Pirates reported');
assert.equal(belt.fightPct, 80);
assert.ok(['Favorable', 'Even', 'Dangerous', 'Deadly'].includes(belt.threat));
assert.match(belt.label, /^Pirates reported · (Favorable|Even|Dangerous|Deadly) · 80% fight$/);
assert.equal(riskRead(vet, NODES.frost_harbor, now).label, 'No fights reported');
assert.equal(riskRead(vet, NODES.station_home, now).label, 'Safe harbor');
assert.equal(riskRead(vet, NODES.night_well, now).family, 'Swarm activity');

// 5. Map model and render.
const model = sectorMapModel(vet, { selectedMapNode: 'lane_a' }, now);
assert.equal(model.sectorId, 'spur');
assert.equal(model.beacons.find(b => b.id === 'station_home').here, true);
assert.equal(model.beacons.find(b => b.id === 'lane_a').reachable, true);
assert.equal(model.beacons.find(b => b.id === 'ice_spur').reachable, false);
assert.ok(model.lanes.some(l => l.live && [l.a, l.b].includes('lane_a')), 'lanes from here are lit');
assert.equal(model.card.id, 'lane_a');
let html = renderSectorMap(model);
assert.match(html, /data-act="map-select" data-node="lane_a"/);
assert.match(html, /<line /);
assert.match(html, /data-act="travel-to" data-node="lane_a"(?![^>]*disabled)/);
assert.match(html, /Pirates reported · \w+ · 30% fight/);
html = renderSectorMap(sectorMapModel(vet, { selectedMapNode: 'danger_belt' }, now));
assert.match(html, /data-act="travel-to" data-node="danger_belt"[^>]*disabled/, 'Broken Belt is a lane from Dust Lane, not from home');
html = renderSectorMap(sectorMapModel(vet, { selectedMapNode: 'ice_spur' }, now));
assert.match(html, /data-act="travel-to" data-node="ice_spur"[^>]*disabled/);
assert.match(html, /No lane from here/);
// Locked Siege gate: guided-flow captain on day 3, Spur wall not broken.
const guided = { ...vet, tutorial: { script: 5, completed: true, phase: 'done' }, location: 'ice_spur', flags: { ...vet.flags, rumor_swarm: true } };
const walled = sectorMapModel(guided, { selectedMapNode: 'veil_gate' }, now).beacons.find(b => b.id === 'veil_gate');
assert.equal(walled.wallLocked, true);
assert.equal(walled.reachable, false);
assert.equal(sessionAction(guided, {}, 'travel-to', { node: 'veil_gate' }, { now }).reason, 'siege_wall');
const open = sectorMapModel({ ...guided, flags: { ...guided.flags, wall_spur: true } }, {}, now).beacons.find(b => b.id === 'veil_gate');
assert.equal(open.wallLocked, false);
assert.equal(open.reachable, true);
// Sector chips and viewing another sector.
const veilCaptain = { ...vet, flags: { ...vet.flags, veil_opened: true }, story: { ...vet.story, veilUnlocked: true } };
const veilModel = sectorMapModel(veilCaptain, { mapSector: 'veil' }, now);
assert.deepEqual(veilModel.sectors.map(s => s.id), ['spur', 'veil']);
assert.equal(veilModel.sectorId, 'veil');
assert.ok(veilModel.beacons.find(b => b.id === 'ice_spur').border, 'the way back is drawn on the Veil map');
assert.equal(sectorOf('veil_gate'), 'veil');
// Busy states lock jumps on the map.
assert.equal(sectorMapModel({ ...vet, activeContract: { stage: 'briefing' } }, {}, now).busy, 'contract');
const missions = renderMissions({ ...vet, activeContract: { title: 'x' } }, now, { missionView: 'explore' });
assert.match(missions, /Finish or abandon the active contract first/);

// 6. Map taps are UI state only.
const tapped = sessionAction(vet, {}, 'map-select', { node: 'lane_a' }, { now });
assert.equal(tapped.ok, true);
assert.equal(tapped.ui.selectedMapNode, 'lane_a');
assert.deepEqual(tapped.player, vet);
assert.equal(sessionAction(vet, {}, 'map-select', { node: '<bad>' }, { now }).ui.selectedMapNode, null);
assert.equal(sessionAction(vet, {}, 'map-sector', { sector: 'veil' }, { now }).ui.mapSector, 'veil');
assert.equal(sessionModels(vet, { missionView: 'explore', selectedMapNode: 'lane_a' }, now).sectorMap.card.id, 'lane_a');

// An unbroken Siege wall always holds its gate, even for a save that carries an old sector flag.
{
  const { laneCheck } = await import('../src/systems/sectorMap.js');
  const walled = { tutorial: { script: 5, completed: true, phase: 'done' }, flags: { veil_opened: true }, story: {}, stats: {}, location: 'ice_spur', ship: { hull: 100 } };
  assert.equal(laneCheck(walled, 'veil_gate').ok, false);
  assert.equal(laneCheck(walled, 'veil_gate').reason, 'siege_wall');
  const { validTravelEvent } = await import('../src/systems/travelEvents.js');
  const { acceptContract } = await import('../src/systems/contracts.js');
  const atGate = { ...walled, activeEvent: { version: 1, eventId: 'event:veil_gate:1:7', nodeId: 'veil_gate', templateId: 'x', base: { kind: 'story' }, seed: 7, fuelSpent: 2, fromNodeId: 'ice_spur' } };
  assert.equal(validTravelEvent(atGate), false, 'no saved event at a walled gate');
  const board = { dayKey: 'd', completedOfferIds: [], offers: [{ id: 'o1', destinationId: 'veil_gate', profile: 'reliable' }] };
  assert.equal(acceptContract({ ...walled, contractBoard: board }, 'o1').reason, 'siege_wall', 'no contract to a walled gate');
  const { previewTravel } = await import('../src/systems/travel.js');
  assert.equal(previewTravel(walled, 'veil_gate').reason, 'siege_wall', 'the shared travel preview refuses a walled gate');
  // Even a forged preview cannot commit a jump or open an event there.
  const { commitTravel } = await import('../src/systems/travel.js');
  const { openTravelEvent } = await import('../src/systems/travelEvents.js');
  const { NODES } = await import('../src/data/sectors.js');
  const forged = { ok: true, node: NODES.veil_gate, fuelCost: 2, outcome: { kind: 'story', flag: 'veil_opened' } };
  assert.equal(commitTravel(walled, forged).reason, 'siege_wall');
  assert.equal(openTravelEvent(walled, forged).ok, false);
}
console.log('sector_map.test.mjs OK');
