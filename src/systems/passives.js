// @ts-nocheck
/** Sum crew passives. Templates define them; combat/travel/expeditions consume them. */

import { engineFuelCut } from './economy.js';
import { getShipDef } from '../data/ships.js';

const KEYS = [
  'tradeCredits',
  'critChance',
  'expeditionSuccess',
  'fuelCostReduce',
  'repairBonus',
  'pirateResist',
  'assistCharge',
];

export function sumPassives(crew = []) {
  const out = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const c of crew) {
    const p = c.passive || {};
    for (const k of KEYS) {
      if (p[k]) out[k] += p[k];
    }
  }
  return out;
}

export function readyPassives(player, now = Date.now()) {
  const crew = (player.crew || []).filter((c) => {
    if (c.status === 'expedition') return false;
    if (c.status === 'injured' && (c.injuredUntil || 0) > now) return false;
    return true;
  });
  return sumPassives(crew);
}

export function fuelCostFor(player, baseCost) {
  const n = Number(baseCost) || 0;
  if (n <= 0) return 0;
  const cut = (readyPassives(player).fuelCostReduce || 0) + engineFuelCut(player);
  const floor = Math.max(1, Math.ceil(n * 0.4));
  return Math.max(floor, Math.ceil(n - cut));
}

export function tradePayout(base, crew) {
  const bonus = sumPassives(crew).tradeCredits || 0;
  return Math.floor((base || 0) * (1 + bonus));
}

export function combatBonuses(player, encounter) {
  const pass = readyPassives(player);
  const weapons = player.ship?.systems?.weapons || 1;
  const weaponPow = (weapons - 1) * 4;
  const critPow = Math.round(pass.critChance * 40);
  const hullBias = Math.round((getShipDef(player.ship?.shipId).weaponBias || 0) * 40);
  let enemyScale = 1;
  if (encounter?.id && /pirate|corsair|scrapper|raider/.test(encounter.id)) {
    enemyScale = Math.max(0.7, 1 - (pass.pirateResist || 0));
  }
  return {
    extraPower: weaponPow + critPow + hullBias,
    enemyScale,
    pass,
  };
}

export function hullAfterCombat(player, { success, tutorial = false } = {}) {
  const shields = player.ship?.systems?.shields || 1;
  const repair = readyPassives(player).repairBonus || 0;
  let delta = tutorial ? -4 : success ? -8 : -22;
  delta += Math.round(shields * 1.5 + repair * 20);
  if (tutorial) {
    delta = Math.min(-2, delta);
  } else if (success) {
    delta = Math.min(-3, delta);
  } else {
    delta = Math.min(-10, delta);
  }
  const hull = Math.max(0, Math.min(100, (player.ship?.hull ?? 100) + delta));
  return { ...player, ship: { ...player.ship, hull } };
}

export function repairHull(player, amount = 25) {
  const pass = readyPassives(player);
  const gained = Math.round(amount * (1 + (pass.repairBonus || 0)));
  const hull = Math.min(100, (player.ship?.hull ?? 100) + gained);
  return { player: { ...player, ship: { ...player.ship, hull } }, gained: hull - (player.ship?.hull ?? 100) };
}

export function injuryMinutesFor(player, base = 20) {
  const med = Math.max(0, player?.ship?.systems?.medbay || 0);
  return Math.max(6, Math.round((base || 20) * (1 - med * 0.08)));
}

export function passiveLabel(passive = {}) {
  const bits = [];
  if (passive.fuelCostReduce) bits.push(`fuel −${passive.fuelCostReduce}`);
  if (passive.critChance) bits.push(`crit ${Math.round(passive.critChance * 100)}%`);
  if (passive.repairBonus) bits.push(`repair +${Math.round(passive.repairBonus * 100)}%`);
  if (passive.tradeCredits) bits.push(`trade +${Math.round(passive.tradeCredits * 100)}%`);
  if (passive.expeditionSuccess) bits.push(`exp +${Math.round(passive.expeditionSuccess * 100)}%`);
  if (passive.pirateResist) bits.push(`anti-pirate ${Math.round(passive.pirateResist * 100)}%`);
  if (passive.assistCharge) bits.push(`assists +${Math.round(passive.assistCharge * 100)}%`);
  return bits[0] || '';
}
