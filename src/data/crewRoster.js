// @ts-nocheck
/** Mercenary catalog — roster, stars, endless rank, lore. */

export const RARITY = {
  common: { id: 'common', rank: 1, label: 'Common', color: '#9aa0a6' },
  uncommon: { id: 'uncommon', rank: 2, label: 'Uncommon', color: '#34a853' },
  rare: { id: 'rare', rank: 3, label: 'Rare', color: '#4285f4' },
  epic: { id: 'epic', rank: 4, label: 'Epic', color: '#a142f4' },
  legendary: { id: 'legendary', rank: 5, label: 'Legendary', color: '#f9ab00' },
  mythic: { id: 'mythic', rank: 6, label: 'Mythic', color: '#ff6b6b' },
  apex: { id: 'apex', rank: 7, label: 'Apex', color: '#5ce1ff' },
};

export const ROLES = {
  pilot: { id: 'pilot', name: 'Pilot', blurb: 'Navigation, evasion, fuel efficiency' },
  gunner: { id: 'gunner', name: 'Gunner', blurb: 'Weapons DPS and crit' },
  engineer: { id: 'engineer', name: 'Engineer', blurb: 'Repairs, shields, uptime' },
  medic: { id: 'medic', name: 'Medic', blurb: 'Crew sustain and assist recharge' },
  trader: { id: 'trader', name: 'Trader', blurb: 'Credits & reputation on peaceful nodes' },
  scout: { id: 'scout', name: 'Scout', blurb: 'Expedition success and map intel' },
  security: { id: 'security', name: 'Security', blurb: 'Boarding and anti-pirate' },
};

export const RANK_BANDS = [
  'Green', 'Rated', 'Veteran', 'Ace', 'Prime',
  'Apex', 'Paragon', 'Eidolon', 'Mythos', 'Singularity',
];

export const RARITY_MULT = {
  common: 1, uncommon: 1.15, rare: 1.35, epic: 1.6,
  legendary: 2, mythic: 2.55, apex: 3.3,
};

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function rarityMult(rarity) {
  return RARITY_MULT[rarity] || 1;
}

/** Endless career title. Rank 1 Green … 100 Singularity 10, then Green II, forever. */
export function rankTitle(rank = 1) {
  const i = Math.max(0, (Number(rank) || 1) - 1);
  const cycle = Math.floor(i / 100);
  const inner = i % 100;
  const band = RANK_BANDS[Math.min(RANK_BANDS.length - 1, Math.floor(inner / 10))];
  const n = (inner % 10) + 1;
  const suf = cycle ? ` ${ROMAN[Math.min(cycle, ROMAN.length - 1)] || cycle + 1}` : '';
  return n === 1 ? `${band}${suf}` : `${band}${suf} ${n}`;
}

export function rankUpCost(crew) {
  const r = Math.max(1, crew?.rank || 1);
  const m = rarityMult(crew?.rarity);
  return {
    medals: Math.max(4, Math.floor(6 * Math.pow(1.21, r - 1) * m)),
    credits: Math.max(24, Math.floor(28 * Math.pow(1.15, r - 1) * m)),
  };
}

export function crewPowerOf(template, { level = 1, stars = 1, rank = 1 } = {}) {
  const base = template?.basePower || 10;
  return Math.round(base + (level - 1) * 3 + (stars - 1) * base * 0.12 + (rank - 1) * 2);
}

export function scaledPassive(passive, stars = 1) {
  const m = 1 + Math.max(0, (stars || 1) - 1) * 0.1;
  const out = {};
  for (const [k, v] of Object.entries(passive || {})) out[k] = +(v * m).toFixed(4);
  return out;
}

function m(id, name, role, rarity, species, extra) {
  return {
    id,
    name,
    role,
    rarity,
    species,
    faction: extra.faction || 'freelance',
    origin: extra.origin || 'The Spur',
    basePower: extra.basePower,
    passive: extra.passive || {},
    hireCost: extra.hireCost ?? null,
    quote: extra.quote || '',
    history: extra.history || extra.blurb || '',
    blurb: extra.blurb || '',
  };
}

