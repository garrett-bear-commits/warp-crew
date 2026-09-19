/** Placeholder pixel portraits + hull art (Boglight / Warp Crew). */

export const CREW_PORTRAITS = {
  merc_rex: "/art/pixel/crew/rex.png",
  merc_bolt: "/art/pixel/crew/bolt.png",
  merc_jen: "/art/pixel/crew/jen.png",
  merc_moss: "/art/pixel/crew/moss.png",
  merc_plip: "/art/pixel/crew/plip.png",
  merc_kira: "/art/pixel/crew/kira.png",
  merc_syla: "/art/pixel/crew/plip.png",
  merc_rook: "/art/pixel/crew/rook.png",
  merc_nemi: "/art/pixel/crew/nemi.png",
  merc_cog: "/art/pixel/crew/bolt.png",
  merc_vorn: "/art/pixel/crew/vorn.png",
  merc_quill: "/art/pixel/crew/nemi.png",
  merc_isa: "/art/pixel/crew/moss.png",
  merc_drift: "/art/pixel/crew/zephyr.png",
  merc_hex: "/art/pixel/crew/kira.png",
  merc_ada: "/art/pixel/crew/moss.png",
  merc_skarn: "/art/pixel/crew/vorn.png",
  merc_lora: "/art/pixel/crew/onyx.png",
  merc_wisp: "/art/pixel/crew/nemi.png",
  merc_zephyr: "/art/pixel/crew/zephyr.png",
  merc_onyx: "/art/pixel/crew/onyx.png",
  merc_prism: "/art/pixel/crew/bolt.png",
};

const ROLE_FALLBACK = {
  pilot: "/art/pixel/crew/rex.png",
  gunner: "/art/pixel/crew/jen.png",
  engineer: "/art/pixel/crew/bolt.png",
  medic: "/art/pixel/crew/moss.png",
  trader: "/art/pixel/crew/plip.png",
  scout: "/art/pixel/crew/nemi.png",
  security: "/art/pixel/crew/rook.png",
};

export const SHIP_ART = {
  sparrow: "/art/pixel/ships/sparrow.png",
  corvette: "/art/pixel/ships/corvette.png",
  frigate: "/art/pixel/ships/frigate.png",
};

export const CUTAWAY_ART = "/art/pixel/ships/sparrow-cutaway.jpg";
export const SWARM_ART = "/art/pixel/fx/swarm.png";

export const ICONS = {
  fuel: "/art/pixel/icons/fuel.png",
  gems: "/art/pixel/icons/gems.png",
  medals: "/art/pixel/icons/medals.png",
  credits: "/art/pixel/icons/credits.png",
};

export const NODE_ART = {
  a: "/art/pixel/icons/node-wreck.png",
  b: "/art/pixel/icons/node-crystal.png",
  c: "/art/pixel/icons/node-station.png",
  d: "/art/pixel/icons/node-planet.png",
};

export function portraitFor(templateId, role) {
  return CREW_PORTRAITS[templateId] || ROLE_FALLBACK[role] || CREW_PORTRAITS.merc_rex;
}

export function shipArtFor(shipId) {
  return SHIP_ART[shipId] || SHIP_ART.sparrow;
}
