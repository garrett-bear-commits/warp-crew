// @ts-nocheck
/** Sector map rules: which beacons you can jump to, and what the map tells you about them. */
import { NODES, visibleNodes, nodeMeta, GATE_WALLS, gateBlockedByWall } from '../data/sectors.js';
import { SECTOR_MAPS, SECTOR_ORDER, LANES, laneNeighbors, hasLane, MAP_WIDTH, MAP_HEIGHT } from '../data/sectorMaps.js';
import { galaxyUnlocked } from '../data/galaxies.js';
import { encounterById } from './combat.js';
import { contractThreat, threatLabel } from './encounterState.js';
import { fuelCostFor } from './passives.js';
import { readyCrew } from './player.js';

const HOME = 'station_home';
/** Same threshold travel.js uses to refuse a jump anywhere but home. */
const HULL_CRITICAL = 8;

const FAMILY = {
  pirate_scout: 'Pirates reported', pirate_wing: 'Pirates reported', pirate_ace: 'Pirates reported',
  corsair_king: 'Pirates reported', ice_raiders: 'Raiders reported', ember_raider: 'Raiders reported',
  scrapper_gang: 'Scrappers working', swarm_probe: 'Swarm activity', swarm_skirmish: 'Swarm activity',
  swarm_frigate: 'Swarm activity', swarm_brood: 'Swarm activity', eclipse_echo: 'Swarm activity', eclipse_throne: 'Swarm activity',
  veil_wraith: 'Ghost signals', hollow_shade: 'Ghost signals', crown_warden: 'Wardens patrol',
};

const KIND_LABEL = { trade: 'Trade', delivery: 'Delivery', salvage: 'Salvage', story: 'Story', combat: 'Fight' };

/** The map that shows a beacon: its own sector's. */
export function sectorOf(nodeId) {
  return NODES[nodeId]?.sector || 'spur';
}

function visibleSet(player, now) {
  return new Set(visibleNodes(player, now).map(node => node.id));
}

/** Whether a jump from the current location to `nodeId` follows the lanes. */
export function laneCheck(player, nodeId, now = Date.now()) {
  const here = player?.location || HOME;
  if (!NODES[nodeId]) return { ok: false, reason: 'unknown_node' };
  if (nodeId === here) return { ok: false, reason: 'already_here' };
  // An unbroken Siege wall always holds its gate shut (even with an old sector flag).
  if (gateBlockedByWall(player, nodeId)) return { ok: false, reason: 'siege_wall' };
  const visible = visibleSet(player, now);
  if (!visible.has(nodeId)) return { ok: false, reason: 'locked_node' };
  if (hasLane(here, nodeId)) return { ok: true, via: 'lane' };
  if (nodeId === HOME) {
    // A crippled or stranded ship can always limp home.
    if ((player.ship?.hull ?? 100) <= HULL_CRITICAL) return { ok: true, via: 'limp_home' };
    const onward = laneNeighbors(here).filter(id => visible.has(id));
    if (!onward.length || !NODES[here]) return { ok: true, via: 'stranded' };
  }
  return { ok: false, reason: 'no_lane' };
}

/** Honest risk read: who fights here, how hard against the crew aboard now, and how often. */
export function riskRead(player, node, now = Date.now()) {
  const outcomes = node?.outcomes || [];
  const total = outcomes.reduce((sum, outcome) => sum + outcome.w, 0) || 1;
  const fights = outcomes.filter(outcome => outcome.kind === 'combat');
  if (!fights.length) return { label: outcomes.length ? 'No fights reported' : 'Safe harbor', fightPct: 0, threat: null, family: null };
  const fightPct = Math.round((fights.reduce((sum, outcome) => sum + outcome.w, 0) / total) * 100);
  const strongest = [...fights].sort((a, b) => encounterById(b.encounter).power - encounterById(a.encounter).power)[0];
  const crewAboard = readyCrew(player, now).filter(member => member.status !== 'expedition').length;
  const threat = crewAboard ? threatLabel(contractThreat(player, { encounterId: strongest.encounter }, now)) : 'Deadly';
  // Who you will most likely meet, and how hard the worst of them hits.
  const likeliest = [...fights].sort((a, b) => b.w - a.w)[0];
  const family = FAMILY[likeliest.encounter] || 'Hostiles reported';
  return { label: `${family} · ${threat} · ${fightPct}% fight`, family, threat, fightPct,
    enemy: encounterById(strongest.encounter).name };
}

