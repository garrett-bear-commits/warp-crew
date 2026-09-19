/** Starter mercenary definitions for the 30-day slice */

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
  { id: 'merc_rex', name: 'Rex Vale', role: 'pilot', rarity: 'common', species: 'human',
    passive: { fuelCostReduce: 0 }, basePower: 10 },
  { id: 'merc_bolt', name: 'Bolt', role: 'engineer', rarity: 'common', species: 'droid',
    passive: { repairBonus: 0.05 }, basePower: 10 },
  { id: 'merc_kira', name: 'Kira Nyx', role: 'gunner', rarity: 'uncommon', species: 'human',
    passive: { critChance: 0.05 }, basePower: 14 },
  { id: 'merc_syla', name: 'Syla', role: 'trader', rarity: 'uncommon', species: 'alien',
    passive: { tradeCredits: 0.1 }, basePower: 12 },
  { id: 'merc_vorn', name: 'Vorn', role: 'security', rarity: 'rare', species: 'alien',
    passive: { pirateResist: 0.1 }, basePower: 18 },
  { id: 'merc_quill', name: 'Quill', role: 'scout', rarity: 'rare', species: 'alien',
    passive: { expeditionSuccess: 0.08 }, basePower: 16 },
  { id: 'merc_ada', name: 'ADA-7', role: 'medic', rarity: 'epic', species: 'droid',
    passive: { assistCharge: 0.1 }, basePower: 22 },
  { id: 'merc_zephyr', name: 'Zephyr', role: 'pilot', rarity: 'legendary', species: 'alien',
    passive: { fuelCostReduce: 1 }, basePower: 30 },
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
    status: 'ready', // ready | expedition | injured
    injuredUntil: 0,
  };
}

export const MEDAL_LEVEL_COST = (level) => Math.floor(10 * Math.pow(1.35, level - 1));
