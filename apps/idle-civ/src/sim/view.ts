import { CAMP_CONFIG, type CardId, type JobId } from './config.ts';
import { activeJob, cardModifier, computeRates, jobEtaSec, nextBottleneck } from './economy.ts';
import type { IdleCivState, ProfessionId, ToolKind } from './types.ts';

export interface StockView {
  id: 'food' | 'wood' | 'stone';
  label: string;
  amount: number;
  capacity: number;
  netPerMin: number;
  visible: boolean;
  warning: boolean;
}

export interface WorkerView {
  profession: ProfessionId;
  label: string;
  count: number;
  visible: boolean;
  canPlus: boolean;
  canMinus: boolean;
  rateLabel: string;
  toolCovered: number;
  cardLabel: string | null;
}

export interface JobView {
  id: JobId;
  label: string;
  status: 'hidden' | 'available' | 'funded' | 'building' | 'complete';
  etaSec: number | null;
  costs: string;
  workPct: number;
}

export interface PathItem {
  id: string;
  label: string;
  done: boolean;
}

export interface CityView {
  stage: IdleCivState['stage'];
  title: string;
  population: number;
  housing: number;
  vacancies: number;
  amenities: number;
  amenityCoverage: number;
  happiness: 'hidden' | 'happy' | 'content' | 'strained';
  stocks: StockView[];
  workers: WorkerView[];
  laborers: number;
  jobs: JobView[];
  kitGranted: boolean;
  kitEquipped: boolean;
  tools: { kind: ToolKind; label: string; covered: number; craftable: boolean }[];
  founderGranted: boolean;
  founderOpened: boolean;
  founderEquipped: CardId | null;
  founderCards: { id: CardId; label: string; profession: string; modifier: number }[];
  path: PathItem[];
  hint: string;
  foodWarning: boolean;
  named: boolean;
  nameSkipped: boolean;
  hutComplete: boolean;
  hamletReached: boolean;
  hamletCelebrationDone: boolean;
  dailySupplyDueAtWallMs: number | null;
  returnReport: IdleCivState['returnReport'];
  campfireLevel: 1 | 2;
  workbenchLevel: 0 | 1;
  settlementName: string | null;
}

const LABELS: Record<ProfessionId, string> = {
  laborer: 'Laborer',
  forager: 'Forager',
  woodcutter: 'Wood Gatherer',
  builder: 'Builder',
  stone_gatherer: 'Stone Gatherer',
};

const TOOL_LABELS: Record<ToolKind, string> = {
  forager: 'Forager tools',
  woodcutter: 'Stone axe',
  builder: 'Stone hammer',
};

const JOB_LABELS: Record<JobId, string> = {
  hut: 'First Hut',
  campfire2: 'Campfire Level 2',
  workbench1: 'Workbench',
};