/** What an arrival can turn into, by kind, with the share of arrivals. */
export function arrivalMix(node) {
  const outcomes = node?.outcomes || [];
  const total = outcomes.reduce((sum, outcome) => sum + outcome.w, 0) || 1;
  const byKind = {};
  for (const outcome of outcomes) byKind[outcome.kind] = (byKind[outcome.kind] || 0) + outcome.w;
  return Object.entries(byKind).map(([kind, w]) => ({ kind, label: KIND_LABEL[kind] || kind, pct: Math.round((w / total) * 100) }));
}

/** Sectors the captain can open on the map (their own plus unlocked ones). */
export function mapSectors(player, now = Date.now()) {
  const visible = visibleSet(player, now);
  const here = sectorOf(player?.location || HOME);
  return SECTOR_ORDER.filter(id => id === here || id === 'spur'
    || (galaxyUnlocked(player, id) || Object.keys(SECTOR_MAPS[id].beacons).some(nodeId => sectorOf(nodeId) === id && visible.has(nodeId))));
}

/** Full map model for one sector. */
export function sectorMapModel(player, ui = {}, now = Date.now()) {
  const here = player?.location || HOME;
  const sectors = mapSectors(player, now);
  const sectorId = sectors.includes(ui.mapSector) ? ui.mapSector : sectorOf(here);
  const map = SECTOR_MAPS[sectorId] || SECTOR_MAPS.spur;
  const visible = visibleSet(player, now);
  const busy = player.activeContract ? 'contract' : player.activeTravelFight ? 'fight' : player.activeEvent ? 'event' : null;
  const beacons = [];
  for (const [nodeId, pos] of Object.entries(map.beacons)) {
    const node = NODES[nodeId];
    if (!node) continue;
    const wallLocked = Boolean(GATE_WALLS[nodeId]) && gateBlockedByWall(player, nodeId);
    if (!visible.has(nodeId) && !wallLocked) continue;
    const lane = wallLocked ? { ok: false, reason: 'siege_wall' } : laneCheck(player, nodeId, now);
    beacons.push({
      id: nodeId, name: node.name, type: node.type, blurb: node.blurb, x: pos.x, y: pos.y,
      border: node.sector !== sectorId, sector: node.sector,
      gate: Boolean(GATE_WALLS[nodeId]), wallLocked, wall: GATE_WALLS[nodeId] || null,
      here: nodeId === here, visits: player.stats?.visits?.[nodeId] || 0,
      fuel: fuelCostFor(player, node.fuelCost ?? 1),
      reachable: lane.ok && !busy, laneOk: lane.ok, via: lane.via || null, reason: lane.ok ? null : lane.reason,
      hazard: nodeMeta(node).hazard,
    });
  }
  const shown = new Set(beacons.map(beacon => beacon.id));
  const lanes = LANES.filter(([a, b]) => shown.has(a) && shown.has(b)
    && !beacons.find(beacon => beacon.id === a).wallLocked && !beacons.find(beacon => beacon.id === b).wallLocked)
    .map(([a, b]) => {
      const from = map.beacons[a];
      const to = map.beacons[b];
      return { a, b, x1: from.x, y1: from.y, x2: to.x, y2: to.y, live: (a === here || b === here) };
    });
  const selected = beacons.find(beacon => beacon.id === ui.selectedMapNode) || null;
  let card = null;
  if (selected) {
    const node = NODES[selected.id];
    card = { ...selected, risk: riskRead(player, node, now), mix: arrivalMix(node),
      fuelLeft: (player.wallet?.fuel ?? 0) - selected.fuel,
      canAfford: (player.wallet?.fuel ?? 0) >= selected.fuel };
  }
  return { sectorId, sectorName: map.name, sectors: sectors.map(id => ({ id, name: SECTOR_MAPS[id].name, current: id === sectorId })),
    width: MAP_WIDTH, height: MAP_HEIGHT, here, hereName: NODES[here]?.name || here, beacons, lanes, card, busy,
    fuel: player.wallet?.fuel ?? 0 };
}
