// Versioned Camp → Hamlet slice of economy-smoke-v0.2.0. UI and sim load this; they do not
// hard-code balance. Later stages stay in the design config and are not simulated here.
export const CONFIG_VERSION = 'economy-smoke-v0.2.0';
export const SAVE_SCHEMA_VERSION = 1;
export const TELEMETRY_VERSION = 1;
export const TPS = 1;

export const CAMP_CONFIG = {
  version: CONFIG_VERSION,
  foodConsumptionPerPopulationPerMinute: 0.6,
  healthFactors: {
    healthy: 1,
    oneToTwoHourReserve: 1,
    underOneHourReserve: 0.75,
    foodDepleted: 0.65,
  },
  toolFactors: { improvised: 0.7, stone: 1 },
  ratesPerWorkerMinute: {
    foragerFood: 0.95,
    wood: 1.5,
    stone: 1.25,
    builderWork: 60,
  },
  cardCeiling: 1.25,
  builderCap: 1,
  starting: {
    population: 5,
    housing: 5,
    amenities: 5,
    campfireLevel: 1 as const,
    food: 300,
    foodCap: 480,
    wood: 60,
    woodCap: 180,
    stone: 0,
    stoneCap: 120,
  },
  hamletCaps: { food: 900, wood: 600, stone: 600, amenities: 12 },
  jobs: {
    hut: { costs: { wood: 36 }, work: 2, housingAdd: 2 },
    campfire2: { costs: { wood: 16 }, work: 2, amenitiesTo: 8 },
    workbench1: { costs: { wood: 10, stone: 4 }, work: 2 },
  },
  toolCraft: { costs: { wood: 3, stone: 3 } },
  firstMigrantDelayMs: 20 * 1000,
  laterMigrantIntervalMs: 12 * 60 * 1000,
  slowedAmenityThreshold: 0.85,
  slowedMultiplier: 0.5,
  offlineBaseMs: 6 * 3600 * 1000,
  offlineMaxMs: 12 * 3600 * 1000,
  emergencyRation: {
    triggerMs: 20 * 60 * 1000,
    reserveMinutes: 120,
    cooldownMs: 24 * 3600 * 1000,
  },
  cards: {
    woven_baskets: {
      professionId: 'forager' as const,
      modifier: 1.25,
      source: 'starter' as const,
      label: 'Woven Baskets',
    },
    foresters_kit: {
      professionId: 'woodcutter' as const,
      modifier: 1.08,
      source: 'founder' as const,
      label: "Forester's Kit",
    },
    masonry_tools: {
      professionId: 'stone_gatherer' as const,
      modifier: 1.08,
      source: 'founder' as const,
      label: 'Masonry Tools',
    },
    builders_level: {
      professionId: 'builder' as const,
      modifier: 1.08,
      source: 'founder' as const,
      label: "Builder's Level",
    },
  },
  founderPackCardIds: ['foresters_kit', 'masonry_tools', 'builders_level'] as const,
  dailySupplyMs: 22 * 3600 * 1000,
  nameMaxLen: 24,
};

export type CampConfig = typeof CAMP_CONFIG;
export type CardId = keyof typeof CAMP_CONFIG.cards;
export type JobId = keyof typeof CAMP_CONFIG.jobs;
