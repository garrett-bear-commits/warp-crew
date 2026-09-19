/** Multi-node map — Spur + Veil Edge (week-of-content backbone) */

export const NODES = {
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
      { w: 30, kind: 'combat', encounter: 'pirate_ace' },
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
};

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
  return Object.values(NODES).filter((n) => {
    if (n.sector === 'veil' && n.id !== 'veil_gate' && !veilOpen) return false;
    // veil_gate always visible as the unlock target once day>=2 or after rumor
    if (n.id === 'veil_gate' && day < 2 && !player.flags?.rumor_swarm) return false;
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

export const STORY_BEATS = {
  rumor_swarm: {
    title: 'Whispers of Eclipse',
    text: 'Dockworkers swear black-shelled probes have been tagging freighters. Someone is mapping the Spur.',
    chapter: 1,
  },
  colony_help: {
    title: "Hope's Rest Holds",
    text: 'You drop supplies and scare off a scout wing. The colony mayor presses a data-chip into your hand: Swarm staging coordinates.',
    chapter: 2,
  },
  ice_convoy: {
    title: 'Glass Spur Convoy',
    text: 'A refugee convoy hails you. Escorting them nets gratitude — and a warning that Veil Gate is next.',
    chapter: 2,
  },
  signal_contact: {
    title: 'Array Handshake',
    text: 'The listening post answers once — a Swarm navigation ping. You log the vector toward Veil Gate.',
    chapter: 2,
  },
  pirate_king: {
    title: "Corsair's Bargain",
    text: 'A pirate lord offers free passage if you smuggle a crate. You decline. They respect the refusal — barely.',
    chapter: 2,
  },
  black_canal_pact: {
    title: 'Canal Pact',
    text: 'Brokers sell you a forged Veil Gate stamp. Reputation among shadows rises; the Swarm still hunts.',
    chapter: 3,
  },
  forge_gift: {
    title: 'Forge Blessing',
    text: 'Yard bosses gift a hull schematic. Corvette parts become slightly less mythical.',
    chapter: 3,
  },
  veil_opened: {
    title: 'Veil Gate Access',
    text: 'Customs waves you through. Beyond the gate, space feels colder. Eclipse Scar glows on the long-range scan.',
    chapter: 3,
  },
  scar_vision: {
    title: 'Scar Memory',
    text: 'In the wrecklight you see a Swarm frigate silhouette larger than a station. The war is not theoretical.',
    chapter: 3,
  },
  echo_song: {
    title: "The Reef's Song",
    text: 'Crystal harmonics resolve into a frequency. Your engineer records it as a possible jammer key against Swarm drones.',
    chapter: 4,
  },
};