export const CREW_CATALOG = [
  m('merc_rex', 'Rex Vale', 'pilot', 'common', 'human', {
    faction: 'haulers', origin: 'Spur Anchor', basePower: 10, hireCost: { credits: 180 },
    passive: { fuelCostReduce: 0 },
    blurb: 'Ex-hauler pilot. Steady hands.',
    quote: 'Lane’s dirty. Hands aren’t.',
    history: 'Rex flew meal-packs for a Spur co-op until a Swarm probe tagged his convoy. He kept the Sparrow airborne and never went back to scheduled runs.',
  }),
  m('merc_bolt', 'Bolt', 'engineer', 'common', 'droid', {
    faction: 'yard', origin: 'Null Scrapyard', basePower: 10, hireCost: { credits: 180 },
    passive: { repairBonus: 0.05 },
    blurb: 'Refurbished yard droid.',
    quote: 'If it rattles, I named it.',
    history: 'A scrap-yard chassis with three owners and one personality core that refuses a factory reset. Bolts talk while they weld. The welds hold.',
  }),
  m('merc_jen', 'Jen Park', 'gunner', 'common', 'human', {
    faction: 'station', origin: 'Spur Anchor', basePower: 11, hireCost: { credits: 200 },
    passive: { critChance: 0.02 },
    blurb: 'Station security washout.',
    quote: 'Aim first. Report never.',
    history: 'Jen washed out of Spur security for firing on a “friendly” cutter that turned pirate mid-dock. The station still pretends she quit.',
  }),
  m('merc_moss', 'Moss-3', 'medic', 'common', 'droid', {
    faction: 'clinic', origin: "Hope's Rest", basePower: 10, hireCost: { credits: 180 },
    passive: { assistCharge: 0.03 },
    blurb: 'Clinic chassis, field firmware.',
    quote: 'Hold still. Pain is data.',
    history: 'A colony clinic sold Moss for fuel during a Swarm scare. The firmware still greets patients. The patients are usually pirates now.',
  }),
  m('merc_plip', 'Plip', 'trader', 'common', 'alien', {
    faction: 'tidefall', origin: 'Tidefall Docks', basePower: 9, hireCost: { credits: 160 },
    passive: { tradeCredits: 0.05 },
    blurb: 'Bubble-skinned haggler from Tidefall.',
    quote: 'Price is a feeling. I have more feelings.',
    history: 'Plip left the wet markets after a cartel tried to “license” their gills. They still price fish by rumor and hull-ribs the same way.',
  }),
  m('merc_tess', 'Tess Vale', 'pilot', 'common', 'human', {
    faction: 'haulers', origin: 'Convoy Spine', basePower: 10, hireCost: { credits: 190 },
    passive: { fuelCostReduce: 0.15 },
    blurb: 'Rex’s cousin. Faster, poorer.',
    quote: 'If the lane’s on fire, that’s a shortcut.',
    history: 'Tess ran courier hops until a Glass Spur ice-lock ate her first ship. She still flies like someone owes the ice money.',
  }),
  m('merc_dax', 'Dax Rime', 'gunner', 'common', 'human', {
    faction: 'privateers', origin: 'Broken Belt', basePower: 11, hireCost: { credits: 190 },
    passive: { critChance: 0.025 },
    blurb: 'Belt kid with a borrowed turret.',
    quote: 'Count the flashes. That’s inventory.',
    history: 'Grew up in the Belt tagging scrap with a jury-rigged pintle. Hired himself out the day he hit a pirate engine on the first burst.',
  }),
  m('merc_nub', 'NUB-4', 'engineer', 'common', 'droid', {
    faction: 'yard', origin: 'Forge Moon', basePower: 10, hireCost: { credits: 170 },
    passive: { repairBonus: 0.04 },
    blurb: 'Four-armed yard helper. Two of them work.',
    quote: 'Specify which arm is sorry.',
    history: 'Forge Moon surplus. Two arms weld, one holds coffee, one argues with Bolt about torque specs.',
  }),
  m('merc_pip', 'Pip Hollow', 'trader', 'common', 'human', {
    faction: 'market', origin: 'Kestrel Market', basePower: 9, hireCost: { credits: 170 },
    passive: { tradeCredits: 0.04 },
    blurb: 'Pocket merchant. Always has a spare crate.',
    quote: 'Everything is marked down if you wait.',
    history: 'Pip sold counterfeit Veil stamps until customs laughed. Now they sell honest crates and dishonest stories, which pays almost as well.',
  }),
  m('merc_juno', 'Juno Kett', 'scout', 'common', 'human', {
    faction: 'survey', origin: 'Dust Lane', basePower: 10, hireCost: { credits: 180 },
    passive: { expeditionSuccess: 0.03 },
    blurb: 'Map-rat. Sleeps in vents.',
    quote: 'If it isn’t on the chart, that’s the job.',
    history: 'Juno walked Dust Lane in a vac-suit for a survey grant that never paid. She kept the maps. The grant office kept the silence.',
  }),
  m('merc_greaves', 'Greaves', 'security', 'common', 'human', {
    faction: 'colony', origin: "Hope's Rest", basePower: 11, hireCost: { credits: 190 },
    passive: { pirateResist: 0.04 },
    blurb: 'Colony door-guard on a long break.',
    quote: 'Nobody rushes a door I like.',
    history: 'Held Hope’s Rest clinic doors through two Swarm pings. Took mercenary work when the colony could only pay in thanks.',
  }),

  m('merc_kira', 'Kira Nyx', 'gunner', 'uncommon', 'human', {
    faction: 'privateers', origin: 'Corsair Nest', basePower: 14, hireCost: { credits: 520 },
    passive: { critChance: 0.05 },
    blurb: 'Privateer gunner with a short fuse.',
    quote: 'Short fuse. Long burst.',
    history: 'Kira left a corsair wing after they started tagging colony boats. She still paints her turrets like a warning.',
  }),
  m('merc_syla', 'Syla', 'trader', 'uncommon', 'alien', {
    faction: 'crystal', origin: 'Echo Reef', basePower: 12, hireCost: { credits: 540 },
    passive: { tradeCredits: 0.1 },
    blurb: 'Crystal-lattice merchant caste.',
    quote: 'Resonance is just another ledger.',
    history: 'Syla’s caste prices in harmonics. She took a hull berth when the Reef started singing Swarm instead of trade.',
  }),
  m('merc_rook', 'Rook Halden', 'security', 'uncommon', 'human', {
    faction: 'colony', origin: "Hope's Rest", basePower: 13, hireCost: { credits: 500 },
    passive: { pirateResist: 0.06 },
    blurb: 'Colony marshal on sabbatical.',
    quote: 'Badge is optional. The stare isn’t.',
    history: 'Rook marshaled Hope’s Rest until the council asked him to smile more. He took a sabbatical that looks a lot like boarding actions.',
  }),
  m('merc_nemi', 'Nemi-Vox', 'scout', 'uncommon', 'alien', {
    faction: 'silicate', origin: 'Relic Field', basePower: 13, hireCost: { credits: 520 },
    passive: { expeditionSuccess: 0.05 },
    blurb: 'Silicate scout with echolocation.',
    quote: 'I hear the empty places first.',
    history: 'Nemi maps by clicking. Pre-collapse ruins answer in a dialect only they still like. Crew wear earplugs. Nemi does not.',
  }),
  m('merc_cog', 'Cogwheel', 'engineer', 'uncommon', 'droid', {
    faction: 'yard', origin: 'Amber Port', basePower: 13, hireCost: { credits: 500 },
    passive: { repairBonus: 0.08 },
    blurb: 'Talkative wrench with opinions.',
    quote: 'That’s not a rattle. That’s a thesis.',
    history: 'Cogwheel unionized a resin mine’s loader droids, won, then got bored. Mercenary hulls have more interesting failures.',
  }),
  m('merc_yara', 'Yara Quell', 'medic', 'uncommon', 'human', {
    faction: 'clinic', origin: 'Veil Haven', basePower: 13, hireCost: { credits: 530 },
    passive: { assistCharge: 0.05 },
    blurb: 'Haven medic who hates waiting rooms.',
    quote: 'If they’re still talking, we have time.',
    history: 'Yara ran Veil Haven’s night shift until a wraith tagged the pad. She treats boarding wounds the way she treated refugees: fast, quiet, billed later.',
  }),
  m('merc_brink', 'Brink', 'scout', 'uncommon', 'human', {
    faction: 'survey', origin: 'Signal Array', basePower: 13, hireCost: { credits: 510 },
    passive: { expeditionSuccess: 0.055 },
    blurb: 'Listens to dead arrays for fun.',
    quote: 'Static has a plot if you wait.',
    history: 'Brink camped the abandoned Signal Array for a season and came back with Swarm vectors and a cough. The cough went. The vectors didn’t.',
  }),
  m('merc_oso', 'Oso Brack', 'security', 'uncommon', 'human', {
    faction: 'privateers', origin: 'Widow Reef', basePower: 14, hireCost: { credits: 540 },
    passive: { pirateResist: 0.07 },
    blurb: 'Reef bouncer. Soft voice, hard elbows.',
    quote: 'We can do this the quiet way. I prefer quiet.',
    history: 'Oso kept Widow Reef’s drinking hall from becoming a war. When the Swarm took the captain, Oso took a contract instead of a vendetta. Mostly.',
  }),
  m('merc_orla', 'Orla Finch', 'medic', 'uncommon', 'human', {
    faction: 'convoy', origin: 'Glass Spur', basePower: 12, hireCost: { credits: 500 },
    passive: { assistCharge: 0.045 },
    blurb: 'Ice-lane surgeon. Hates drama, loves sutures.',
    quote: 'Save the speech. Pass the clamp.',
    history: 'Orla stitched convoy crews through Glass Spur winters. She signed with mercenaries because they get shot on a schedule she can bill.',
  }),
  m('merc_tink', 'Tink', 'engineer', 'uncommon', 'droid', {
    faction: 'yard', origin: 'Ember Yard', basePower: 13, hireCost: { credits: 510 },
    passive: { repairBonus: 0.07 },
    blurb: 'Ember-yard spark. Smells like ozone.',
    quote: 'Fire is just enthusiastic maintenance.',
    history: 'Tink was left on a burned gantry when Ember Yard died. They restarted the forge for fun. The fun is now your hull.',
  }),

  m('merc_vorn', 'Vorn', 'security', 'rare', 'alien', {
    faction: 'void-knights', origin: 'Night Well', basePower: 18, hireCost: { credits: 1600 },
    passive: { pirateResist: 0.1 },
    blurb: 'Four-armed void knight.',
    quote: 'Four arms. One oath.',
    history: 'Vorn’s order patrols gravity wells. He took mercenary coin after Night Well started dumping Swarm instead of sinners.',
  }),
  m('merc_quill', 'Quill', 'scout', 'rare', 'alien', {
    faction: 'rings', origin: 'Aurora Station', basePower: 16, hireCost: { credits: 1550 },
    passive: { expeditionSuccess: 0.08 },
    blurb: 'Feathered tracker from ice rings.',
    quote: 'The cold writes. I read.',
    history: 'Quill molts once a year and maps twice. Ice-ring clans hire them to find lost convoys. Mercenaries hire them to find worse.',
  }),
  m('merc_isa', 'Isa Mender', 'medic', 'rare', 'human', {
    faction: 'clinic', origin: 'Haven Dock', basePower: 17, hireCost: { credits: 1700 },
    passive: { assistCharge: 0.08 },
    blurb: 'Combat surgeon, soft smile.',
    quote: 'I can put you back. I cannot put you kind.',
    history: 'Isa left a navy hospital when triage became politics. Her smile is real. Her knives are faster.',
  }),
  m('merc_drift', 'Drift', 'pilot', 'rare', 'alien', {
    faction: 'gas-giant', origin: 'Twin Suns', basePower: 17, hireCost: { credits: 1650 },
    passive: { fuelCostReduce: 0.5 },
    blurb: 'Gas-giant flyer in a borrowed body.',
    quote: 'Fuel is a rumor I ignore.',
    history: 'Drift is a storm-mind riding a rented humanoid. The body needs air. The mind does not need fuel gauges.',
  }),
  m('merc_hex', 'HEX-19', 'gunner', 'rare', 'droid', {
    faction: 'navy', origin: 'Black Canal', basePower: 18, hireCost: { credits: 1750 },
    passive: { critChance: 0.08 },
    blurb: 'Decommissioned naval turret AI.',
    quote: 'Target lock is a love language.',
    history: 'HEX-19 was stripped from a navy corvette and sold as scrap. The targeting kernel never received the decommission order.',
  }),
  m('merc_kal', 'Kal Vesper', 'pilot', 'rare', 'human', {
    faction: 'navy', origin: 'Veil Gate', basePower: 17, hireCost: { credits: 1680 },
    passive: { fuelCostReduce: 0.4 },
    blurb: 'Ex-customs cutter ace.',
    quote: 'I used to stamp hulls. Now I outrun them.',
    history: 'Kal flew Veil Gate customs until a bribe chain reached her commander. She kept the flight hours and lost the uniform.',
  }),
  m('merc_vex', 'Vex', 'gunner', 'rare', 'alien', {
    faction: 'crystal', origin: 'Echo Reef', basePower: 18, hireCost: { credits: 1720 },
    passive: { critChance: 0.09 },
    blurb: 'Reef sharpshooter. Hums when aiming.',
    quote: 'The note lands. Then the round.',
    history: 'Vex learned to shoot by matching crystal harmonics to muzzle rise. Crew find it eerie. Enemies find it brief.',
  }),
  m('merc_moth', 'Moth Vale', 'trader', 'rare', 'human', {
    faction: 'cartel', origin: 'Aurora Station', basePower: 16, hireCost: { credits: 1580 },
    passive: { tradeCredits: 0.14 },
    blurb: 'Black-market tourist. White-market invoices.',
    quote: 'If they can tax it, I already sold it.',
    history: 'Moth ran Aurora’s underbelly tours for rich visitors, then started selling the visitors’ secrets back to them. Reputation is a product.',
  }),
  m('merc_reed', 'Reed-7', 'scout', 'rare', 'droid', {
    faction: 'survey', origin: 'Relic Field', basePower: 16, hireCost: { credits: 1600 },
    passive: { expeditionSuccess: 0.085 },
    blurb: 'Slim probe-body with a poet core.',
    quote: 'Ruin is just a floor plan with feelings.',
    history: 'Reed-7 was built to catalog pre-collapse sites. The poet core was a bug. The bug writes better after-action reports than most captains.',
  }),

  m('merc_ada', 'ADA-7', 'medic', 'epic', 'droid', {
    faction: 'clinic', origin: 'Ledger Moon', basePower: 22, hireCost: { credits: 4800 },
    passive: { assistCharge: 0.1 },
    blurb: 'Empathy core + combat drugs.',
    quote: 'I feel it so you don’t have to.',
    history: 'ADA-7’s empathy core was meant for hospice. Someone loaded combat stims. She is very sorry, and very effective.',
  }),
  m('merc_skarn', 'Skarn of Glass', 'security', 'epic', 'alien', {
    faction: 'crystal', origin: 'Glass Spur', basePower: 24, hireCost: { credits: 5200 },
    passive: { pirateResist: 0.15 },
    blurb: 'Living crystal blade-dancer.',
    quote: 'I do not cut. I cleave along the grain.',
    history: 'Skarn is a walking lattice that took a mercenary name so humans would stop calling it a mineral claim. Pirates still try. Briefly.',
  }),
  m('merc_lora', 'Lora Chen', 'trader', 'epic', 'human', {
    faction: 'cartel', origin: 'Black Canal', basePower: 21, hireCost: { credits: 4600 },
    passive: { tradeCredits: 0.18 },
    blurb: 'Ex-cartel fixer gone legitimate.',
    quote: 'Legitimate is a receipt with better lighting.',
    history: 'Lora ran Canal books until the Swarm made the ledgers scream. She went “clean.” The contacts did not.',
  }),
  m('merc_wisp', 'Wisp', 'scout', 'epic', 'alien', {
    faction: 'cloud', origin: 'Veil Garden', basePower: 22, hireCost: { credits: 5000 },
    passive: { expeditionSuccess: 0.12 },
    blurb: 'Nearly invisible cloud-being.',
    quote: 'I was already in the room.',
    history: 'Wisp condenses enough to hold a rifle and a name. The rest of the time they are weather with opinions.',
  }),
  m('merc_rune', 'Rune Calder', 'engineer', 'epic', 'human', {
    faction: 'forge', origin: 'Forge Moon', basePower: 23, hireCost: { credits: 5100 },
    passive: { repairBonus: 0.14 },
    blurb: 'Forge-moon hullwright. Speaks in gauges.',
    quote: 'If the rib sings, we keep it. If it screams, we keep it quieter.',
    history: 'Rune poured corvette ribs until the moon’s AI decided the war was still on. She took the last good schematic and walked.',
  }),
  m('merc_ashen', 'Ashen Kade', 'security', 'epic', 'human', {
    faction: 'navy', origin: 'Ash Corridor', basePower: 24, hireCost: { credits: 5300 },
    passive: { pirateResist: 0.16 },
    blurb: 'Burned marine. Still standing.',
    quote: 'I already survived the interesting part.',
    history: 'Ashen walked out of Ash Corridor with half a platoon and a Swarm brand. Navy called it a loss. Ashen called it a start.',
  }),
  m('merc_nyx', 'Nyx Hollow', 'scout', 'epic', 'alien', {
    faction: 'hollow', origin: 'Hollow Expanse', basePower: 22, hireCost: { credits: 5000 },
    passive: { expeditionSuccess: 0.13 },
    blurb: 'Maps places that do not stay mapped.',
    quote: 'The hallway moved. I moved first.',
    history: 'Nyx is from a stretch of space that rearranges when you blink. They hire out as a scout because blinking is a skill.',
  }),
  m('merc_coil', 'COIL', 'engineer', 'epic', 'droid', {
    faction: 'navy', origin: 'Hush Yard', basePower: 23, hireCost: { credits: 4900 },
    passive: { repairBonus: 0.15 },
    blurb: 'Silent drydock mind. Hates silence now.',
    quote: 'I kept the yard alive. The yard did not thank me.',
    history: 'COIL ran Hush Yard in the dark. When things started moving in the unlit bays, COIL hired a crew with guns and feelings.',
  }),

  m('merc_zephyr', 'Zephyr', 'pilot', 'legendary', 'alien', {
    faction: 'storm-kin', origin: 'Twin Suns', basePower: 30, hireCost: { credits: 12000 },
    passive: { fuelCostReduce: 1 },
    blurb: 'Storm-kin who laughs at fuel gauges.',
    quote: 'Gauges are for people who doubt wind.',
    history: 'Zephyr is a living front. They dock as a courtesy. Fuel companies would like a word. Zephyr would like a storm.',
  }),
  m('merc_onyx', 'Captain Onyx', 'gunner', 'legendary', 'human', {
    faction: 'privateers', origin: 'Widow Reef', basePower: 32, hireCost: { credits: 14000 },
    passive: { critChance: 0.12 },
    blurb: 'Retired privateer admiral for hire.',
    quote: 'I already won the war they remember. This is the sequel.',
    history: 'Onyx hung up a painted fleet after the last corsair compact broke. Retirement lasted six weeks. The guns lasted longer.',
  }),
  m('merc_prism', 'PRISM', 'engineer', 'legendary', 'droid', {
    faction: 'prototype', origin: 'Ledger Vault', basePower: 31, hireCost: { credits: 13000 },
    passive: { repairBonus: 0.2 },
    blurb: 'Prototype ship-soul interface.',
    quote: 'I am the hull when you let me be.',
    history: 'PRISM was built to be a ship, then poured into a walking frame after the vault flooded. They still flinch at drydock lights.',
  }),
  m('merc_solace', 'Solace', 'medic', 'legendary', 'human', {
    faction: 'haven', origin: 'Veil Haven', basePower: 30, hireCost: { credits: 12500 },
    passive: { assistCharge: 0.14 },
    blurb: 'The medic other medics call.',
    quote: 'I do not promise gentle. I promise later.',
    history: 'Solace ran Haven’s last open clinic through a wraith year. Crew who ship with her stop dying of stupid. They still die of Swarm. She bills that to the universe.',
  }),
  m('merc_harrow', 'Harrow', 'pilot', 'legendary', 'human', {
    faction: 'navy', origin: 'Swarm Scar', basePower: 31, hireCost: { credits: 13500 },
    passive: { fuelCostReduce: 0.85 },
    blurb: 'Scar ace. One eye, no wasted burns.',
    quote: 'I already saw the worst angle. This is a better one.',
    history: 'Harrow flew the Scar when Eclipse first bit. The eyepatch is a souvenir. The flight logs are a warning. He still takes the stick.',
  }),

  m('merc_eclipse', 'Eclipse', 'gunner', 'mythic', 'alien', {
    faction: 'defector', origin: 'Husk Nursery', basePower: 40, hireCost: null,
    passive: { critChance: 0.16 },
    blurb: 'Swarm gun-form that chose a name.',
    quote: 'I remember being the hunt. I prefer this.',
    history: 'Eclipse walked out of a nursery with a human throat and a chitin spine. The Swarm still pings. Eclipse pings back with guns.',
  }),
  m('merc_archon', 'ARCHON', 'engineer', 'mythic', 'droid', {
    faction: 'prototype', origin: 'Crown Halo', basePower: 42, hireCost: null,
    passive: { repairBonus: 0.26 },
    blurb: 'Halo-forge mind in gold glass.',
    quote: 'Your hull is a sentence. I am editing.',
    history: 'ARCHON was a Crown dockyard intellect. When the Halo sealed, it poured itself into a prism body and went looking for a smaller war it could finish.',
  }),

  m('merc_voidwake', 'Voidwake', 'pilot', 'apex', 'alien', {
    faction: 'void', origin: 'Null Meridian', basePower: 52, hireCost: null,
    passive: { fuelCostReduce: 1.4 },
    blurb: 'The lane that learned to sit in a chair.',
    quote: 'Distance is a courtesy I can revoke.',
    history: 'Voidwake is what navigators mean when they say a jump “looked back.” It wears a face so crews will talk to it. Fuel is optional. Manners are not.',
  }),
];

