import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRngStreams } from '@foundation/client';
import { CAMP_CONFIG, computeRates, idleCivCodec, idleCivEngine } from '../../src/sim/index.ts';
import { advanceMinutes, advanceSeconds, apply, ctx, fresh, names } from './helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('Camp → Hamlet playable path', () => {
  it('opens on five occupied tents with Food falling', () => {
    const s = fresh();
    expect(s.population).toBe(5);
    expect(s.housing).toBe(5);
    expect(s.workers.laborer).toBe(5);
    expect(s.stocks.food.amount).toBe(CAMP_CONFIG.starting.food);
    expect(computeRates(s).foodNet).toBeLessThan(0);
    expect(s.stoneRevealed).toBe(false);
    expect(s.amenitiesRevealed).toBe(false);
  });

  it('completes the authored first-session sequence and emits ordered events', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    expect(s.foodStabilized).toBe(true);
    expect(s.kitGranted).toBe(true);
    expect(s.jobs.hut.revealed).toBe(true);

    s = apply(s, { type: 'equip_kit' });
    expect(s.kitEquipped).toBe(true);
    expect(s.equippedCards).toContain('woven_baskets');
    const withKit = computeRates(s).foodNet;
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: 1 });
    expect(computeRates(s).foodNet).toBeLessThan(withKit);
    expect(computeRates(s).foodNet).toBeGreaterThan(0);

    s = apply(s, { type: 'fund_job', jobId: 'hut' });
    expect(s.jobs.hut.funded).toBe(true);
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: 1 });
    expect(computeRates(s).workPerMinute).toBeGreaterThan(0);
    s = advanceSeconds(s, 1);
    const workAfterSlice = s.jobs.hut.workDone;
    expect(workAfterSlice).toBeGreaterThan(0);
    expect(s.jobs.hut.completed).toBe(false);
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: -1 });
    expect(computeRates(s).workPerMinute).toBe(0);
    s = advanceSeconds(s, 1);
    expect(s.jobs.hut.workDone).toBeCloseTo(workAfterSlice);
    expect(s.jobs.hut.funded).toBe(true);
    expect(s.jobs.hut.completed).toBe(false);
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: 1 });

    s = advanceSeconds(s, 6);
    expect(s.jobs.hut.completed).toBe(true);
    expect(s.housing).toBe(7);
    expect(s.population).toBe(5);

    s = apply(s, { type: 'name_settlement', name: 'Riverbend' });
    expect(s.settlementName).toBe('Riverbend');

    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 1 });
    s = advanceSeconds(s, 25);
    expect(s.firstMigrantArrived).toBe(true);
    expect(s.population).toBe(6);
    expect(s.workers.laborer).toBeGreaterThanOrEqual(1);
    expect(s.amenitiesRevealed).toBe(true);
    expect(s.housing - s.population).toBe(1);

    s = apply(s, { type: 'fund_job', jobId: 'campfire2' });
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: 1 });
    s = advanceMinutes(s, 1);
    expect(s.campfireLevel).toBe(2);
    expect(s.stoneRevealed).toBe(true);
    expect(s.jobs.workbench1.revealed).toBe(true);

    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: 1 });
    s = advanceMinutes(s, 8);
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'stone_gatherer', delta: 1 });
    s = advanceMinutes(s, 12);
    expect(s.stocks.stone.amount).toBeGreaterThanOrEqual(7);
    expect(s.stocks.wood.amount).toBeGreaterThanOrEqual(13);
    s = apply(s, { type: 'assign_worker', profession: 'stone_gatherer', delta: -1 });
    s = apply(s, { type: 'fund_job', jobId: 'workbench1' });
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: 1 });
    s = advanceMinutes(s, 1);
    expect(s.workbenchLevel).toBe(1);

    s = apply(s, { type: 'craft_tool', kind: 'forager' });
    expect(s.toolSetsCrafted).toBe(1);
    expect(s.toolCoverage.forager).toBe(1);
    expect(s.hamletReached).toBe(true);
    expect(s.stage).toBe('hamlet');
    expect(s.founderPackGranted).toBe(true);

    s = apply(s, { type: 'finish_hamlet_celebration' });
    s = apply(s, { type: 'open_founder_pack' });
    expect(s.ownedCards).toEqual(
      expect.arrayContaining(['foresters_kit', 'masonry_tools', 'builders_level']),
    );
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: 1 });
    const woodBefore = computeRates(s).woodNet;
    s = apply(s, { type: 'equip_founder_card', cardId: 'foresters_kit' });
    expect(s.founderCardEquipped).toBe('foresters_kit');
    expect(computeRates(s).woodNet).toBeGreaterThan(woodBefore);
    expect(s.dailySupplyDueAtWallMs).not.toBeNull();

    const once = names(s).filter((n) => n !== 'worker_assignment_changed');
    const expected = [
      'food_stabilized',
      'starter_kit_equipped',
      'hut_funded',
      'builder_assigned',
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
    ];
    for (const name of expected) expect(once).toContain(name);
    const order = expected.map((n) => once.indexOf(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const trace = s.telemetry.map((e) => ({
      name: e.name,
      atSimMs: e.atSimMs,
      configVersion: e.configVersion,
      payload: e.payload,
    }));
    const out = resolve(here, '../corpus/playable-path-events.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(trace, null, 2)}\n`);
  });

  it('never deletes citizens when Food is withheld, and recovers', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: 5 });
    expect(computeRates(s).foodNet).toBeLessThan(0);
    s = advanceMinutes(s, 130);
    expect(s.population).toBe(5);
    expect(s.stocks.food.amount).toBeGreaterThan(0);
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: -5 });
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    expect(computeRates(s).foodNet).toBeGreaterThan(0);
    expect(s.foodRecovered).toBe(true);
  });

  it('credits offline economy for 6h and lets a funded Hut finish on wall time', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    s = apply(s, { type: 'equip_kit' });
    s = apply(s, { type: 'fund_job', jobId: 'hut' });
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'builder', delta: 1 });
    const progress = idleCivEngine.progressOf(s);
    const gap = idleCivEngine.onGap!(s, { deviceSec: 8 * 3600, serverSec: 8 * 3600 }, ctx(0));
    expect(idleCivEngine.progressOf(gap.state)).toBe(progress);
    expect(gap.state.jobs.hut.completed).toBe(true);
    expect(gap.state.returnReport?.creditedMs).toBe(CAMP_CONFIG.offlineBaseMs);
    expect(gap.state.returnReport?.frozenMs).toBe(2 * 3600 * 1000);
    expect(gap.state.workers.builder).toBe(1);
    gap.state.workers.laborer += 1;
    // newcomers would be laborers; the saved builder stays put
    expect(gap.state.workers.builder).toBe(1);
  });

  it('does not start a new job while away', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    const before = s.jobs.hut.funded;
    idleCivEngine.onGap!(s, { deviceSec: 3600, serverSec: 3600 }, ctx(0));
    expect(s.jobs.hut.funded).toBe(before);
  });

  it('keeps a Forager card from changing Wood', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    s = apply(s, { type: 'equip_kit' });
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: -1 });
    s = apply(s, { type: 'assign_worker', profession: 'woodcutter', delta: 1 });
    const wood = computeRates(s).woodNet;
    const food = computeRates(s).foodNet;
    s.equippedCards = [];
    s.kitEquipped = false;
    const woodOff = computeRates(s).woodNet;
    const foodOff = computeRates(s).foodNet;
    expect(wood).toBe(woodOff);
    expect(food).toBeGreaterThan(foodOff);
  });

  it('round-trips a save through the codec', () => {
    let s = fresh();
    s = apply(s, { type: 'assign_worker', profession: 'forager', delta: 5 });
    s = apply(s, { type: 'equip_kit' });
    const blob = idleCivCodec.encode(s);
    const back = idleCivCodec.decode(blob);
    expect(back.kitEquipped).toBe(true);
    expect(back.workers.forager).toBe(5);
    expect(back.configVersion).toBe(CAMP_CONFIG.version);
  });

  it('onGap never raises progressOf for the same seed', () => {
    const rng = createRngStreams(7).sim;
    const s = idleCivEngine.newState({ now: 1, seed: 7, rng });
    const before = idleCivEngine.progressOf(s);
    idleCivEngine.onGap!(s, { deviceSec: 120, serverSec: 120 }, ctx(0));
    expect(idleCivEngine.progressOf(s)).toBe(before);
  });
});
