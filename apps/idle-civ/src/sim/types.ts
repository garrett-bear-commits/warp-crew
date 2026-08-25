import type { CardId, JobId } from './config.ts';

export type StageId = 'camp' | 'hamlet';
export type ProfessionId = 'laborer' | 'forager' | 'woodcutter' | 'builder' | 'stone_gatherer';
export type ResourceId = 'food' | 'wood' | 'stone';
export type ToolKind = 'forager' | 'woodcutter' | 'builder';

export interface Stock {
  amount: number;
  capacity: number;
}

export interface Workers {
  laborer: number;
  forager: number;
  woodcutter: number;
  builder: number;
  stone_gatherer: number;
}

export interface JobProgress {
  revealed: boolean;
  funded: boolean;
  completed: boolean;
  workDone: number;
}

export interface TelemetryEvent {
  name: string;
  atSimMs: number;
  atWallMs: number;
  configVersion: string;
  saveVersion: number;
  telemetryVersion: number;
  payload: Record<string, number | boolean | string>;
}

export interface ReturnReport {
  awayMs: number;
  creditedMs: number;
  frozenMs: number;
  foodDelta: number;
  woodDelta: number;
  stoneDelta: number;
  completedJobs: JobId[];
  arrivals: number;
  storageSaturated: ResourceId[];
  shortage: boolean;
  recovered: boolean;
  nextBottleneck: string;
}

export interface IdleCivState {
  v: number;
  configVersion: string;
  acceptedActions: number;
  simMs: number;
  settledAt: number;
  stage: StageId;
  settlementName: string | null;
  nameSkipped: boolean;
  population: number;
  housing: number;
  amenities: number;
  campfireLevel: 1 | 2;
  workbenchLevel: 0 | 1;
  workers: Workers;
  stocks: Record<ResourceId, Stock>;
  stoneRevealed: boolean;
  amenitiesRevealed: boolean;
  kitGranted: boolean;
  kitEquipped: boolean;
  ownedCards: CardId[];
  equippedCards: CardId[];
  toolCoverage: Record<ToolKind, number>;
  toolSetsCrafted: number;
  jobs: Record<JobId, JobProgress>;
  foodStabilized: boolean;
  foodRecovered: boolean;
  firstMigrantArrived: boolean;
  nextMigrantAtSimMs: number | null;
  hamletReached: boolean;
  hamletCelebrationDone: boolean;
  founderPackGranted: boolean;
  founderPackOpened: boolean;
  founderCardEquipped: CardId | null;
  dailySupplyDueAtWallMs: number | null;
  foodDepletedMs: number;
  lastRationAtSimMs: number | null;
  returnReport: ReturnReport | null;
  returnReportAcked: boolean;
  emittedOnce: string[];
  telemetry: TelemetryEvent[];
}

export type IdleCivAction =
  | { type: 'assign_worker'; profession: Exclude<ProfessionId, 'laborer'>; delta: number }
  | { type: 'equip_kit' }
  | { type: 'fund_job'; jobId: JobId }
  | { type: 'craft_tool'; kind: ToolKind }
  | { type: 'name_settlement'; name: string }
  | { type: 'skip_name' }
  | { type: 'finish_hamlet_celebration' }
  | { type: 'open_founder_pack' }
  | { type: 'equip_founder_card'; cardId: CardId }
  | { type: 'ack_return_report' };

export type IdleCivEffect =
  | { kind: 'toast'; tick: number; payload: { text: string } }
  | { kind: 'pulse'; tick: number; payload: { target: string } };

export const PROFESSIONS: ProfessionId[] = [
  'laborer',
  'forager',
  'woodcutter',
  'builder',
  'stone_gatherer',
];

export const RESOURCES: ResourceId[] = ['food', 'wood', 'stone'];
export const JOB_IDS: JobId[] = ['hut', 'campfire2', 'workbench1'];
export const TOOL_KINDS: ToolKind[] = ['forager', 'woodcutter', 'builder'];

export const ONCE_EVENTS = [
  'food_stabilized',
  'starter_kit_equipped',
  'builder_assigned',
  'hut_funded',
  'hut_completed',
  'settlement_named',
  'migrant_arrived',
  'amenities_revealed',
  'campfire_upgraded',
  'workbench_unlocked',
  'first_tool_crafted',
  'hamlet_reached',
  'founder_pack_opened',
  'founder_card_equipped',
] as const;

export type OnceEventName = (typeof ONCE_EVENTS)[number];