function fmtCost(costs: Partial<Record<'food' | 'wood' | 'stone', number>>): string {
  return (Object.entries(costs) as [string, number][])
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${n} ${id}`)
    .join(', ');
}

function jobStatus(state: IdleCivState, id: JobId): JobView['status'] {
  const j = state.jobs[id];
  if (!j.revealed) return 'hidden';
  if (j.completed) return 'complete';
  if (j.funded && state.workers.builder > 0) return 'building';
  if (j.funded) return 'funded';
  return 'available';
}

function happiness(state: IdleCivState): CityView['happiness'] {
  if (!state.amenitiesRevealed) return 'hidden';
  const c = computeRates(state).amenityCoverage;
  if (c >= 1) return 'happy';
  if (c >= CAMP_CONFIG.slowedAmenityThreshold) return 'content';
  return 'strained';
}

function workerRateLabel(state: IdleCivState, profession: ProfessionId): string {
  const rates = computeRates(state);
  if (profession === 'forager') return `${rates.foodProd.toFixed(2)} Food/min`;
  if (profession === 'woodcutter') return `${rates.woodNet.toFixed(2)} Wood/min`;
  if (profession === 'stone_gatherer') return `${rates.stoneNet.toFixed(2)} Stone/min`;
  if (profession === 'builder') return `${rates.workPerMinute.toFixed(1)} work/min`;
  return 'Unassigned';
}

function cardLabelFor(state: IdleCivState, profession: ProfessionId): string | null {
  for (const id of state.equippedCards) {
    const card = CAMP_CONFIG.cards[id];
    if (card.professionId === profession)
      return `${card.label} ×${cardModifier(state, profession).toFixed(2)}`;
  }
  return null;
}

export function cityView(state: IdleCivState): CityView {
  const rates = computeRates(state);
  const title =
    state.stage === 'hamlet'
      ? state.settlementName
        ? `${state.settlementName} · Hamlet`
        : 'Hamlet'
      : (state.settlementName ?? 'Camp');
  const stocks: StockView[] = [
    {
      id: 'food',
      label: 'Food',
      amount: state.stocks.food.amount,
      capacity: state.stocks.food.capacity,
      netPerMin: rates.foodNet,
      visible: true,
      warning: rates.foodNet < 0,
    },
    {
      id: 'wood',
      label: 'Wood',
      amount: state.stocks.wood.amount,
      capacity: state.stocks.wood.capacity,
      netPerMin: rates.woodNet,
      visible: true,
      warning: false,
    },
    {
      id: 'stone',
      label: 'Loose Stone',
      amount: state.stocks.stone.amount,
      capacity: state.stocks.stone.capacity,
      netPerMin: rates.stoneNet,
      visible: state.stoneRevealed,
      warning: false,
    },
  ];
  const workers: WorkerView[] = (
    ['forager', 'woodcutter', 'builder', 'stone_gatherer'] as const
  ).map((profession) => {
    const visible =
      profession === 'forager' ||
      profession === 'woodcutter' ||
      (profession === 'builder' && (activeJob(state) !== null || state.jobs.hut.funded)) ||
      (profession === 'stone_gatherer' && state.stoneRevealed);
    const cap = profession === 'builder' ? CAMP_CONFIG.builderCap : 99;
    return {
      profession,
      label: LABELS[profession],
      count: state.workers[profession],
      visible,
      canPlus: visible && state.workers.laborer > 0 && state.workers[profession] < cap,
      canMinus: visible && state.workers[profession] > 0,
      rateLabel: workerRateLabel(state, profession),
      toolCovered: profession === 'stone_gatherer' ? 0 : state.toolCoverage[profession as ToolKind],
      cardLabel: cardLabelFor(state, profession),
    };
  });
  const jobs: JobView[] = (['hut', 'campfire2', 'workbench1'] as const).map((id) => ({
    id,
    label: JOB_LABELS[id],
    status: jobStatus(state, id),
    etaSec: jobEtaSec(state, id),
    costs: fmtCost(CAMP_CONFIG.jobs[id].costs),
    workPct: CAMP_CONFIG.jobs[id].work
      ? Math.min(100, (state.jobs[id].workDone / CAMP_CONFIG.jobs[id].work) * 100)
      : 0,
  }));
  const tools = (['forager', 'woodcutter', 'builder'] as const).map((kind) => ({
    kind,
    label: TOOL_LABELS[kind],
    covered: state.toolCoverage[kind],
    craftable:
      state.workbenchLevel >= 1 && state.stocks.wood.amount >= 3 && state.stocks.stone.amount >= 3,
  }));
  const path: PathItem[] = [
    { id: 'food', label: 'Food stable', done: state.foodStabilized },
    { id: 'kit', label: 'Work Kit', done: state.kitEquipped },
    { id: 'hut', label: 'Hut', done: state.jobs.hut.completed },
    { id: 'migrant', label: 'First arrival', done: state.firstMigrantArrived },
    { id: 'fire', label: 'Campfire L2', done: state.campfireLevel >= 2 },
    { id: 'bench', label: 'Workbench', done: state.workbenchLevel >= 1 },
    { id: 'tool', label: 'First tool', done: state.toolSetsCrafted >= 1 },
    { id: 'hamlet', label: 'Hamlet', done: state.hamletReached },
  ];
  return {
    stage: state.stage,
    title,
    population: state.population,
    housing: state.housing,
    vacancies: state.housing - state.population,
    amenities: state.amenities,
    amenityCoverage: rates.amenityCoverage,
    happiness: happiness(state),
    stocks,
    workers,
    laborers: state.workers.laborer,
    jobs,
    kitGranted: state.kitGranted,
    kitEquipped: state.kitEquipped,
    tools,
    founderGranted: state.founderPackGranted,
    founderOpened: state.founderPackOpened,
    founderEquipped: state.founderCardEquipped,
    founderCards: CAMP_CONFIG.founderPackCardIds.map((id) => ({
      id,
      label: CAMP_CONFIG.cards[id].label,
      profession: CAMP_CONFIG.cards[id].professionId,
      modifier: CAMP_CONFIG.cards[id].modifier,
    })),
    path,
    hint: nextBottleneck(state),
    foodWarning: rates.foodNet < 0,
    named: state.settlementName !== null,
    nameSkipped: state.nameSkipped,
    hutComplete: state.jobs.hut.completed,
    hamletReached: state.hamletReached,
    hamletCelebrationDone: state.hamletCelebrationDone,
    dailySupplyDueAtWallMs: state.dailySupplyDueAtWallMs,
    returnReport: state.returnReport,
    campfireLevel: state.campfireLevel,
    workbenchLevel: state.workbenchLevel,
    settlementName: state.settlementName,
  };
}
