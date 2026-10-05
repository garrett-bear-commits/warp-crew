// @ts-nocheck
/**
 * Sector maps: hand-placed beacons joined by lanes (FTL-lite phase 3).
 *
 * Coordinates are map units: x 0–100 across, y 0–MAP_HEIGHT down (same unit both ways).
 * Each map lists its own beacons and the "border" beacons of neighbouring sectors that
 * a lane reaches, so the way in and out of a sector is always drawn.
 * Lanes are global and undirected; a map draws a lane when both ends are on it.
 */

export const MAP_WIDTH = 100;
export const MAP_HEIGHT = 146;

export const SECTOR_MAPS = {
  spur: {
    id: 'spur',
    name: 'The Spur',
    beacons: {
      hope_orbit: { x: 10, y: 12 },
      station_home: { x: 10, y: 66 },
      scrapyard: { x: 10, y: 120 },
      colony_hope: { x: 28, y: 28 },
      lane_a: { x: 28, y: 54 },
      outpost_trade: { x: 28, y: 80 },
      amber_port: { x: 28, y: 108 },
      convoy_route: { x: 48, y: 12 },
      danger_belt: { x: 48, y: 66 },
      tidefall_docks: { x: 48, y: 94 },
      relic_field: { x: 48, y: 124 },
      ice_spur: { x: 68, y: 28 },
      signal_array: { x: 68, y: 54 },
      pirate_nest: { x: 68, y: 80 },
      aurora_station: { x: 68, y: 106 },
      forge_moon: { x: 68, y: 132 },
      glass_relay: { x: 90, y: 12 },
      veil_gate: { x: 90, y: 42 },
      black_canal: { x: 90, y: 80 },
      ember_lane: { x: 90, y: 108 },
      ember_gate: { x: 90, y: 134 },
    },
  },
  veil: {
    id: 'veil',
    name: 'Veil Edge',
    beacons: {
      glass_relay: { x: 10, y: 30 },
      ice_spur: { x: 10, y: 70 },
      signal_array: { x: 10, y: 110 },
      veil_gate: { x: 24, y: 70 },
      frost_harbor: { x: 42, y: 36 },
      merchant_moon: { x: 42, y: 74 },
      swarm_scar: { x: 42, y: 112 },
      veil_garden: { x: 60, y: 14 },
      echo_reef: { x: 60, y: 52 },
      veil_haven_dock: { x: 60, y: 92 },
      night_well: { x: 60, y: 130 },
      widow_reef: { x: 78, y: 30 },
      twin_suns: { x: 78, y: 70 },
      ash_corridor: { x: 78, y: 112 },
      ember_gate: { x: 90, y: 46 },
      hush_yard: { x: 90, y: 96 },
    },
  },
  ember: {
    id: 'ember',
    name: 'Ember Reach',
    beacons: {
      ember_lane: { x: 10, y: 20 },
      forge_moon: { x: 10, y: 54 },
      twin_suns: { x: 10, y: 88 },
      widow_reef: { x: 10, y: 122 },
      ember_gate: { x: 26, y: 70 },
      cinder_docks: { x: 45, y: 40 },
      slag_sea: { x: 45, y: 102 },
      ash_market: { x: 63, y: 18 },
      kiln_reach: { x: 63, y: 70 },
      solar_forge: { x: 63, y: 124 },
      red_wake: { x: 82, y: 40 },
      hollow_mouth: { x: 90, y: 96 },
    },
  },
  hollow: {
    id: 'hollow',
    name: 'Hollow Expanse',
    beacons: {
      red_wake: { x: 10, y: 40 },
      kiln_reach: { x: 10, y: 100 },
      hollow_mouth: { x: 26, y: 70 },
      pale_market: { x: 45, y: 36 },
      bone_orbit: { x: 45, y: 104 },
      silent_choir: { x: 64, y: 14 },
      dark_well: { x: 64, y: 70 },
      echo_tomb: { x: 64, y: 126 },
      null_harbor: { x: 84, y: 48 },
      halo_approach: { x: 90, y: 100 },
    },
  },
  crown: {
    id: 'crown',
    name: 'Crown Halo',
    beacons: {
      null_harbor: { x: 10, y: 40 },
      echo_tomb: { x: 10, y: 102 },
      halo_approach: { x: 26, y: 70 },
      gilt_ring: { x: 46, y: 36 },
      verdict_yard: { x: 46, y: 106 },
      throne_dock: { x: 66, y: 70 },
      meridian_gate: { x: 86, y: 24 },
      eclipse_crown: { x: 86, y: 116 },
    },
  },
};

export const SECTOR_ORDER = ['spur', 'veil', 'ember', 'hollow', 'crown'];

