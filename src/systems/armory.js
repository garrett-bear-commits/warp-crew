// @ts-nocheck
// The armory: weapons the captain owns, and which are fitted to the Sparrow's weapon slots.
// Fight stats live in ftlCombat.js (WEAPON_CATALOG); this module is ownership, prices and fitting.
import { WEAPON_CATALOG, DEFAULT_LOADOUT, shipCombatStats } from './ftlCombat.js';
import { canAfford, pay } from './economy.js';

/** Credits to buy each weapon. The starting pair is free and always owned. */
export const WEAPON_PRICES = Object.freeze({ ion: 650, missile: 800, beam: 950 });

export const WEAPON_BLURBS = Object.freeze({
  burst: 'Two quick shots. Each shot is stopped by a shield layer.',
  heavy: 'One heavy shot. Stopped by a shield layer.',
  ion: 'Knocks out a shield layer and stalls their recharge for 6 s. No hull damage.',
  missile: 'Flies through shields for heavy damage. 3 missiles per fight.',
  beam: 'Cuts deep and starts fires, but only once their shields are down.',
});

export function weaponSlots(player) {
  return shipCombatStats({ weapons: player?.ship?.systems?.weapons || 1 }).weaponSlots;
}

export function ownedWeapons(player) {
  const owned = Array.isArray(player?.ship?.armory) ? player.ship.armory.filter(id => WEAPON_CATALOG[id]) : [];
  return [...new Set([...DEFAULT_LOADOUT, ...owned])];
}

/** The fitted guns, trimmed to the slots the Weapons level allows and to weapons actually owned. */
export function shipLoadout(player) {
  const owned = new Set(ownedWeapons(player));
  const saved = Array.isArray(player?.ship?.loadout) ? player.ship.loadout : DEFAULT_LOADOUT;
  const fitted = saved.filter(id => owned.has(id)).slice(0, weaponSlots(player));
  return fitted.length ? fitted : [...DEFAULT_LOADOUT];
}

export function buyWeapon(player, weaponId) {
  const price = WEAPON_PRICES[weaponId];
  if (ownedWeapons(player).includes(weaponId)) return { ok: false, reason: 'already_owned' };
  if (!WEAPON_CATALOG[weaponId] || price == null) return { ok: false, reason: 'unknown_weapon' };
  const cost = { credits: price };
  if (!canAfford(player.wallet, cost)) return { ok: false, reason: 'cannot_afford', cost };
  const armory = [...ownedWeapons(player).filter(id => !DEFAULT_LOADOUT.includes(id)), weaponId];
  let next = { ...player, wallet: pay(player.wallet, cost).wallet, ship: { ...player.ship, armory } };
  // A new gun goes straight into an empty slot if there is one.
  const loadout = shipLoadout(next);
  if (loadout.length < weaponSlots(next)) next = { ...next, ship: { ...next.ship, loadout: [...loadout, weaponId] } };
  return { ok: true, player: next, cost };
}

/** Put an owned weapon in a slot (0-based). The same weapon cannot fill two slots. */
export function equipWeapon(player, slot, weaponId) {
  const slots = weaponSlots(player);
  const index = Number(slot);
  if (!Number.isInteger(index) || index < 0 || index >= slots) return { ok: false, reason: 'no_slot' };
  if (!ownedWeapons(player).includes(weaponId)) return { ok: false, reason: 'not_owned' };
  if (player.activeEncounter && !player.activeEncounter.result) return { ok: false, reason: 'in_fight' };
  const loadout = shipLoadout(player);
  const from = loadout.indexOf(weaponId);
  const next = [...loadout];
  while (next.length <= index) next.push(null);
  if (from >= 0) next[from] = next[index];
  next[index] = weaponId;
  const clean = next.filter(Boolean);
  return { ok: true, player: { ...player, ship: { ...player.ship, loadout: clean } } };
}
