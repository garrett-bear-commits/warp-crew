import type { Ctx, Engine, Summary } from '@foundation/client';
import {
  CAMP_CONFIG,
  CONFIG_VERSION,
  SAVE_SCHEMA_VERSION,
  TELEMETRY_VERSION,
  TPS,
  type CardId,
  type JobId,
} from './config.ts';
import {
  activeJob,
  addResource,
  buildReturnReport,
  canPay,
  computeRates,
  pay,
  snapshot,
} from './economy.ts';
import type {
  IdleCivAction,
  IdleCivEffect,
  IdleCivState,
  OnceEventName,
  ProfessionId,
  TelemetryEvent,
} from './types.ts';

const cfg = CAMP_CONFIG;

export { TPS, SAVE_SCHEMA_VERSION as SCHEMA_VERSION };

const emptyJob = (): IdleCivState['jobs'][JobId] => ({
  revealed: false,
  funded: false,
  completed: false,
  workDone: 0,
});

function emitOnce(
  state: IdleCivState,
  ctx: Ctx,
  name: OnceEventName,
  payload: TelemetryEvent['payload'],
): void {
  if (state.emittedOnce.includes(name)) return;
  state.emittedOnce.push(name);
  pushEvent(state, ctx, name, payload);
}

function pushEvent(
  state: IdleCivState,
  ctx: Ctx,
  name: string,
  payload: TelemetryEvent['payload'],
): void {
  state.telemetry.push({
    name,
    atSimMs: state.simMs,
    atWallMs: ctx.now,
    configVersion: state.configVersion,
    saveVersion: state.v,
    telemetryVersion: TELEMETRY_VERSION,
    payload,
  });
  if (state.telemetry.length > 80) state.telemetry.splice(0, state.telemetry.length - 80);
}

function contextPayload(state: IdleCivState): TelemetryEvent['payload'] {
  const rates = computeRates(state);
  return {
    food: round4(state.stocks.food.amount),
    wood: round4(state.stocks.wood.amount),
    stone: round4(state.stocks.stone.amount),
    foodNet: round4(rates.foodNet),
    woodNet: round4(rates.woodNet),
    population: state.population,
    housing: state.housing,
    foragers: state.workers.forager,
    woodcutters: state.workers.woodcutter,
    builders: state.workers.builder,
    stoneGatherers: state.workers.stone_gatherer,
    laborers: state.workers.laborer,
    kitEquipped: state.kitEquipped,
    toolSets: state.toolSetsCrafted,
    simMs: state.simMs,
    configVersion: state.configVersion,
    stage: state.stage,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function grantKit(state: IdleCivState): void {
  if (state.kitGranted) return;
  state.kitGranted = true;
  if (!state.ownedCards.includes('woven_baskets')) state.ownedCards.push('woven_baskets');
  state.jobs.hut.revealed = true;
}

function completeJob(state: IdleCivState, ctx: Ctx, id: JobId, effects: IdleCivEffect[]): void {
  const job = state.jobs[id];
  if (job.completed) return;
  job.completed = true;
  job.workDone = cfg.jobs[id].work;
  if (id === 'hut') {
    state.housing += cfg.jobs.hut.housingAdd;
    emitOnce(state, ctx, 'hut_completed', {
      ...contextPayload(state),
      vacancies: state.housing - state.population,
    });
    if (!state.firstMigrantArrived)
      state.nextMigrantAtSimMs = state.simMs + cfg.firstMigrantDelayMs;
    effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'hut' } });
    effects.push({ kind: 'toast', tick: ctx.tick, payload: { text: 'The Hut is standing.' } });
  } else if (id === 'campfire2') {
    state.campfireLevel = 2;
    state.amenities = cfg.jobs.campfire2.amenitiesTo;
    emitOnce(state, ctx, 'campfire_upgraded', contextPayload(state));
    state.stoneRevealed = true;
    state.jobs.workbench1.revealed = true;
    emitOnce(state, ctx, 'workbench_unlocked', contextPayload(state));
    effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'campfire' } });
    effects.push({
      kind: 'toast',
      tick: ctx.tick,
      payload: { text: 'The fire grows. Loose Stone is visible.' },
    });
  } else if (id === 'workbench1') {
    state.workbenchLevel = 1;
    effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'workbench' } });
    effects.push({
      kind: 'toast',
      tick: ctx.tick,
      payload: { text: 'Workbench ready. Choose a tool set.' },
    });
  }
}