/** Undirected lanes. Every beacon that appears later in a career hangs off beacons visible before it. */
export const LANES = [
  // Spur, day 1: a hub around Spur Anchor.
  ['station_home', 'lane_a'], ['station_home', 'outpost_trade'], ['station_home', 'scrapyard'],
  ['lane_a', 'colony_hope'], ['lane_a', 'danger_belt'], ['outpost_trade', 'danger_belt'],
  ['colony_hope', 'ice_spur'], ['danger_belt', 'ice_spur'],
  // Spur, day 2.
  ['station_home', 'hope_orbit'], ['hope_orbit', 'colony_hope'],
  ['scrapyard', 'amber_port'], ['outpost_trade', 'amber_port'],
  ['danger_belt', 'signal_array'], ['ice_spur', 'signal_array'],
  // Day 3.
  ['amber_port', 'tidefall_docks'], ['outpost_trade', 'tidefall_docks'],
  ['signal_array', 'pirate_nest'], ['danger_belt', 'pirate_nest'],
  ['amber_port', 'relic_field'], ['tidefall_docks', 'relic_field'],
  // Day 4.
  ['colony_hope', 'convoy_route'], ['ice_spur', 'convoy_route'],
  ['tidefall_docks', 'aurora_station'], ['pirate_nest', 'aurora_station'],
  // Day 5.
  ['pirate_nest', 'black_canal'], ['aurora_station', 'black_canal'],
  ['relic_field', 'forge_moon'], ['aurora_station', 'forge_moon'],
  // Day 6.
  ['convoy_route', 'glass_relay'], ['forge_moon', 'ember_lane'], ['black_canal', 'ember_lane'],
  // Spur to Veil Gate.
  ['ice_spur', 'veil_gate'], ['signal_array', 'veil_gate'], ['glass_relay', 'veil_gate'],
  // Veil Edge.
  ['veil_gate', 'frost_harbor'], ['veil_gate', 'merchant_moon'], ['veil_gate', 'swarm_scar'],
  ['frost_harbor', 'veil_garden'], ['frost_harbor', 'echo_reef'],
  ['merchant_moon', 'echo_reef'], ['merchant_moon', 'veil_haven_dock'],
  ['swarm_scar', 'veil_haven_dock'], ['swarm_scar', 'night_well'],
  ['veil_garden', 'widow_reef'], ['echo_reef', 'widow_reef'], ['echo_reef', 'twin_suns'],
  ['veil_haven_dock', 'twin_suns'], ['veil_haven_dock', 'ash_corridor'], ['night_well', 'ash_corridor'],
  ['twin_suns', 'hush_yard'], ['ash_corridor', 'hush_yard'],
  // Ember Gate: from the Spur's burned lanes and from the far side of the Veil.
  ['ember_lane', 'ember_gate'], ['forge_moon', 'ember_gate'], ['twin_suns', 'ember_gate'], ['widow_reef', 'ember_gate'],
  // Ember Reach.
  ['ember_gate', 'cinder_docks'], ['ember_gate', 'slag_sea'],
  ['cinder_docks', 'ash_market'], ['cinder_docks', 'kiln_reach'], ['slag_sea', 'kiln_reach'], ['slag_sea', 'solar_forge'],
  ['solar_forge', 'kiln_reach'], ['ash_market', 'red_wake'], ['kiln_reach', 'red_wake'],
  ['red_wake', 'hollow_mouth'], ['kiln_reach', 'hollow_mouth'],
  // Hollow Expanse.
  ['hollow_mouth', 'pale_market'], ['hollow_mouth', 'bone_orbit'],
  ['pale_market', 'silent_choir'], ['pale_market', 'dark_well'], ['bone_orbit', 'dark_well'], ['bone_orbit', 'echo_tomb'],
  ['silent_choir', 'null_harbor'], ['dark_well', 'null_harbor'], ['echo_tomb', 'null_harbor'],
  ['null_harbor', 'halo_approach'], ['echo_tomb', 'halo_approach'],
  // Crown Halo.
  ['halo_approach', 'gilt_ring'], ['halo_approach', 'verdict_yard'],
  ['gilt_ring', 'throne_dock'], ['verdict_yard', 'throne_dock'], ['gilt_ring', 'meridian_gate'], ['throne_dock', 'meridian_gate'],
  ['throne_dock', 'eclipse_crown'], ['verdict_yard', 'eclipse_crown'],
];

const NEIGHBORS = (() => {
  const map = {};
  for (const [a, b] of LANES) {
    (map[a] ||= new Set()).add(b);
    (map[b] ||= new Set()).add(a);
  }
  return map;
})();

export function laneNeighbors(nodeId) {
  return [...(NEIGHBORS[nodeId] || [])];
}

export function hasLane(a, b) {
  return Boolean(NEIGHBORS[a]?.has(b));
}
