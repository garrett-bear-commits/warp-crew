// @ts-nocheck
/** Ember / Hollow / Crown galaxies — mid to end game map. */

function node(id, extra) {
  return { id, ...extra };
}

export const GALAXY_META = [
  { id: 'spur', name: 'The Spur', unlock: 'start' },
  { id: 'veil', name: 'Veil Edge', unlock: 'veil_opened' },
  { id: 'ember', name: 'Ember Reach', unlock: 'ember_opened' },
  { id: 'hollow', name: 'Hollow Expanse', unlock: 'hollow_opened' },
  { id: 'crown', name: 'Crown Halo', unlock: 'crown_opened' },
];

export const GALAXY_NODES = {
  ember_gate: node('ember_gate', {
    name: 'Ember Gate', type: 'story', sector: 'ember', fuelCost: 2,
    blurb: 'Cinder customs. The air tastes like slag.',
    outcomes: [
      { w: 55, kind: 'story', flag: 'ember_opened' },
      { w: 25, kind: 'trade', credits: 220, reputation: 8 },
      { w: 20, kind: 'combat', encounter: 'ember_raider' },
    ],
  }),
  cinder_docks: node('cinder_docks', {
    name: 'Cinder Docks', type: 'trade', sector: 'ember', fuelCost: 2,
    blurb: 'Hot piers. Honest overtime if you don’t melt.',
    outcomes: [
      { w: 60, kind: 'trade', credits: 240, reputation: 8 },
      { w: 25, kind: 'delivery', credits: 300, reputation: 10 },
      { w: 15, kind: 'combat', encounter: 'ember_raider' },
    ],
  }),
  slag_sea: node('slag_sea', {
    name: 'Slag Sea', type: 'salvage', sector: 'ember', fuelCost: 2,
    blurb: 'Cooled metal ocean. Ribs stick out like reefs.',
    outcomes: [
      { w: 45, kind: 'salvage', credits: 200, medals: 18 },
      { w: 30, kind: 'salvage', credits: 280, medals: 24 },
      { w: 25, kind: 'combat', encounter: 'scrapper_gang' },
    ],
  }),
  kiln_reach: node('kiln_reach', {
    name: 'Kiln Reach', type: 'danger', sector: 'ember', fuelCost: 3,
    blurb: 'Furnace lane. Raiders in heat-shield paint.',
    outcomes: [
      { w: 45, kind: 'combat', encounter: 'ember_raider' },
      { w: 30, kind: 'combat', encounter: 'corsair_king' },
      { w: 25, kind: 'salvage', credits: 260, medals: 20 },
    ],
  }),
  ash_market: node('ash_market', {
    name: 'Ash Market', type: 'trade', sector: 'ember', fuelCost: 2,
    blurb: 'Everything is slightly burned and slightly cheaper.',
    outcomes: [
      { w: 55, kind: 'trade', credits: 260, reputation: 9 },
      { w: 25, kind: 'delivery', credits: 320, reputation: 11 },
      { w: 20, kind: 'story', flag: 'ash_ledger' },
    ],
  }),
  solar_forge: node('solar_forge', {
    name: 'Solar Forge', type: 'story', sector: 'ember', fuelCost: 3,
    blurb: 'A star-pumped foundry that still thinks it’s wartime.',
    outcomes: [
      { w: 50, kind: 'story', flag: 'solar_blessing' },
      { w: 30, kind: 'salvage', credits: 240, medals: 22 },
      { w: 20, kind: 'combat', encounter: 'ember_raider' },
    ],
  }),
  red_wake: node('red_wake', {
    name: 'Red Wake', type: 'travel', sector: 'ember', fuelCost: 2,
    blurb: 'Ion storm cut. Fast if you trust the plot.',
    outcomes: [
      { w: 40, kind: 'delivery', credits: 280, reputation: 9 },
      { w: 35, kind: 'combat', encounter: 'pirate_ace' },
      { w: 25, kind: 'story', flag: 'red_chart' },
    ],
  }),
  hollow_mouth: node('hollow_mouth', {
    name: 'Hollow Mouth', type: 'story', sector: 'hollow', fuelCost: 3,
    blurb: 'The expanse opens like a throat. Do not echo.',
    outcomes: [
      { w: 55, kind: 'story', flag: 'hollow_opened' },
      { w: 25, kind: 'combat', encounter: 'hollow_shade' },
      { w: 20, kind: 'salvage', credits: 220, medals: 16 },
    ],
  }),
  silent_choir: node('silent_choir', {
    name: 'Silent Choir', type: 'story', sector: 'hollow', fuelCost: 3,
    blurb: 'Stations that sing when you kill the comms.',
    outcomes: [
      { w: 50, kind: 'story', flag: 'choir_note' },
      { w: 30, kind: 'combat', encounter: 'hollow_shade' },
      { w: 20, kind: 'trade', credits: 240, reputation: 10 },
    ],
  }),
  bone_orbit: node('bone_orbit', {
    name: 'Bone Orbit', type: 'salvage', sector: 'hollow', fuelCost: 3,
    blurb: 'A ring of hulls that died holding hands.',
    outcomes: [
      { w: 45, kind: 'salvage', credits: 260, medals: 24 },
      { w: 30, kind: 'combat', encounter: 'veil_wraith' },
      { w: 25, kind: 'salvage', credits: 340, medals: 30 },
    ],
  }),
  dark_well: node('dark_well', {
    name: 'Dark Well', type: 'danger', sector: 'hollow', fuelCost: 3,
    blurb: 'Gravity with opinions. Brood likes the walls.',
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'swarm_brood' },
      { w: 30, kind: 'combat', encounter: 'hollow_shade' },
      { w: 20, kind: 'salvage', credits: 300, medals: 26 },
      { w: 10, kind: 'story', flag: 'well_mark' },
    ],
  }),
  pale_market: node('pale_market', {
    name: 'Pale Market', type: 'trade', sector: 'hollow', fuelCost: 2,
    blurb: 'Vendors wear masks. Prices are fair. Eyes are not.',
    outcomes: [
      { w: 55, kind: 'trade', credits: 320, reputation: 12 },
      { w: 25, kind: 'delivery', credits: 380, reputation: 14 },
      { w: 20, kind: 'combat', encounter: 'hollow_shade' },
    ],
  }),
  echo_tomb: node('echo_tomb', {
    name: 'Echo Tomb', type: 'salvage', sector: 'hollow', fuelCost: 3,
    blurb: 'A crypt that plays back your last jump.',
    outcomes: [
      { w: 40, kind: 'salvage', credits: 280, medals: 28 },
      { w: 35, kind: 'story', flag: 'tomb_name' },
      { w: 25, kind: 'combat', encounter: 'eclipse_echo' },
    ],
  }),
  null_harbor: node('null_harbor', {
    name: 'Null Harbor', type: 'travel', sector: 'hollow', fuelCost: 3,
    blurb: 'Dock that exists if you believe the chart.',
    outcomes: [
      { w: 40, kind: 'trade', credits: 300, reputation: 11 },
      { w: 30, kind: 'story', flag: 'null_berth' },
      { w: 30, kind: 'combat', encounter: 'hollow_shade' },
    ],
  }),
  halo_approach: node('halo_approach', {
    name: 'Halo Approach', type: 'story', sector: 'crown', fuelCost: 3,
    blurb: 'Gold ring. Customs that weigh your reputation like ore.',
    outcomes: [
      { w: 55, kind: 'story', flag: 'crown_opened' },
      { w: 25, kind: 'trade', credits: 360, reputation: 14 },
      { w: 20, kind: 'combat', encounter: 'crown_warden' },
    ],
  }),
  gilt_ring: node('gilt_ring', {
    name: 'Gilt Ring', type: 'trade', sector: 'crown', fuelCost: 3,
    blurb: 'Tourist gold over a war-economy. Tips are medals.',
    outcomes: [
      { w: 60, kind: 'trade', credits: 420, reputation: 14 },
      { w: 25, kind: 'delivery', credits: 500, reputation: 16 },
      { w: 15, kind: 'combat', encounter: 'crown_warden' },
    ],
  }),
  throne_dock: node('throne_dock', {
    name: 'Throne Dock', type: 'story', sector: 'crown', fuelCost: 3,
    blurb: 'Where Halo captains used to take audiences.',
    outcomes: [
      { w: 50, kind: 'story', flag: 'throne_audience' },
      { w: 30, kind: 'trade', credits: 380, reputation: 15 },
      { w: 20, kind: 'combat', encounter: 'crown_warden' },
    ],
  }),
  verdict_yard: node('verdict_yard', {
    name: 'Verdict Yard', type: 'salvage', sector: 'crown', fuelCost: 3,
    blurb: 'Decommissioned judges. Their hulls still pass sentence.',
    outcomes: [
      { w: 45, kind: 'salvage', credits: 360, medals: 32 },
      { w: 30, kind: 'combat', encounter: 'crown_warden' },
      { w: 25, kind: 'salvage', credits: 480, medals: 40 },
    ],
  }),
  eclipse_crown: node('eclipse_crown', {
    name: 'Eclipse Crown', type: 'danger', sector: 'crown', fuelCost: 4,
    blurb: 'The Swarm wearing a halo. End of the mapped war.',
    outcomes: [
      { w: 40, kind: 'combat', encounter: 'eclipse_throne' },
      { w: 30, kind: 'combat', encounter: 'eclipse_echo' },
      { w: 20, kind: 'story', flag: 'crown_scar' },
      { w: 10, kind: 'salvage', credits: 520, medals: 36 },
    ],
  }),
  meridian_gate: node('meridian_gate', {
    name: 'Meridian Gate', type: 'travel', sector: 'crown', fuelCost: 3,
    blurb: 'A door the charts refuse to finish. Apex space beyond.',
    outcomes: [
      { w: 45, kind: 'story', flag: 'meridian_glimpse' },
      { w: 30, kind: 'trade', credits: 400, reputation: 18 },
      { w: 25, kind: 'combat', encounter: 'eclipse_throne' },
    ],
  }),
};

