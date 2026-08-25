import { CAMP_CONFIG, type JobId } from './config.ts';
import type {
  IdleCivState,
  ProfessionId,
  ResourceId,
  ReturnReport,
  ToolKind,
  Workers,
} from './types.ts';
import { JOB_IDS, RESOURCES } from './types.ts';

const cfg = CAMP_CONFIG;

export interface Rates {
  foodProd: number;
  foodConsume: number;
  foodNet: number;
  woodNet: number;
  stoneNet: number;
  workPerMinute: number;
  reserveMinutes: number;
  healthFactor: number;
  amenityCoverage: number;
  housingVacancy: number;
  healthy: boolean;
}

export function workerTotal(w: Workers): number {
  return w.laborer + w.forager + w.woodcutter + w.builder + w.stone_gatherer;
}

export function cardModifier(state: IdleCivState, profession: ProfessionId): number {
  if (profession === 'laborer') return 1;
  let m = 1;
  for (const id of state.equippedCards) {
    const card = cfg.cards[id];
    if (card.professionId === profession) m *= card.modifier;
  }
  return Math.min(cfg.cardCeiling, m);
}

export function toolFactor(coverage: number, workers: number): number {
  if (workers <= 0) return 1;
  const tooled = Math.min(workers, coverage);
  const improvised = workers - tooled;
  return (tooled * cfg.toolFactors.stone + improvised * cfg.toolFactors.improvised) / workers;
}

export function computeRates(state: IdleCivState): Rates {
  const consume = state.population * cfg.foodConsumptionPerPopulationPerMinute;
  const reserveMinutes = consume > 0 ? state.stocks.food.amount / consume : Infinity;
  let healthFactor = cfg.healthFactors.healthy;
  if (state.stocks.food.amount <= 0) healthFactor = cfg.healthFactors.foodDepleted;
  else if (reserveMinutes < 60) healthFactor = cfg.healthFactors.underOneHourReserve;
  else if (reserveMinutes < 120) healthFactor = cfg.healthFactors.oneToTwoHourReserve;

  const foragers = state.workers.forager;
  const foodProd =
    foragers *
    cfg.ratesPerWorkerMinute.foragerFood *
    toolFactor(state.toolCoverage.forager, foragers) *
    cardModifier(state, 'forager') *
    healthFactor;
  const woodNet =
    state.workers.woodcutter *
    cfg.ratesPerWorkerMinute.wood *
    toolFactor(state.toolCoverage.woodcutter, state.workers.woodcutter) *
    cardModifier(state, 'woodcutter') *
    healthFactor;
  const stoneNet =
    state.stoneRevealed && state.workers.stone_gatherer > 0
      ? state.workers.stone_gatherer *
        cfg.ratesPerWorkerMinute.stone *
        toolFactor(0, state.workers.stone_gatherer) *
        cardModifier(state, 'stone_gatherer') *
        healthFactor
      : 0;
  const workPerMinute =
    state.workers.builder *
    cfg.ratesPerWorkerMinute.builderWork *
    toolFactor(state.toolCoverage.builder, state.workers.builder) *
    cardModifier(state, 'builder') *
    healthFactor;
  const amenityCoverage = state.population > 0 ? state.amenities / state.population : 1;
  const housingVacancy = state.housing - state.population;
  const foodNet = foodProd - consume;
  const healthy =
    state.stocks.food.amount > 0 && foodNet >= 0 && amenityCoverage >= 1 && housingVacancy > 0;
  return {
    foodProd,
    foodConsume: consume,
    foodNet,
    woodNet,
    stoneNet,
    workPerMinute,
    reserveMinutes,
    healthFactor,
    amenityCoverage,
    housingVacancy,
    healthy,
  };
}

export function addResource(state: IdleCivState, id: ResourceId, amount: number): number {
  if (!amount) return 0;
  const stock = state.stocks[id];
  const before = stock.amount;
  stock.amount = Math.max(0, Math.min(stock.capacity, before + amount));
  return stock.amount - before;
}

