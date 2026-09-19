/** Multi-node map for The Spur + Veil Edge (30-day content backbone) */

export const NODES = {
  station_home: {
    id: 'station_home',
    name: 'Spur Anchor',
    type: 'station',
    blurb: 'Your safe harbor and merc board.',
    fuelCost: 0,
  },
  lane_a: {
    id: 'lane_a',
    name: 'Dust Lane',
    type: 'travel',
    blurb: 'Light traffic. Good for learning the ropes.',
    fuelCost: 1,
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
    outcomes: [
      { w: 55, kind: 'story', flag: 'colony_help' },
      { w: 45, kind: 'combat', encounter: 'swarm_skirmish' },
    ],
  },
  // Phase C nodes
  ice_spur: {
    id: 'ice_spur',
    name: 'Glass Spur',
    type: 'travel',
    blurb: 'Frozen shipping lane. Convoys pay well.',
    fuelCost: 1,
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
    outcomes: [
      { w: 50, kind: 'salvage', credits: 70, medals: 6 },
      { w: 30, kind: 'salvage', credits: 120, medals: 12 },
      { w: 20, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  },
  veil_gate: {
    id: 'veil_gate',
    name: 'Veil Gate',
    type: 'story',
    blurb: 'Border station into Veil Edge space.',
    fuelCost: 2,
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
    outcomes: [
      { w: 50, kind: 'story', flag: 'echo_song' },
      { w: 30, kind: 'combat', encounter: 'swarm_frigate' },
      { w: 20, kind: 'salvage', credits: 160, medals: 14 },
    ],
  },
};

export const SECTOR_1 = {
  id: 'sector_spur',
  name: 'The Spur',
  nodes: [
    'station_home', 'lane_a', 'outpost_trade', 'danger_belt', 'colony_hope',
    'ice_spur', 'scrapyard',
  ],
};

export const SECTOR_2 = {
  id: 'sector_veil',
  name: 'Veil Edge',
  nodes: ['veil_gate', 'swarm_scar', 'merchant_moon', 'echo_reef'],
  unlockFlag: 'veil_opened',
};

export function pickOutcome(outcomes, rng = Math.random) {
  const total = outcomes.reduce((s, o) => s + o.w, 0);
  let r = rng() * total;
  for (const o of outcomes) {
    r -= o.w;
    if (r <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

/** Story flag → short captain log lines */
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