export function catalogById(id) {
  return CREW_CATALOG.find((c) => c.id === id) || null;
}

export function createCrewInstance(templateId, { level = 1, stars = 1, rank = 1, instanceId = null, rng = Math.random } = {}) {
  const t = catalogById(templateId);
  if (!t) throw new Error('Unknown crew template ' + templateId);
  const st = Math.max(1, stars | 0);
  const rk = Math.max(1, rank | 0);
  const lv = Math.max(1, level | 0);
  return {
    instanceId: instanceId || `${templateId}_${rng().toString(36).slice(2, 9)}`,
    templateId: t.id,
    name: t.name,
    role: t.role,
    rarity: t.rarity,
    species: t.species,
    faction: t.faction,
    origin: t.origin,
    quote: t.quote,
    history: t.history,
    passive: scaledPassive(t.passive, st),
    level: lv,
    stars: st,
    rank: rk,
    copies: 1,
    xp: 0,
    power: crewPowerOf(t, { level: lv, stars: st, rank: rk }),
    status: 'ready',
    injuredUntil: 0,
    blurb: t.blurb || '',
  };
}

export function recomputeCrew(c) {
  const t = catalogById(c.templateId);
  if (!t) return c;
  const stars = Math.max(1, c.stars || 1);
  const rank = Math.max(1, c.rank || 1);
  const level = Math.max(1, c.level || 1);
  return {
    ...c,
    name: t.name,
    role: t.role,
    rarity: t.rarity,
    species: t.species,
    faction: t.faction || c.faction,
    origin: t.origin || c.origin,
    quote: t.quote || c.quote,
    history: t.history || c.history,
    blurb: t.blurb || c.blurb,
    passive: scaledPassive(t.passive, stars),
    power: crewPowerOf(t, { level, stars, rank }),
    stars,
    rank,
    level,
  };
}

export const MEDAL_LEVEL_COST = (level) => Math.floor(10 * Math.pow(1.35, level - 1));

export function medalLevelCostFor(crew) {
  const base = MEDAL_LEVEL_COST(crew?.level || 1);
  const xp = crew?.xp || 0;
  const rarity = rarityMult(crew?.rarity);
  const cut = Math.min(Math.floor(base * 0.4), Math.floor(xp / 12));
  return Math.max(1, Math.floor((base - cut) * (0.85 + rarity * 0.15)));
}