function arriveMigrant(state: IdleCivState, ctx: Ctx, effects: IdleCivEffect[]): void {
  if (state.housing <= state.population) return;
  if (state.stocks.food.amount <= 0) return;
  state.population += 1;
  state.workers.laborer += 1;
  if (!state.firstMigrantArrived) {
    state.firstMigrantArrived = true;
    state.amenitiesRevealed = true;
    state.jobs.campfire2.revealed = true;
    emitOnce(state, ctx, 'migrant_arrived', {
      ...contextPayload(state),
      vacancies: state.housing - state.population,
    });
    emitOnce(state, ctx, 'amenities_revealed', {
      amenities: state.amenities,
      coverage: computeRates(state).amenityCoverage,
    });
    effects.push({
      kind: 'toast',
      tick: ctx.tick,
      payload: { text: 'Someone wants to join the camp.' },
    });
  }
  const rates = computeRates(state);
  const interval =
    rates.amenityCoverage < cfg.slowedAmenityThreshold
      ? cfg.laterMigrantIntervalMs / cfg.slowedMultiplier
      : cfg.laterMigrantIntervalMs;
  state.nextMigrantAtSimMs = state.simMs + interval;
  effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'people' } });
}

function maybeStabilize(state: IdleCivState, ctx: Ctx, effects: IdleCivEffect[]): void {
  const rates = computeRates(state);
  if (!state.foodStabilized && rates.foodNet >= 0 && state.workers.forager > 0) {
    state.foodStabilized = true;
    grantKit(state);
    emitOnce(state, ctx, 'food_stabilized', contextPayload(state));
    effects.push({
      kind: 'toast',
      tick: ctx.tick,
      payload: { text: 'Food is stable. A Work Kit is waiting.' },
    });
    effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'campfire' } });
  }
  if (rates.foodNet >= 0 && state.stocks.food.amount > 0) state.foodRecovered = true;
}

function maybeHamlet(state: IdleCivState, ctx: Ctx, effects: IdleCivEffect[]): void {
  if (state.hamletReached) return;
  const rates = computeRates(state);
  const foodOk = rates.foodNet >= 0 || rates.reserveMinutes >= 60;
  const housed = state.housing >= state.population;
  if (
    state.jobs.hut.completed &&
    state.firstMigrantArrived &&
    state.campfireLevel >= 2 &&
    state.workbenchLevel >= 1 &&
    state.toolSetsCrafted >= 1 &&
    housed &&
    foodOk &&
    (state.foodStabilized || state.foodRecovered)
  ) {
    state.hamletReached = true;
    state.stage = 'hamlet';
    state.founderPackGranted = true;
    state.stocks.food.capacity = Math.max(state.stocks.food.capacity, cfg.hamletCaps.food);
    state.stocks.wood.capacity = Math.max(state.stocks.wood.capacity, cfg.hamletCaps.wood);
    state.stocks.stone.capacity = Math.max(state.stocks.stone.capacity, cfg.hamletCaps.stone);
    emitOnce(state, ctx, 'hamlet_reached', {
      ...contextPayload(state),
      name: state.settlementName ?? '',
    });
    effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'hamlet' } });
    effects.push({
      kind: 'toast',
      tick: ctx.tick,
      payload: { text: 'The camp is becoming a Hamlet.' },
    });
  }
}

function checkAll(state: IdleCivState, ctx: Ctx, effects: IdleCivEffect[]): void {
  maybeStabilize(state, ctx, effects);
  maybeHamlet(state, ctx, effects);
}