export function canPay(state: IdleCivState, costs: Partial<Record<ResourceId, number>>): boolean {
  return RESOURCES.every((id) => (state.stocks[id].amount ?? 0) >= (costs[id] ?? 0));
}

export function pay(state: IdleCivState, costs: Partial<Record<ResourceId, number>>): void {
  for (const id of RESOURCES) {
    const n = costs[id] ?? 0;
    if (n) state.stocks[id].amount -= n;
  }
}

export function activeJob(state: IdleCivState): JobId | null {
  for (const id of JOB_IDS) {
    const j = state.jobs[id];
    if (j.funded && !j.completed) return id;
  }
  return null;
}

export function jobEtaSec(state: IdleCivState, jobId: JobId): number | null {
  const job = state.jobs[jobId];
  if (!job.funded || job.completed) return null;
  const rates = computeRates(state);
  const remaining = Math.max(0, cfg.jobs[jobId].work - job.workDone);
  if (rates.workPerMinute <= 0) return Number.POSITIVE_INFINITY;
  return (remaining / rates.workPerMinute) * 60;
}

export function nextBottleneck(state: IdleCivState): string {
  const rates = computeRates(state);
  if (!state.foodStabilized) return 'Assign Foragers until Food is stable.';
  if (!state.kitEquipped && state.kitGranted) return 'Equip the Woven Baskets Work Kit.';
  if (!state.jobs.hut.completed) {
    if (!state.jobs.hut.funded) return 'Gather Wood and fund the Hut.';
    if (state.workers.builder === 0) return 'Assign a Builder to the Hut.';
    return 'Wait for the Hut to finish.';
  }
  if (!state.firstMigrantArrived) return 'Keep a housing vacancy open for the first arrival.';
  if (!state.jobs.campfire2.completed) return 'Upgrade the Campfire.';
  if (!state.jobs.workbench1.completed) return 'Gather Loose Stone and build the Workbench.';
  if (state.toolSetsCrafted < 1) return 'Craft a tool set at the Workbench.';
  if (!state.hamletReached) return 'The camp is ready to become a Hamlet.';
  if (!state.founderPackOpened) return 'Open the Founder’s Pack when you are ready.';
  if (!state.founderCardEquipped) return 'Equip a Founder’s Pack card.';
  if (rates.foodNet < 0) return 'Recover Food.';
  return 'The next Daily Supply Pack is on its way.';
}

export function buildReturnReport(
  before: IdleCivState,
  after: IdleCivState,
  awayMs: number,
  creditedMs: number,
  frozenMs: number,
): ReturnReport {
  const completedJobs = JOB_IDS.filter(
    (id) => !before.jobs[id].completed && after.jobs[id].completed,
  );
  const saturated: ResourceId[] = [];
  for (const id of RESOURCES) {
    if (after.stocks[id].amount >= after.stocks[id].capacity - 1e-9) saturated.push(id);
  }
  const beforeNet = computeRates(before).foodNet;
  const afterNet = computeRates(after).foodNet;
  return {
    awayMs,
    creditedMs,
    frozenMs,
    foodDelta: after.stocks.food.amount - before.stocks.food.amount,
    woodDelta: after.stocks.wood.amount - before.stocks.wood.amount,
    stoneDelta: after.stocks.stone.amount - before.stocks.stone.amount,
    completedJobs,
    arrivals: after.population - before.population,
    storageSaturated: saturated,
    shortage: afterNet < 0 || after.stocks.food.amount <= 0,
    recovered: beforeNet < 0 && afterNet >= 0,
    nextBottleneck: nextBottleneck(after),
  };
}

export function snapshot(state: IdleCivState): IdleCivState {
  return structuredClone(state);
}

export function professionVisible(state: IdleCivState, profession: ProfessionId): boolean {
  if (profession === 'laborer' || profession === 'forager' || profession === 'woodcutter')
    return true;
  if (profession === 'builder') return activeJob(state) !== null || state.jobs.hut.funded;
  if (profession === 'stone_gatherer') return state.stoneRevealed;
  return false;
}

export function coverageFor(kind: ToolKind, state: IdleCivState): number {
  return state.toolCoverage[kind];
}
