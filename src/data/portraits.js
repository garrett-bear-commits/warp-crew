// @ts-nocheck
/** Placeholder pixel portraits + hull art (Boglight / Warp Crew). */

import { artUrl } from '../shared/artUrl.js';

export const CREW_PORTRAITS = {
  merc_rex: artUrl('art/pixel/crew/rex.png'),
  merc_bolt: artUrl('art/pixel/crew/bolt.png'),
  merc_jen: artUrl('art/pixel/crew/jen.png'),
  merc_moss: artUrl('art/pixel/crew/moss.png'),
  merc_plip: artUrl('art/pixel/crew/plip.png'),
  merc_kira: artUrl('art/pixel/crew/kira.png'),
  merc_syla: artUrl('art/pixel/crew/plip.png'),
  merc_rook: artUrl('art/pixel/crew/rook.png'),
  merc_nemi: artUrl('art/pixel/crew/nemi.png'),
  merc_cog: artUrl('art/pixel/crew/bolt.png'),
  merc_vorn: artUrl('art/pixel/crew/vorn.png'),
  merc_quill: artUrl('art/pixel/crew/nemi.png'),
  merc_isa: artUrl('art/pixel/crew/moss.png'),
  merc_drift: artUrl('art/pixel/crew/zephyr.png'),
  merc_hex: artUrl('art/pixel/crew/kira.png'),
  merc_ada: artUrl('art/pixel/crew/moss.png'),
  merc_skarn: artUrl('art/pixel/crew/vorn.png'),
  merc_lora: artUrl('art/pixel/crew/onyx.png'),
  merc_wisp: artUrl('art/pixel/crew/nemi.png'),
  merc_zephyr: artUrl('art/pixel/crew/zephyr.png'),
  merc_onyx: artUrl('art/pixel/crew/onyx.png'),
  merc_prism: artUrl('art/pixel/crew/bolt.png'),
};

const ROLE_FALLBACK = {
  pilot: artUrl('art/pixel/crew/rex.png'),
  gunner: artUrl('art/pixel/crew/jen.png'),
  engineer: artUrl('art/pixel/crew/bolt.png'),
  medic: artUrl('art/pixel/crew/moss.png'),
  trader: artUrl('art/pixel/crew/plip.png'),
  scout: artUrl('art/pixel/crew/nemi.png'),
  security: artUrl('art/pixel/crew/rook.png'),
};

export const SHIP_ART = {
  sparrow: artUrl('art/pixel/ships/sparrow.png'),
  corvette: artUrl('art/pixel/ships/corvette.png'),
  frigate: artUrl('art/pixel/ships/frigate.png'),
};

export const CUTAWAY_ART = artUrl('art/space/sparrow-hull-v3.png');
export const SWARM_ART = artUrl('art/pixel/fx/swarm.png');

export const SPACE_ART = {
  hull: artUrl('art/space/sparrow-hull-v3.png'),
  stars: artUrl('art/space/stars.png'),
  nebula: artUrl('art/space/nebula.png'),
  planet: artUrl('art/space/planet.png'),
  planetIce: artUrl('art/space/planet-ice.png'),
  blackhole: artUrl('art/space/blackhole.png'),
  pirate: artUrl('art/space/pirate-scout.png'),
  impact: artUrl('art/fx/impact.png'),
  laser: artUrl('art/fx/laser.png'),
  asteroids: [
    artUrl('art/space/asteroid-1.png'),
    artUrl('art/space/asteroid-2.png'),
    artUrl('art/space/asteroid-3.png'),
    artUrl('art/space/asteroid-4.png'),
  ],
};

export const ICONS = {
  fuel: artUrl('art/pixel/icons/fuel.png'),
  gems: artUrl('art/pixel/icons/gems.png'),
  medals: artUrl('art/pixel/icons/medals.png'),
  credits: artUrl('art/pixel/icons/credits.png'),
};

export const NODE_ART = {
  a: artUrl('art/pixel/icons/node-wreck.png'),
  b: artUrl('art/pixel/icons/node-crystal.png'),
  c: artUrl('art/pixel/icons/node-station.png'),
  d: artUrl('art/pixel/icons/node-planet.png'),
};

export function portraitFor(templateId, role) {
  return CREW_PORTRAITS[templateId] || ROLE_FALLBACK[role] || CREW_PORTRAITS.merc_rex;
}

export function shipArtFor(shipId) {
  return SHIP_ART[shipId] || SHIP_ART.sparrow;
}