function tickSecond(
  state: IdleCivState,
  ctx: Ctx,
  flags: { economy: boolean; construction: boolean },
  effects: IdleCivEffect[],
): void {
  const dtMin = 1 / 60;
  if (flags.economy) {
    const rates = computeRates(state);
    addResource(state, 'food', rates.foodProd * dtMin);
    addResource(state, 'food', -rates.foodConsume * dtMin);
    addResource(state, 'wood', rates.woodNet * dtMin);
    if (state.stoneRevealed) addResource(state, 'stone', rates.stoneNet * dtMin);
    if (state.stocks.food.amount <= 0) {
      state.foodDepletedMs += 1000;
      const cooled =
        state.lastRationAtSimMs === null ||
        state.simMs - state.lastRationAtSimMs >= cfg.emergencyRation.cooldownMs;
      if (state.foodDepletedMs >= cfg.emergencyRation.triggerMs && cooled) {
        const need =
          state.population *
          cfg.foodConsumptionPerPopulationPerMinute *
          cfg.emergencyRation.reserveMinutes;
        addResource(state, 'food', need);
        state.foodDepletedMs = 0;
        state.lastRationAtSimMs = state.simMs;
        effects.push({
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: 'Emergency rations. Nobody is lost.' },
        });
      }
    } else {
      state.foodDepletedMs = 0;
    }
    if (
      state.nextMigrantAtSimMs !== null &&
      state.simMs >= state.nextMigrantAtSimMs &&
      state.housing > state.population
    ) {
      arriveMigrant(state, ctx, effects);
    }
  }
  if (flags.construction) {
    const id = activeJob(state);
    if (id && state.workers.builder > 0) {
      const rates = computeRates(state);
      state.jobs[id].workDone += rates.workPerMinute * dtMin;
      if (state.jobs[id].workDone >= cfg.jobs[id].work) completeJob(state, ctx, id, effects);
    }
  }
  state.simMs += 1000;
  checkAll(state, ctx, effects);
}

export function advanceMs(
  state: IdleCivState,
  ms: number,
  ctx: Ctx,
  flags: { economy: boolean; construction: boolean },
): IdleCivEffect[] {
  const effects: IdleCivEffect[] = [];
  const seconds = Math.max(0, Math.floor(ms / 1000));
  for (let i = 0; i < seconds; i++) tickSecond(state, ctx, flags, effects);
  return effects;
}

function assignWorker(
  state: IdleCivState,
  profession: Exclude<ProfessionId, 'laborer'>,
  delta: number,
  ctx: Ctx,
  effects: IdleCivEffect[],
): boolean {
  if (!Number.isInteger(delta) || delta === 0) return false;
  if (profession === 'builder' && activeJob(state) === null && !state.jobs.hut.funded) return false;
  if (profession === 'stone_gatherer' && !state.stoneRevealed) return false;
  if (delta > 0) {
    const take = Math.min(delta, state.workers.laborer);
    if (take <= 0) return false;
    if (profession === 'builder' && state.workers.builder + take > cfg.builderCap) return false;
    state.workers.laborer -= take;
    state.workers[profession] += take;
  } else {
    const take = Math.min(-delta, state.workers[profession]);
    if (take <= 0) return false;
    state.workers[profession] -= take;
    state.workers.laborer += take;
  }
  state.acceptedActions += 1;
  pushEvent(state, ctx, 'worker_assignment_changed', {
    ...contextPayload(state),
    profession,
    delta,
  });
  if (state.workers.builder > 0)
    emitOnce(state, ctx, 'builder_assigned', {
      ...contextPayload(state),
      etaSec: (() => {
        const id = activeJob(state);
        if (!id) return 0;
        const remaining = cfg.jobs[id].work - state.jobs[id].workDone;
        const work = computeRates(state).workPerMinute;
        return work > 0 ? (remaining / work) * 60 : 0;
      })(),
    });
  effects.push({ kind: 'pulse', tick: ctx.tick, payload: { target: 'people' } });
  checkAll(state, ctx, effects);
  return true;
}

