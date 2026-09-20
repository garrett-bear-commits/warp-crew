// @ts-nocheck
/** Multi-node map — Spur + Veil Edge (week-of-content backbone) */

import { encounterById } from '../systems/combat.js';
import { GALAXY_NODES, GALAXY_BEATS, galaxyUnlocked } from './galaxies.js';

const BASE_NODES = {
  station_home: {
    id: 'station_home',
    name: 'Spur Anchor',
    type: 'station',
    blurb: 'Your safe harbor and merc board.',
    fuelCost: 0,
    sector: 'spur',
  },
  lane_a: {
    id: 'lane_a',
    name: 'Dust Lane',
    type: 'travel',
    blurb: 'Light traffic. Good for learning the ropes.',
    fuelCost: 1,
    sector: 'spur',
    outcomes: [
      { w: 40, kind: 'trade', credits: 60, reputation: 2 },
      { w: 30, kind: 'combat', encounter: 'pirate_scout' },
      { w: 20, kind: 'salvage', credits: 40, medals: 3 },
      { w: 10, kind: 'story', flag: 'rumor_swarm' },
    ],
  },
  outpost_trade: {
    id: 'outpost_trade',
    name: 'Kestrel Market',
    type: 'trade',
    blurb: 'Honest merchants and a few thieves.',
    fuelCost: 1,
    sector: 'spur',
    outcomes: [
      { w: 70, kind: 'trade', credits: 100, reputation: 4 },
      { w: 20, kind: 'delivery', credits: 150, reputation: 6 },
      { w: 10, kind: 'combat', encounter: 'pirate_wing' },
    ],
  },
  danger_belt: {
    id: 'danger_belt',
    name: 'Broken Belt',
    type: 'danger',
    blurb: 'Pirates and worse.',
    fuelCost: 1,
    sector: 'spur',
    outcomes: [
      { w: 50, kind: 'combat', encounter: 'pirate_wing' },
      { w: 30, kind: 'combat', encounter: 'swarm_probe' },
      { w: 20, kind: 'salvage', credits: 90, medals: 8 },
    ],
  },
  colony_hope: {
    id: 'colony_hope',
    name: "Hope's Rest",
    type: 'story',
    blurb: 'A colony under Eclipse Swarm pressure.',
    fuelCost: 2,
    sector: 'spur',
    outcomes: [
      { w: 55, kind: 'story', flag: 'colony_help' },
      { w: 45, kind: 'combat', encounter: 'swarm_skirmish' },
    ],
  },
  ice_spur: {
    id: 'ice_spur',
    name: 'Glass Spur',
    type: 'travel',
    blurb: 'Frozen shipping lane. Convoys pay well.',
    fuelCost: 1,
    sector: 'spur',
    outcomes: [
      { w: 45, kind: 'delivery', credits: 130, reputation: 5 },
      { w: 25, kind: 'trade', credits: 90, reputation: 3 },
      { w: 20, kind: 'combat', encounter: 'pirate_scout' },
      { w: 10, kind: 'story', flag: 'ice_convoy' },
    ],
  },
  scrapyard: {
    id: 'scrapyard',
    name: 'Null Scrapyard',
    type: 'salvage',
    blurb: 'Derelicts stacked like tombstones.',
    fuelCost: 1,
    sector: 'spur',
    outcomes: [
      { w: 50, kind: 'salvage', credits: 70, medals: 6 },
      { w: 30, kind: 'salvage', credits: 120, medals: 12 },
      { w: 20, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  // Week expansion — Spur
  amber_port: {
    id: 'amber_port',
    name: 'Amber Port',
    type: 'trade',
    blurb: 'Resin-lit docks. Quiet money if you keep your nose clean.',
    fuelCost: 1,
    sector: 'spur',
    minDay: 2,
    outcomes: [
      { w: 60, kind: 'trade', credits: 110, reputation: 4 },
      { w: 25, kind: 'delivery', credits: 160, reputation: 6 },
      { w: 15, kind: 'combat', encounter: 'pirate_scout' },
    ],
  },
  signal_array: {
    id: 'signal_array',
    name: 'Signal Array',
    type: 'story',
    blurb: 'Abandoned listening post humming Swarm frequencies.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 2,
    outcomes: [
      { w: 55, kind: 'story', flag: 'signal_contact' },
      { w: 30, kind: 'salvage', credits: 100, medals: 10 },
      { w: 15, kind: 'combat', encounter: 'swarm_probe' },
    ],
  },
  relic_field: {
    id: 'relic_field',
    name: 'Relic Field',
    type: 'salvage',
    blurb: 'Pre-collapse ruins. Medals for the bold.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 3,
    outcomes: [
      { w: 45, kind: 'salvage', credits: 100, medals: 14 },
      { w: 30, kind: 'salvage', credits: 160, medals: 20 },
      { w: 25, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  pirate_nest: {
    id: 'pirate_nest',
    name: 'Corsair Nest',
    type: 'danger',
    blurb: 'Asteroid dens. High risk, high scrap.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 3,
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'pirate_wing' },
      { w: 30, kind: 'combat', encounter: 'corsair_king' },
      { w: 20, kind: 'salvage', credits: 140, medals: 12 },
      { w: 10, kind: 'story', flag: 'pirate_king' },
    ],
  },
  convoy_route: {
    id: 'convoy_route',
    name: 'Convoy Spine',
    type: 'travel',
    blurb: 'Scheduled freighters. Escort contracts available.',
    fuelCost: 1,
    sector: 'spur',
    minDay: 4,
    outcomes: [
      { w: 50, kind: 'delivery', credits: 170, reputation: 7 },
      { w: 25, kind: 'trade', credits: 100, reputation: 3 },
      { w: 25, kind: 'combat', encounter: 'pirate_wing' },
    ],
  },
  aurora_station: {
    id: 'aurora_station',
    name: 'Aurora Station',
    type: 'trade',
    blurb: 'Tourist ring with a black-market underbelly.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 4,
    outcomes: [
      { w: 55, kind: 'trade', credits: 150, reputation: 5 },
      { w: 25, kind: 'delivery', credits: 200, reputation: 8 },
      { w: 20, kind: 'combat', encounter: 'pirate_scout' },
    ],
  },
  black_canal: {
    id: 'black_canal',
    name: 'Black Canal',
    type: 'story',
    blurb: 'Shadow brokers who know Swarm routes… for a price.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 5,
    outcomes: [
      { w: 50, kind: 'story', flag: 'black_canal_pact' },
      { w: 30, kind: 'trade', credits: 180, reputation: 6 },
      { w: 20, kind: 'combat', encounter: 'swarm_skirmish' },
    ],
  },
  forge_moon: {
    id: 'forge_moon',
    name: 'Forge Moon',
    type: 'salvage',
    blurb: 'Industrial crater. Parts for bigger hulls.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 5,
    outcomes: [
      { w: 40, kind: 'salvage', credits: 120, medals: 16 },
      { w: 30, kind: 'story', flag: 'forge_gift' },
      { w: 30, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  // Veil Edge
  veil_gate: {
    id: 'veil_gate',
    name: 'Veil Gate',
    type: 'story',
    blurb: 'Border station into Veil Edge space.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 50, kind: 'story', flag: 'veil_opened' },
      { w: 30, kind: 'trade', credits: 140, reputation: 5 },
      { w: 20, kind: 'combat', encounter: 'swarm_probe' },
    ],
  },
  swarm_scar: {
    id: 'swarm_scar',
    name: 'Swarm Scar',
    type: 'danger',
    blurb: 'Where Eclipse first bit the Spur.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'swarm_skirmish' },
      { w: 30, kind: 'combat', encounter: 'swarm_frigate' },
      { w: 20, kind: 'salvage', credits: 150, medals: 15 },
      { w: 10, kind: 'story', flag: 'scar_vision' },
    ],
  },
  merchant_moon: {
    id: 'merchant_moon',
    name: 'Ledger Moon',
    type: 'trade',
    blurb: 'Tax-free lunar bazaar. Reputation matters.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 65, kind: 'trade', credits: 180, reputation: 7 },
      { w: 25, kind: 'delivery', credits: 220, reputation: 10 },
      { w: 10, kind: 'combat', encounter: 'pirate_wing' },
    ],
  },
  echo_reef: {
    id: 'echo_reef',
    name: 'Echo Reef',
    type: 'story',
    blurb: 'Crystal shoals that sing Swarm frequencies.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 50, kind: 'story', flag: 'echo_song' },
      { w: 30, kind: 'combat', encounter: 'swarm_frigate' },
      { w: 20, kind: 'salvage', credits: 160, medals: 14 },
    ],
  },
  veil_garden: {
    id: 'veil_garden',
    name: 'Veil Garden',
    type: 'travel',
    blurb: 'Bioluminescent debris field. Quiet beauty, quiet threats.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 40, kind: 'salvage', credits: 140, medals: 12 },
      { w: 30, kind: 'trade', credits: 160, reputation: 6 },
      { w: 30, kind: 'combat', encounter: 'swarm_probe' },
    ],
  },
  tidefall_docks: {
    id: 'tidefall_docks',
    name: 'Tidefall Docks',
    type: 'trade',
    blurb: 'Wet markets on stilts. Plip’s people set the prices.',
    fuelCost: 1,
    sector: 'spur',
    minDay: 3,
    outcomes: [
      { w: 60, kind: 'trade', credits: 130, reputation: 5 },
      { w: 25, kind: 'delivery', credits: 180, reputation: 7 },
      { w: 15, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  glass_relay: {
    id: 'glass_relay',
    name: 'Glass Relay',
    type: 'story',
    blurb: 'Ice-bound relay that still pings Veil Gate.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 6,
    outcomes: [
      { w: 55, kind: 'story', flag: 'glass_beacon' },
      { w: 25, kind: 'salvage', credits: 120, medals: 12 },
      { w: 20, kind: 'combat', encounter: 'ice_raiders' },
    ],
  },
  frost_harbor: {
    id: 'frost_harbor',
    name: 'Frost Harbor',
    type: 'trade',
    blurb: 'Veil freeport. Warm drinks, cold contracts.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 55, kind: 'trade', credits: 200, reputation: 8 },
      { w: 25, kind: 'delivery', credits: 240, reputation: 10 },
      { w: 20, kind: 'story', flag: 'frost_charter' },
    ],
  },
  night_well: {
    id: 'night_well',
    name: 'Night Well',
    type: 'danger',
    blurb: 'A gravity well the Swarm uses as a dump.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'swarm_brood' },
      { w: 30, kind: 'combat', encounter: 'veil_wraith' },
      { w: 20, kind: 'salvage', credits: 180, medals: 16 },
      { w: 10, kind: 'story', flag: 'night_mark' },
    ],
  },
  twin_suns: {
    id: 'twin_suns',
    name: 'Twin Suns',
    type: 'salvage',
    blurb: 'Binary glare. Foundry slag and hull ribs.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 45, kind: 'salvage', credits: 170, medals: 18 },
      { w: 30, kind: 'story', flag: 'twin_wake' },
      { w: 25, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  widow_reef: {
    id: 'widow_reef',
    name: 'Widow Reef',
    type: 'story',
    blurb: 'Corsair graveyard. Someone still lights the beacons.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 50, kind: 'story', flag: 'widow_oath' },
      { w: 30, kind: 'combat', encounter: 'pirate_ace' },
      { w: 20, kind: 'salvage', credits: 190, medals: 14 },
    ],
  },
  hush_yard: {
    id: 'hush_yard',
    name: 'Hush Yard',
    type: 'danger',
    blurb: 'Silent drydock. Things move when you look away.',
    fuelCost: 3,
    sector: 'veil',
    outcomes: [
      { w: 35, kind: 'combat', encounter: 'veil_wraith' },
      { w: 30, kind: 'combat', encounter: 'eclipse_echo' },
      { w: 25, kind: 'salvage', credits: 210, medals: 20 },
      { w: 10, kind: 'story', flag: 'scar_vision' },
    ],
  },
  hope_orbit: {
    id: 'hope_orbit',
    name: "Hope's Orbit",
    type: 'travel',
    blurb: 'Aid corridor over the colony. Medics and traders cash in.',
    fuelCost: 1,
    sector: 'spur',
    minDay: 2,
    outcomes: [
      { w: 50, kind: 'delivery', credits: 140, reputation: 7 },
      { w: 30, kind: 'story', flag: 'colony_help' },
      { w: 20, kind: 'combat', encounter: 'swarm_probe' },
    ],
  },
  ember_lane: {
    id: 'ember_lane',
    name: 'Ember Lane',
    type: 'salvage',
    blurb: 'Burned shipping cut. Hull ribs for bigger ships.',
    fuelCost: 2,
    sector: 'spur',
    minDay: 6,
    outcomes: [
      { w: 45, kind: 'salvage', credits: 130, medals: 14 },
      { w: 30, kind: 'story', flag: 'ember_map' },
      { w: 25, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  veil_haven_dock: {
    id: 'veil_haven_dock',
    name: 'Haven Dock',
    type: 'trade',
    blurb: 'Clinic freeport. Reputation buys the good contracts.',
    fuelCost: 2,
    sector: 'veil',
    outcomes: [
      { w: 50, kind: 'trade', credits: 190, reputation: 9 },
      { w: 30, kind: 'story', flag: 'haven_pact' },
      { w: 20, kind: 'combat', encounter: 'veil_wraith' },
    ],
  },
  ash_corridor: {
    id: 'ash_corridor',
    name: 'Ash Corridor',
    type: 'danger',
    blurb: 'The dump chute under Night Well. Brood bones.',
    fuelCost: 3,
    sector: 'veil',
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'swarm_brood' },
      { w: 30, kind: 'combat', encounter: 'eclipse_echo' },
      { w: 20, kind: 'salvage', credits: 200, medals: 18 },
      { w: 10, kind: 'story', flag: 'night_mark' },
    ],
  },
};

export const NODES = { ...BASE_NODES, ...GALAXY_NODES };

export const SECTOR_1 = {
  id: 'sector_spur',
  name: 'The Spur',
  nodes: Object.keys(NODES).filter((id) => NODES[id].sector === 'spur'),
};

export const SECTOR_2 = {
  id: 'sector_veil',
  name: 'Veil Edge',
  nodes: Object.keys(NODES).filter((id) => NODES[id].sector === 'veil'),
  unlockFlag: 'veil_opened',
};

export function careerDay(player, now = Date.now()) {
  return 1 + Math.floor((now - (player.createdAt || now)) / 86400000);
}

/** Nodes visible on map for this player */
export function visibleNodes(player, now = Date.now()) {
  const day = careerDay(player, now);
  const veilOpen = Boolean(player.flags?.veil_opened || player.story?.veilUnlocked);
  const tutorialTight =
    player?.tutorial &&
    !player.tutorial.completed &&
    !player.tutorial.dismissed &&
    (player.tutorial.script || 1) === 2 &&
    player.tutorial.phase !== 'done';

  return Object.values(NODES).filter((n) => {
    if (tutorialTight) {
      return n.id === 'station_home' || n.id === 'lane_a';
    }
    if (n.sector === 'veil' && n.id !== 'veil_gate' && !veilOpen) return false;
    if (n.id === 'veil_gate' && day < 2 && !player.flags?.rumor_swarm) return false;
    if (n.sector === 'ember' && n.id !== 'ember_gate' && !galaxyUnlocked(player, 'ember')) return false;
    if (n.id === 'ember_gate' && (player.story?.chapter || 0) < 3 && !player.flags?.forge_gift && !player.flags?.ember_map) return false;
    if (n.sector === 'hollow' && n.id !== 'hollow_mouth' && !galaxyUnlocked(player, 'hollow')) return false;
    if (n.id === 'hollow_mouth' && !galaxyUnlocked(player, 'ember') && (player.story?.chapter || 0) < 5) return false;
    if (n.sector === 'crown' && n.id !== 'halo_approach' && !galaxyUnlocked(player, 'crown')) return false;
    if (n.id === 'halo_approach' && !galaxyUnlocked(player, 'hollow') && (player.story?.chapter || 0) < 6) return false;
    if (n.minDay && day < n.minDay) return false;
    return true;
  });
}

export function pickOutcome(outcomes, rng = Math.random) {
  const total = outcomes.reduce((s, o) => s + o.w, 0);
  let r = rng() * total;
  for (const o of outcomes) {
    r -= o.w;
    if (r <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

const BASE_STORY = {
  rumor_swarm: {
    title: 'Whispers of Eclipse',
    text: 'Dockworkers swear black-shelled probes have been tagging freighters. Someone is mapping the Spur.',
    chapter: 1,
    rewards: { credits: 40, reputation: 5 },
  },
  colony_help: {
    title: "Hope's Rest Holds",
    text: 'You drop supplies and scare off a scout wing. The colony mayor presses a data-chip into your hand: Swarm staging coordinates.',
    chapter: 2,
    rewards: { credits: 70, reputation: 6, medals: 4 },
  },
  ice_convoy: {
    title: 'Glass Spur Convoy',
    text: 'A refugee convoy hails you. Escorting them nets gratitude — and a warning that Veil Gate is next.',
    chapter: 2,
    rewards: { credits: 80, reputation: 6, medals: 4 },
  },
  signal_contact: {
    title: 'Array Handshake',
    text: 'The listening post answers once — a Swarm navigation ping. You log the vector toward Veil Gate.',
    chapter: 2,
    rewards: { credits: 65, reputation: 5, medals: 5 },
  },
  pirate_king: {
    title: "Corsair's Bargain",
    text: 'A pirate lord offers free passage if you smuggle a crate. You decline. They respect the refusal — barely.',
    chapter: 2,
    rewards: { credits: 90, reputation: 4, medals: 6 },
  },
  black_canal_pact: {
    title: 'Canal Pact',
    text: 'Brokers sell you a forged Veil Gate stamp. Reputation among shadows rises; the Swarm still hunts.',
    chapter: 3,
    rewards: { credits: 110, reputation: 8, medals: 5 },
  },
  forge_gift: {
    title: 'Forge Blessing',
    text: 'Yard bosses gift a hull schematic. Corvette parts become slightly less mythical.',
    chapter: 3,
    rewards: { credits: 120, reputation: 6, medals: 8 },
  },
  veil_opened: {
    title: 'Veil Gate Access',
    text: 'Customs waves you through. Beyond the gate, space feels colder. Eclipse Scar glows on the long-range scan.',
    chapter: 3,
    art: 'veil',
    rewards: { credits: 90, reputation: 8, medals: 6 },
  },
  scar_vision: {
    title: 'Scar Memory',
    text: 'In the wrecklight you see a Swarm frigate silhouette larger than a station. The war is not theoretical.',
    chapter: 3,
    rewards: { credits: 100, reputation: 10, medals: 8 },
  },
  echo_song: {
    title: "The Reef's Song",
    text: 'Crystal harmonics resolve into a frequency. Your engineer records it as a possible jammer key against Swarm drones.',
    chapter: 4,
    rewards: { credits: 80, reputation: 8, medals: 6 },
  },
  glass_beacon: {
    title: 'Glass Beacon',
    text: 'The relay answers in Veil-code. A corridor of safe ice opens on the long-range plot.',
    chapter: 3,
    rewards: { credits: 70, reputation: 6, medals: 4 },
  },
  frost_charter: {
    title: 'Frost Charter',
    text: 'Harbor masters stamp a Veil trading writ. Ledger Moon pays you better now.',
    chapter: 3,
    rewards: { credits: 90, reputation: 7 },
  },
  night_mark: {
    title: 'Night Mark',
    text: 'Something in the well branded your hull. Swarm probes hesitate around the mark — for now.',
    chapter: 4,
    rewards: { credits: 60, reputation: 9, medals: 8 },
  },
  twin_wake: {
    title: 'Twin Wake',
    text: 'The foundry AI still thinks the war is on. It gifts you a hull-rib schematic and a warning.',
    chapter: 4,
    rewards: { credits: 100, reputation: 6, medals: 10 },
  },
  widow_oath: {
    title: "Widow's Oath",
    text: 'A surviving corsair swears the Swarm took her captain. She names Night Well as the dumping ground.',
    chapter: 4,
    rewards: { credits: 80, reputation: 8, medals: 5 },
  },
  ember_map: {
    title: 'Ember Map',
    text: 'A burned chart names Forge Moon as the only yard still pouring corvette ribs.',
    chapter: 3,
    rewards: { credits: 90, reputation: 5, medals: 8 },
  },
  haven_pact: {
    title: 'Haven Pact',
    text: 'The clinic stamps your hull. Veil docks treat you as friend, not meat.',
    chapter: 4,
    rewards: { credits: 110, reputation: 10, medals: 6 },
  },
};

export const STORY_BEATS = { ...BASE_STORY, ...GALAXY_BEATS };

const HAZARD_BY_TYPE = {
  station: 'none',
  trade: 'low',
  travel: 'low',
  salvage: 'mid',
  story: 'mid',
  danger: 'high',
};

const PAYOUT_BY_TYPE = {
  station: 'dock',
  trade: 'trade',
  travel: 'mixed',
  salvage: 'scrap',
  story: 'story',
  danger: 'fight',
};

export function nodeMeta(n) {
  if (!n) return { hazard: 'low', payout: 'mixed' };
  return {
    hazard: n.hazard || HAZARD_BY_TYPE[n.type] || 'low',
    payout: n.payout || PAYOUT_BY_TYPE[n.type] || 'mixed',
  };
}

export function typicalPayout(n) {
  const outs = n?.outcomes || [];
  if (!outs.length) return 'dock';
  const credits = [];
  for (const o of outs) {
    if (o.credits) credits.push(o.credits);
    else if (o.kind === 'combat' && o.encounter) {
      const c = encounterById(o.encounter)?.rewards?.credits;
      if (c) credits.push(c);
    } else if (o.kind === 'story') {
      // story beats pay in applyStoryFlag; skip here
    }
  }
  if (credits.length) {
    const lo = Math.min(...credits);
    const hi = Math.max(...credits);
    return lo === hi ? `~${hi}cr` : `${lo}–${hi}cr`;
  }
  if (outs.some((o) => o.kind === 'combat')) return 'fight';
  if (outs.some((o) => o.kind === 'story')) return 'story';
  return 'mixed';
}

export function nodesBySector(list) {
  const buckets = { spur: [], veil: [], ember: [], hollow: [], crown: [] };
  for (const n of list) {
    const k = n.sector && buckets[n.sector] ? n.sector : 'spur';
    buckets[k].push(n);
  }
  return buckets;
}

