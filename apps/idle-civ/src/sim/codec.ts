import { defineSave, type SaveCodec } from '@foundation/client';
import { CAMP_CONFIG, CONFIG_VERSION, SAVE_SCHEMA_VERSION } from './config.ts';
import { idleCivEngine, MIGRATIONS, SCHEMA_VERSION } from './engine.ts';
import type { CardId } from './config.ts';
import type { IdleCivState, JobProgress, ResourceId, Workers } from './types.ts';
import { JOB_IDS, TOOL_KINDS } from './types.ts';

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const nonNeg = (v: unknown): number => Math.max(0, num(v));
const nonNegInt = (v: unknown): number => Math.max(0, Math.floor(num(v)));
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const CARD_IDS = Object.keys(CAMP_CONFIG.cards) as CardId[];

function stock(raw: unknown, amount: number, capacity: number): IdleCivState['stocks'][ResourceId] {
  const o = rec(raw);
  return {
    amount: Math.max(0, num(o.amount, amount)),
    capacity: Math.max(1, num(o.capacity, capacity)),
  };
}

function job(raw: unknown): JobProgress {
  const o = rec(raw);
  return {
    revealed: o.revealed === true,
    funded: o.funded === true,
    completed: o.completed === true,
    workDone: nonNeg(o.workDone),
  };
}

function workers(raw: unknown, population: number): Workers {
  const o = rec(raw);
  const w: Workers = {
    laborer: nonNegInt(o.laborer),
    forager: nonNegInt(o.forager),
    woodcutter: nonNegInt(o.woodcutter),
    builder: nonNegInt(o.builder),
    stone_gatherer: nonNegInt(o.stone_gatherer),
  };
  const total = w.laborer + w.forager + w.woodcutter + w.builder + w.stone_gatherer;
  if (total !== population) w.laborer = Math.max(0, population - (total - w.laborer));
  return w;
}

function cards(raw: unknown): CardId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (id): id is CardId => typeof id === 'string' && CARD_IDS.includes(id as CardId),
  );
}

export function normaliseState(raw: unknown): IdleCivState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('state must be an object');
  const o = raw as Record<string, unknown>;
  const base = idleCivEngine.newState({
    now: nonNegInt(o.settledAt),
    seed: 1,
    rng: { next: () => 0, int: () => 0, state: () => 0, restore: () => {} },
  });
  const population = Math.max(1, nonNegInt(o.population || base.population));
  const jobs = { ...base.jobs };
  for (const id of JOB_IDS) jobs[id] = job(rec(o.jobs)[id]);
  const toolCoverage = { ...base.toolCoverage };
  const tools = rec(o.toolCoverage);
  for (const k of TOOL_KINDS) toolCoverage[k] = nonNegInt(tools[k]);
  const stocksRaw = rec(o.stocks);
  const state: IdleCivState = {
    ...base,
    v: SCHEMA_VERSION,
    configVersion: typeof o.configVersion === 'string' ? o.configVersion : CONFIG_VERSION,
    acceptedActions: nonNegInt(o.acceptedActions),
    simMs: nonNegInt(o.simMs),
    settledAt: nonNegInt(o.settledAt),
    stage: o.stage === 'hamlet' ? 'hamlet' : 'camp',
    settlementName: typeof o.settlementName === 'string' ? o.settlementName.slice(0, 24) : null,
    nameSkipped: o.nameSkipped === true,
    population,
    housing: Math.max(population, nonNegInt(o.housing || base.housing)),
    amenities: nonNegInt(o.amenities || base.amenities),
    campfireLevel: o.campfireLevel === 2 ? 2 : 1,
    workbenchLevel: o.workbenchLevel === 1 ? 1 : 0,
    workers: workers(o.workers, population),
    stocks: {
      food: stock(stocksRaw.food, CAMP_CONFIG.starting.food, CAMP_CONFIG.starting.foodCap),
      wood: stock(stocksRaw.wood, CAMP_CONFIG.starting.wood, CAMP_CONFIG.starting.woodCap),
      stone: stock(stocksRaw.stone, CAMP_CONFIG.starting.stone, CAMP_CONFIG.starting.stoneCap),
    },
    stoneRevealed: o.stoneRevealed === true,
    amenitiesRevealed: o.amenitiesRevealed === true,
    kitGranted: o.kitGranted === true,
    kitEquipped: o.kitEquipped === true,
    ownedCards: cards(o.ownedCards),
    equippedCards: cards(o.equippedCards),
    toolCoverage,
    toolSetsCrafted: nonNegInt(o.toolSetsCrafted),
    jobs,
    foodStabilized: o.foodStabilized === true,
    foodRecovered: o.foodRecovered === true,
    firstMigrantArrived: o.firstMigrantArrived === true,
    nextMigrantAtSimMs: typeof o.nextMigrantAtSimMs === 'number' ? o.nextMigrantAtSimMs : null,
    hamletReached: o.hamletReached === true,
    hamletCelebrationDone: o.hamletCelebrationDone === true,
    founderPackGranted: o.founderPackGranted === true,
    founderPackOpened: o.founderPackOpened === true,
    founderCardEquipped: cards([o.founderCardEquipped])[0] ?? null,
    dailySupplyDueAtWallMs:
      typeof o.dailySupplyDueAtWallMs === 'number' ? o.dailySupplyDueAtWallMs : null,
    foodDepletedMs: nonNegInt(o.foodDepletedMs),
    lastRationAtSimMs: typeof o.lastRationAtSimMs === 'number' ? o.lastRationAtSimMs : null,
    returnReport: null,
    returnReportAcked: o.returnReportAcked !== false,
    emittedOnce: Array.isArray(o.emittedOnce)
      ? o.emittedOnce.filter((x): x is string => typeof x === 'string')
      : [],
    telemetry: [],
  };
  return state;
}

export function createIdleCivCodec(): SaveCodec<IdleCivState> {
  return defineSave<IdleCivState>({
    schemaVersion: SAVE_SCHEMA_VERSION,
    migrations: MIGRATIONS,
    decode: normaliseState,
    validate: (s) =>
      Number.isSafeInteger(s.acceptedActions) && s.acceptedActions >= 0 && s.population >= 1,
  });
}

export const idleCivCodec: SaveCodec<IdleCivState> = createIdleCivCodec();