export const idleCivEngine: Engine<IdleCivState, IdleCivAction, IdleCivEffect> = {
  newState(init) {
    const s = cfg.starting;
    return {
      v: SAVE_SCHEMA_VERSION,
      configVersion: CONFIG_VERSION,
      acceptedActions: 0,
      simMs: 0,
      settledAt: init.now,
      stage: 'camp',
      settlementName: null,
      nameSkipped: false,
      population: s.population,
      housing: s.housing,
      amenities: s.amenities,
      campfireLevel: s.campfireLevel,
      workbenchLevel: 0,
      workers: {
        laborer: s.population,
        forager: 0,
        woodcutter: 0,
        builder: 0,
        stone_gatherer: 0,
      },
      stocks: {
        food: { amount: s.food, capacity: s.foodCap },
        wood: { amount: s.wood, capacity: s.woodCap },
        stone: { amount: s.stone, capacity: s.stoneCap },
      },
      stoneRevealed: false,
      amenitiesRevealed: false,
      kitGranted: false,
      kitEquipped: false,
      ownedCards: [],
      equippedCards: [],
      toolCoverage: { forager: 0, woodcutter: 0, builder: 0 },
      toolSetsCrafted: 0,
      jobs: { hut: emptyJob(), campfire2: emptyJob(), workbench1: emptyJob() },
      foodStabilized: false,
      foodRecovered: false,
      firstMigrantArrived: false,
      nextMigrantAtSimMs: null,
      hamletReached: false,
      hamletCelebrationDone: false,
      founderPackGranted: false,
      founderPackOpened: false,
      founderCardEquipped: null,
      dailySupplyDueAtWallMs: null,
      foodDepletedMs: 0,
      lastRationAtSimMs: null,
      returnReport: null,
      returnReportAcked: true,
      emittedOnce: [],
      telemetry: [],
    };
  },
  apply(state, action, ctx) {
    const effects: IdleCivEffect[] = [];
    switch (action.type) {
      case 'assign_worker':
        assignWorker(state, action.profession, action.delta, ctx, effects);
        break;
      case 'equip_kit': {
        if (!state.kitGranted || state.kitEquipped) break;
        if (!state.ownedCards.includes('woven_baskets')) state.ownedCards.push('woven_baskets');
        if (!state.equippedCards.includes('woven_baskets'))
          state.equippedCards.push('woven_baskets');
        state.kitEquipped = true;
        state.acceptedActions += 1;
        emitOnce(state, ctx, 'starter_kit_equipped', {
          ...contextPayload(state),
          cardId: 'woven_baskets',
          profession: 'forager',
          modifier: cfg.cards.woven_baskets.modifier,
        });
        effects.push({
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: 'Woven Baskets: every Forager works faster.' },
        });
        checkAll(state, ctx, effects);
        break;
      }
      case 'fund_job': {
        const job = state.jobs[action.jobId];
        if (!job || !job.revealed || job.funded || job.completed) break;
        if (activeJob(state)) break;
        const costs = cfg.jobs[action.jobId].costs;
        if (!canPay(state, costs)) break;
        pay(state, costs);
        job.funded = true;
        state.acceptedActions += 1;
        if (action.jobId === 'hut') emitOnce(state, ctx, 'hut_funded', contextPayload(state));
        if (action.jobId === 'campfire2') state.jobs.campfire2.revealed = true;
        effects.push({
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: 'Materials committed. Assign a Builder.' },
        });
        break;
      }
      case 'craft_tool': {
        if (state.workbenchLevel < 1) break;
        if (!canPay(state, cfg.toolCraft.costs)) break;
        pay(state, cfg.toolCraft.costs);
        state.toolCoverage[action.kind] += 1;
        state.toolSetsCrafted += 1;
        state.acceptedActions += 1;
        emitOnce(state, ctx, 'first_tool_crafted', {
          ...contextPayload(state),
          tool: action.kind,
          coverage: 1,
        });
        effects.push({
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: 'One worker is fully tooled.' },
        });
        checkAll(state, ctx, effects);
        break;
      }
      case 'name_settlement': {
        if (!state.jobs.hut.completed || state.settlementName !== null) break;
        const name = action.name.trim().slice(0, cfg.nameMaxLen);
        if (!name) break;
        state.settlementName = name;
        state.acceptedActions += 1;
        emitOnce(state, ctx, 'settlement_named', { name });
        break;
      }
      case 'skip_name': {
        if (!state.jobs.hut.completed || state.settlementName !== null) break;
        state.nameSkipped = true;
        state.acceptedActions += 1;
        break;
      }
      case 'finish_hamlet_celebration': {
        if (!state.hamletReached || state.hamletCelebrationDone) break;
        state.hamletCelebrationDone = true;
        state.acceptedActions += 1;
        break;
      }
      case 'open_founder_pack': {
        if (!state.founderPackGranted || !state.hamletCelebrationDone || state.founderPackOpened)
          break;
        state.founderPackOpened = true;
        for (const id of cfg.founderPackCardIds) {
          if (!state.ownedCards.includes(id)) state.ownedCards.push(id);
        }
        state.acceptedActions += 1;
        emitOnce(state, ctx, 'founder_pack_opened', {
          cards: cfg.founderPackCardIds.join(','),
        });
        break;
      }
      case 'equip_founder_card': {
        if (!state.founderPackOpened || state.founderCardEquipped) break;
        if (!state.ownedCards.includes(action.cardId)) break;
        const card = cfg.cards[action.cardId];
        if (!card || card.source !== 'founder') break;
        const already = state.equippedCards.some(
          (id) => cfg.cards[id].professionId === card.professionId,
        );
        if (already) break;
        state.equippedCards.push(action.cardId);
        state.founderCardEquipped = action.cardId;
        state.dailySupplyDueAtWallMs = ctx.now + cfg.dailySupplyMs;
        state.acceptedActions += 1;
        emitOnce(state, ctx, 'founder_card_equipped', {
          ...contextPayload(state),
          cardId: action.cardId,
          profession: card.professionId,
          modifier: card.modifier,
        });
        effects.push({
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: `${card.label} is working the settlement.` },
        });
        break;
      }
      case 'ack_return_report': {
        if (!state.returnReport) break;
        state.returnReport = null;
        state.returnReportAcked = true;
        state.acceptedActions += 1;
        pushEvent(state, ctx, 'offline_return_report_viewed', contextPayload(state));
        break;
      }
    }
    return { state, effects };
  },
  isPaused: () => false,
  step(state, dtTicks, ctx) {
    const ms = Math.max(0, Math.floor(dtTicks * (1000 / TPS)));
    const effects = advanceMs(state, ms, ctx, { economy: true, construction: true });
    return { state, effects: ctx.catchUp ? [] : effects };
  },
  onGap(state, gap, ctx) {
    const awayMs = Math.min(Math.max(0, Math.floor(gap.serverSec * 1000)), cfg.offlineMaxMs);
    const creditedMs = Math.min(awayMs, cfg.offlineBaseMs);
    const frozenMs = Math.max(0, awayMs - creditedMs);
    const before = snapshot(state);
    advanceMs(state, creditedMs, ctx, { economy: true, construction: true });
    if (frozenMs > 0) advanceMs(state, frozenMs, ctx, { economy: false, construction: true });
    state.returnReport = buildReturnReport(before, state, awayMs, creditedMs, frozenMs);
    state.returnReportAcked = false;
    return {
      state,
      effects: [
        {
          kind: 'toast',
          tick: ctx.tick,
          payload: { text: 'Welcome back to the settlement.' },
        },
      ],
    };
  },
  settle(state, ctx) {
    state.settledAt = ctx.now;
    return state;
  },
  progressOf: (s) => s.acceptedActions,
  summary(s): Summary {
    const stage = s.stage === 'hamlet' ? 1 : 0;
    return {
      counter: s.acceptedActions,
      population: s.population,
      housing: s.housing,
      food: Math.floor(s.stocks.food.amount),
      wood: Math.floor(s.stocks.wood.amount),
      stage,
    };
  },
};

export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {};

export function previewAssign(
  state: IdleCivState,
  profession: Exclude<ProfessionId, 'laborer'>,
  delta: number,
): { foodNet: number; woodNet: number; workPerMinute: number } {
  const copy = snapshot(state);
  const dummy: Ctx = {
    now: 0,
    rng: { next: () => 0, int: () => 0, state: () => 0, restore: () => {} },
    tick: 0,
    catchUp: true,
  };
  assignWorker(copy, profession, delta, dummy, []);
  const rates = computeRates(copy);
  return { foodNet: rates.foodNet, woodNet: rates.woodNet, workPerMinute: rates.workPerMinute };
}

export function hamletReady(state: IdleCivState): boolean {
  const rates = computeRates(state);
  return (
    state.jobs.hut.completed &&
    state.firstMigrantArrived &&
    state.campfireLevel >= 2 &&
    state.workbenchLevel >= 1 &&
    state.toolSetsCrafted >= 1 &&
    state.housing >= state.population &&
    (rates.foodNet >= 0 || rates.reserveMinutes >= 60)
  );
}

export type { CardId };
