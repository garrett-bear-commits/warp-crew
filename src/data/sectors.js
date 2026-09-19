/** Tutorial sector + sector 1 nodes for the core slice */

export const NODES = {
  station_home: {
    id: 'station_home',
    name: 'Spur Anchor',
    type: 'station',
    blurb: 'Your safe harbor.',
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
    name: 'Hope’s Rest',
    type: 'story',
    blurb: 'A colony under Eclipse Swarm pressure.',
    fuelCost: 2,
    outcomes: [
      { w: 60, kind: 'story', flag: 'colony_help' },
      { w: 40, kind: 'combat', encounter: 'swarm_skirmish' },
    ],
  },
};

export const SECTOR_1 = {
  id: 'sector_spur',
  name: 'The Spur',
  nodes: ['station_home', 'lane_a', 'outpost_trade', 'danger_belt', 'colony_hope'],
  links: [
    ['station_home', 'lane_a'],
    ['lane_a', 'outpost_trade'],
    ['lane_a', 'danger_belt'],
    ['outpost_trade', 'colony_hope'],
    ['danger_belt', 'colony_hope'],
  ],
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
