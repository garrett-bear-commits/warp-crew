/** Mercenary catalog — Phase C expanded pool for 7–30 day retention */

export const RARITY = {
  common: { id: 'common', rank: 1, label: 'Common', color: '#9aa0a6' },
  uncommon: { id: 'uncommon', rank: 2, label: 'Uncommon', color: '#34a853' },
  rare: { id: 'rare', rank: 3, label: 'Rare', color: '#4285f4' },
  epic: { id: 'epic', rank: 4, label: 'Epic', color: '#a142f4' },
  legendary: { id: 'legendary', rank: 5, label: 'Legendary', color: '#f9ab00' },
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

/** Catalog of hireable templates (gacha pool) */
export const CREW_CATALOG = [
  // Starters / common
  { id: 'merc_rex', name: 'Rex Vale', role: 'pilot', rarity: 'common', species: 'human',
    passive: { fuelCostReduce: 0 }, basePower: 10, blurb: 'Ex-hauler pilot. Steady hands.' },
  { id: 'merc_bolt', name: 'Bolt', role: 'engineer', rarity: 'common', species: 'droid',
    passive: { repairBonus: 0.05 }, basePower: 10, blurb: 'Refurbished yard droid.' },
  { id: 'merc_jen', name: 'Jen Park', role: 'gunner', rarity: 'common', species: 'human',
    passive: { critChance: 0.02 }, basePower: 11, blurb: 'Station security washout.' },
  { id: 'merc_moss', name: 'Moss-3', role: 'medic', rarity: 'common', species: 'droid',
    passive: { assistCharge: 0.03 }, basePower: 10, blurb: 'Clinic chassis, field firmware.' },
  { id: 'merc_plip', name: 'Plip', role: 'trader', rarity: 'common', species: 'alien',
    passive: { tradeCredits: 0.05 }, basePower: 9, blurb: 'Bubble-skinned haggler from Tidefall.' },

  // Uncommon
  { id: 'merc_kira', name: 'Kira Nyx', role: 'gunner', rarity: 'uncommon', species: 'human',
    passive: { critChance: 0.05 }, basePower: 14, blurb: 'Privateer gunner with a short fuse.' },
  { id: 'merc_syla', name: 'Syla', role: 'trader', rarity: 'uncommon', species: 'alien',
    passive: { tradeCredits: 0.1 }, basePower: 12, blurb: 'Crystal-lattice merchant caste.' },
  { id: 'merc_rook', name: 'Rook Halden', role: 'security', rarity: 'uncommon', species: 'human',
    passive: { pirateResist: 0.06 }, basePower: 13, blurb: 'Colony marshal on sabbatical.' },
  { id: 'merc_nemi', name: 'Nemi-Vox', role: 'scout', rarity: 'uncommon', species: 'alien',
    passive: { expeditionSuccess: 0.05 }, basePower: 13, blurb: 'Silicate scout with echolocation.' },
  { id: 'merc_cog', name: 'Cogwheel', role: 'engineer', rarity: 'uncommon', species: 'droid',
    passive: { repairBonus: 0.08 }, basePower: 13, blurb: 'Talkative wrench with opinions.' },

  // Rare
  { id: 'merc_vorn', name: 'Vorn', role: 'security', rarity: 'rare', species: 'alien',
    passive: { pirateResist: 0.1 }, basePower: 18, blurb: 'Four-armed void knight.' },
  { id: 'merc_quill', name: 'Quill', role: 'scout', rarity: 'rare', species: 'alien',
    passive: { expeditionSuccess: 0.08 }, basePower: 16, blurb: 'Feathered tracker from ice rings.' },
  { id: 'merc_isa', name: 'Isa Mender', role: 'medic', rarity: 'rare', species: 'human',
    passive: { assistCharge: 0.08 }, basePower: 17, blurb: 'Combat surgeon, soft smile.' },
  { id: 'merc_drift', name: 'Drift', role: 'pilot', rarity: 'rare', species: 'alien',
    passive: { fuelCostReduce: 0.5 }, basePower: 17, blurb: 'Gas-giant flyer in a borrowed body.' },
  { id: 'merc_hex', name: 'HEX-19', role: 'gunner', rarity: 'rare', species: 'droid',
    passive: { critChance: 0.08 }, basePower: 18, blurb: 'Decommissioned naval turret AI.' },

  // Epic
  { id: 'merc_ada', name: 'ADA-7', role: 'medic', rarity: 'epic', species: 'droid',
    passive: { assistCharge: 0.1 }, basePower: 22, blurb: 'Empathy core + combat drugs.' },
  { id: 'merc_skarn', name: 'Skarn of Glass', role: 'security', rarity: 'epic', species: 'alien',
    passive: { pirateResist: 0.15 }, basePower: 24, blurb: 'Living crystal blade-dancer.' },
  { id: 'merc_lora', name: 'Lora Chen', role: 'trader', rarity: 'epic', species: 'human',
    passive: { tradeCredits: 0.18 }, basePower: 21, blurb: 'Ex-cartel fixer gone legitimate.' },
  { id: 'merc_wisp', name: 'Wisp', role: 'scout', rarity: 'epic', species: 'alien',
    passive: { expeditionSuccess: 0.12 }, basePower: 22, blurb: 'Nearly invisible cloud-being.' },

  // Legendary
  { id: 'merc_zephyr', name: 'Zephyr', role: 'pilot', rarity: 'legendary', species: 'alien',
    passive: { fuelCostReduce: 1 }, basePower: 30, blurb: 'Storm-kin who laughs at fuel gauges.' },
  { id: 'merc_onyx', name: 'Captain Onyx', role: 'gunner', rarity: 'legendary', species: 'human',
    passive: { critChance: 0.12 }, basePower: 32, blurb: 'Retired privateer admiral for hire.' },
  { id: 'merc_prism', name: 'PRISM', role: 'engineer', rarity: 'legendary', species: 'droid',
    passive: { repairBonus: 0.2 }, basePower: 31, blurb: 'Prototype ship-soul interface.' },
];

export function createCrewInstance(templateId, { level = 1 } = {}) {
  const t = CREW_CATALOG.find((c) => c.id === templateId);
  if (!t) throw new Error('Unknown crew template ' + templateId);
  return {
    instanceId: `${templateId}_${Math.random().toString(36).slice(2, 9)}`,
    templateId: t.id,
    name: t.name,
    role: t.role,
    rarity: t.rarity,
    species: t.species,
    passive: { ...t.passive },
    level,
    xp: 0,
    power: t.basePower + (level - 1) * 3,
    status: 'ready',
    injuredUntil: 0,
    blurb: t.blurb || '',
  };
}

export const MEDAL_LEVEL_COST = (level) => Math.floor(10 * Math.pow(1.35, level - 1));
