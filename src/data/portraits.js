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
  merc_syla: artUrl('art/pixel/crew/syla.png'),
  merc_rook: artUrl('art/pixel/crew/rook.png'),
  merc_nemi: artUrl('art/pixel/crew/nemi.png'),
  merc_cog: artUrl('art/pixel/crew/cog.png'),
  merc_vorn: artUrl('art/pixel/crew/vorn.png'),
  merc_quill: artUrl('art/pixel/crew/quill.png'),
  merc_isa: artUrl('art/pixel/crew/isa.png'),
  merc_drift: artUrl('art/pixel/crew/drift.png'),
  merc_hex: artUrl('art/pixel/crew/hex.png'),
  merc_ada: artUrl('art/pixel/crew/ada.png'),
  merc_skarn: artUrl('art/pixel/crew/skarn.png'),
  merc_lora: artUrl('art/pixel/crew/lora.png'),
  merc_wisp: artUrl('art/pixel/crew/wisp.png'),
  merc_zephyr: artUrl('art/pixel/crew/zephyr.png'),
  merc_onyx: artUrl('art/pixel/crew/onyx.png'),
  merc_prism: artUrl('art/pixel/crew/prism.png'),
  merc_tess: artUrl('art/pixel/crew/tess.png'),
  merc_dax: artUrl('art/pixel/crew/dax.png'),
  merc_nub: artUrl('art/pixel/crew/nub.png'),
  merc_pip: artUrl('art/pixel/crew/pip.png'),
  merc_juno: artUrl('art/pixel/crew/juno.png'),
  merc_greaves: artUrl('art/pixel/crew/greaves.png'),
  merc_yara: artUrl('art/pixel/crew/yara.png'),
  merc_brink: artUrl('art/pixel/crew/brink.png'),
  merc_oso: artUrl('art/pixel/crew/oso.png'),
  merc_orla: artUrl('art/pixel/crew/orla.png'),
  merc_tink: artUrl('art/pixel/crew/tink.png'),
  merc_kal: artUrl('art/pixel/crew/kal.png'),
  merc_vex: artUrl('art/pixel/crew/vex.png'),
  merc_moth: artUrl('art/pixel/crew/moth.png'),
  merc_reed: artUrl('art/pixel/crew/reed.png'),
  merc_rune: artUrl('art/pixel/crew/rune.png'),
  merc_ashen: artUrl('art/pixel/crew/ashen.png'),
  merc_nyx: artUrl('art/pixel/crew/nyx.png'),
  merc_coil: artUrl('art/pixel/crew/coil.png'),
  merc_solace: artUrl('art/pixel/crew/solace.png'),
  merc_harrow: artUrl('art/pixel/crew/harrow.png'),
  merc_eclipse: artUrl('art/pixel/crew/eclipse.png'),
  merc_archon: artUrl('art/pixel/crew/archon.png'),
  merc_voidwake: artUrl('art/pixel/crew/voidwake.png'),
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
  kestrel: artUrl('art/pixel/ships/kestrel.png'),
  corvette: artUrl('art/pixel/ships/corvette.png'),
  clipper: artUrl('art/pixel/ships/clipper.png'),
  frigate: artUrl('art/pixel/ships/frigate.png'),
  destroyer: artUrl('art/pixel/ships/destroyer.png'),
  cruiser: artUrl('art/pixel/ships/cruiser.png'),
  carrier: artUrl('art/pixel/ships/carrier.png'),
  dreadnought: artUrl('art/pixel/ships/dreadnought.png'),
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

export const PLANET_ART = {
  wreck: artUrl('art/pixel/icons/node-wreck.png'),
  crystal: artUrl('art/pixel/icons/node-crystal.png'),
  station: artUrl('art/pixel/icons/node-station.png'),
  planet: artUrl('art/pixel/icons/node-planet.png'),
  ice: artUrl('art/space/planet-ice.png'),
  swarm: artUrl('art/pixel/fx/swarm.png'),
};

export const CINEMATIC_ART = {
  splash: artUrl('art/pixel/splash.png'),
  jump: artUrl('art/pixel/cinematic/jump.png'),
  hire: artUrl('art/pixel/cinematic/hire.png'),
  veil: artUrl('art/pixel/cinematic/veil.png'),
  ember: artUrl('art/pixel/cinematic/ember.png'),
  hollow: artUrl('art/pixel/cinematic/hollow.png'),
  crown: artUrl('art/pixel/cinematic/crown.png'),
};

export const SPLASH_ART = CINEMATIC_ART.splash;

export function cinematicArtFor(key) {
  return CINEMATIC_ART[key] || CINEMATIC_ART.jump;
}

export function planetArtFor(key) {
  return PLANET_ART[key] || PLANET_ART.planet;
}

export function portraitFor(templateId, role) {
  return CREW_PORTRAITS[templateId] || ROLE_FALLBACK[role] || CREW_PORTRAITS.merc_rex;
}

export function shipArtFor(shipId) {
  return SHIP_ART[shipId] || SHIP_ART.sparrow;
}