export const GALAXY_BEATS = {
  ember_opened: {
    title: 'Ember Reach Access',
    text: 'Cinder customs wave you through. The air is slag. The pay is heat.',
    chapter: 4, art: 'ember',
    rewards: { credits: 140, reputation: 10, medals: 8 },
  },
  ash_ledger: {
    title: 'Ash Ledger',
    text: 'A burned book still lists corvette ribs as “due.” Someone is pouring hulls in secret.',
    chapter: 4,
    rewards: { credits: 120, reputation: 8, medals: 10 },
  },
  solar_blessing: {
    title: 'Solar Blessing',
    text: 'The forge AI stamps your hull. Destroyer parts stop being mythical.',
    chapter: 5,
    rewards: { credits: 160, reputation: 8, medals: 12 },
  },
  red_chart: {
    title: 'Red Chart',
    text: 'Ion-storm plots name Hollow Mouth as a wound, not a place.',
    chapter: 5,
    rewards: { credits: 110, reputation: 9, medals: 8 },
  },
  hollow_opened: {
    title: 'Hollow Expanse',
    text: 'The mouth closes behind you. Comms go polite. The dark is not empty.',
    chapter: 5, art: 'hollow',
    rewards: { credits: 160, reputation: 12, medals: 10 },
  },
  choir_note: {
    title: 'Choir Note',
    text: 'A station sings your hull ID backward. Nyx would like this. You do not.',
    chapter: 5,
    rewards: { credits: 130, reputation: 11, medals: 10 },
  },
  well_mark: {
    title: 'Well Mark',
    text: 'Dark Well brands a second mark over Night Mark. Swarm probes now hesitate twice.',
    chapter: 6,
    rewards: { credits: 100, reputation: 14, medals: 12 },
  },
  tomb_name: {
    title: 'Tomb Name',
    text: 'The crypt plays back a captain who sounds like you, from a war you have not fought yet.',
    chapter: 6,
    rewards: { credits: 140, reputation: 12, medals: 14 },
  },
  null_berth: {
    title: 'Null Berth',
    text: 'A dock exists because you paid for it. Halo Approach answers the invoice.',
    chapter: 6,
    rewards: { credits: 150, reputation: 12, medals: 8 },
  },
  crown_opened: {
    title: 'Crown Halo',
    text: 'Gold customs weigh your reputation like ore. You pass. The ring notices.',
    chapter: 6, art: 'crown',
    rewards: { credits: 200, reputation: 16, medals: 12 },
  },
  throne_audience: {
    title: 'Throne Audience',
    text: 'An empty chair still issues orders. One of them is your name, misspelled as a threat.',
    chapter: 7,
    rewards: { credits: 180, reputation: 14, medals: 12 },
  },
  crown_scar: {
    title: 'Crown Scar',
    text: 'Eclipse wears a halo and a throne. You live. The war does not end. It just gets a better view.',
    chapter: 8,
    rewards: { credits: 240, reputation: 20, medals: 18, gems: 15 },
  },
  meridian_glimpse: {
    title: 'Meridian Glimpse',
    text: 'Beyond the unfinished gate: a lane that looks back. Apex space. Later.',
    chapter: 8,
    rewards: { credits: 200, reputation: 18, medals: 16, gems: 10 },
  },
};

export function galaxyUnlocked(player, sector) {
  if (sector === 'spur') return true;
  if (sector === 'veil') return Boolean(player.flags?.veil_opened || player.story?.veilUnlocked);
  // Interiors only after the gate visit — forge_gift / ember_map / chapter only reveal the GATE.
  if (sector === 'ember') return Boolean(player.flags?.ember_opened || player.story?.emberUnlocked);
  if (sector === 'hollow') return Boolean(player.flags?.hollow_opened || player.story?.hollowUnlocked);
  if (sector === 'crown') return Boolean(player.flags?.crown_opened || player.story?.crownUnlocked);
  return true;
}
