import {
  COMBAT_ORDERS,
  listCombatOrders,
  previewCombatOrder,
  resolveCombatOrder,
} from '../src/systems/combat.js';

const base = { playerPower: 20, enemyPower: 20, fuel: 2, tutorial: false };
if (Object.keys(COMBAT_ORDERS).join(',') !== 'brace,burn,board') throw new Error('order roster');
if (listCombatOrders({ tutorial: true }).map((x) => x.id).join(',') !== 'brace') throw new Error('tutorial order');

const brace = previewCombatOrder({ ...base, orderId: 'brace' });
const burn = previewCombatOrder({ ...base, orderId: 'burn' });
const board = previewCombatOrder({ ...base, orderId: 'board' });
if (brace.extraFuel !== 0 || !brace.preventsInjury || brace.failureHullScale !== 0.5) throw new Error('brace preview');
if (burn.extraFuel !== 1 || burn.effectivePower !== 32) throw new Error('burn preview');
if (board.effectivePower !== 18 || board.rewardScale !== 1.25 || !board.forcesFailureInjury) throw new Error('board preview');
if (previewCombatOrder({ ...base, fuel: 0, orderId: 'burn' }).enabled) throw new Error('burn fuel gate');

const boarded = resolveCombatOrder({ ...base, orderId: 'board', encounter: { rewards: { credits: 101, medals: 5, reputation: 3 } }, rng: () => 0 });
if (!boarded.success) throw new Error('board victory');
if (boarded.rewards.credits !== 126 || boarded.rewards.medals !== 6 || boarded.rewards.reputation !== 3) throw new Error('board reward');

const tutorial = resolveCombatOrder({ ...base, orderId: 'brace', tutorialGuaranteed: true, rng: () => 1 });
if (!tutorial.success || tutorial.chance !== 1) throw new Error('tutorial guarantee');
console.log('combat_orders.test.mjs OK');
