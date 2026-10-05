import assert from 'node:assert/strict';
import {
  startFtlEncounter, advanceFtlEncounter, validFtlBody, shipCombatStats, enemyLoadout, WEAPON_CATALOG,
} from '../src/systems/ftlCombat.js';
import { buyWeapon, equipWeapon, ownedWeapons, shipLoadout, weaponSlots, WEAPON_PRICES } from '../src/systems/armory.js';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { systemStat } from '../src/systems/economy.js';
import { renderArmory } from '../src/ui/bridge.js';

const CREW = [
  { id: 'cap', role: 'pilot', station: 'helm' },
  { id: 'gun', role: 'gunner', station: 'weapons' },
  { id: 'eng', role: 'engineer', station: 'shields' },
];
const start = (extra = {}) => startFtlEncounter({ acceptanceId: 'w-1', encounterId: 'pirate_wing', seed: 77, threat: 1, crew: CREW, ...extra });
const run = (state, beats = 400) => {
  for (let i = 0; i < beats && state.result === null; i += 1) {
    state = advanceFtlEncounter(state, state.phase === 'downed' ? 'concede' : null).state;
    assert.ok(validFtlBody(state), `valid at beat ${state.beat}`);
  }
  return state;
};

// Drydock levels shape the fight.
const base = shipCombatStats({});
assert.deepEqual([base.shieldLayers, base.weaponSlots, base.evasionBonus, base.accuracyBonus, base.chargeMult], [1, 2, 0, 0, 1]);
const big = shipCombatStats({ shields: 10, weapons: 8, engines: 20, sensors: 20 });
assert.deepEqual([big.shieldLayers, big.weaponSlots, big.evasionBonus, big.accuracyBonus], [3, 4, 10, 8]);
assert.equal(shipCombatStats({ weapons: 4 }).weaponSlots, 3);
assert.equal(shipCombatStats({ shields: 6 }).shieldLayers, 2);

// Every weapon kind fights a valid, deterministic fight to the end.
for (const loadout of [['burst', 'heavy'], ['burst', 'ion', 'missile'], ['heavy', 'beam', 'ion', 'missile']]) {
  const opts = { loadout, shipLevels: { shields: 6, weapons: 8, engines: 3, sensors: 3 } };
  const a = start(opts);
  assert.ok(validFtlBody(a), `fresh ${loadout} fight is valid`);
  assert.equal(a.weapons.length, loadout.length);
  assert.equal(a.shields.max, 2, 'Shields 6 gives two layers');
  if (loadout.includes('missile')) assert.equal(a.ammo.missile, 3);
  else assert.equal(a.ammo, undefined);
  const end = run(a);
  assert.notEqual(end.result, null);
  assert.deepEqual(end, run(start(opts)), 'same seed, same fight');
}

// A loadout bigger than the slots is trimmed; missiles run dry.
const trimmed = start({ loadout: ['burst', 'heavy', 'ion'] });
assert.equal(trimmed.weapons.length, 2, 'Weapons Lv 1 has two slots');
let missiles = start({ loadout: ['missile', 'burst'], threat: 1.6, hull: 100 });
missiles = run(missiles);
assert.ok(missiles.ammo.missile >= 0 && missiles.ammo.missile <= 3);

// Save validator rejects tampered fights.
const fresh = start({ loadout: ['burst', 'missile'] });
assert.equal(validFtlBody({ ...fresh, ammo: { missile: 9 } }), false, 'ammo beyond the rack');
assert.equal(validFtlBody({ ...fresh, weapons: [...fresh.weapons, { ...fresh.weapons[0], id: 'beam' }] }), false, 'more guns than slots');
assert.equal(validFtlBody({ ...fresh, weapons: [{ ...fresh.weapons[0], id: 'railgun' }] }), false, 'unknown weapon');
assert.equal(validFtlBody({ ...fresh, shields: { ...fresh.shields, max: 3 } }), false, 'shield layers must match the drydock');

// Flagships and tiers bring heavier enemies.
assert.ok(enemyLoadout(1, { flagship: 2 }).shieldLayers > enemyLoadout(1).shieldLayers);
const flag = start({ flagship: 2, enemyTier: 1 });
assert.ok(validFtlBody(flag));
assert.equal(validFtlBody({ ...flag, enemy: { ...flag.enemy, flagship: 3 } }), false);

// Ion stalls the enemy shield recharge.
let ion = start({ loadout: ['ion', 'burst'], threat: 1.2, seed: 5 });
let sawIon = false;
for (let i = 0; i < 120 && ion.result === null; i += 1) {
  ion = advanceFtlEncounter(ion, ion.phase === 'downed' ? 'concede' : null).state;
  if ((ion.enemy.shields.ionMs || 0) > 0) sawIon = true;
}
assert.ok(sawIon, 'an ion hit ionizes the enemy shields');

// The armory: ownership, buying, fitting.
let p = migratePlayer(createNewPlayer({ now: 0, rng: () => 0.3 }));
assert.deepEqual(ownedWeapons(p), ['burst', 'heavy']);
assert.deepEqual(shipLoadout(p), ['burst', 'heavy']);
assert.equal(weaponSlots(p), 2);
assert.equal(buyWeapon(p, 'ion').reason, 'cannot_afford');
assert.equal(buyWeapon(p, 'railgun').reason, 'unknown_weapon');
assert.equal(buyWeapon(p, 'burst').reason, 'already_owned');
p = { ...p, wallet: { ...p.wallet, credits: 5000 } };
let bought = buyWeapon(p, 'ion');
assert.ok(bought.ok);
assert.equal(bought.player.wallet.credits, 5000 - WEAPON_PRICES.ion);
assert.deepEqual(shipLoadout(bought.player), ['burst', 'heavy'], 'no free slot: it waits in storage');
let fit = equipWeapon(bought.player, 1, 'ion');
assert.ok(fit.ok);
assert.deepEqual(shipLoadout(fit.player), ['burst', 'ion']);
fit = equipWeapon(fit.player, 0, 'ion');
assert.deepEqual(shipLoadout(fit.player), ['ion', 'burst'], 'fitting a gun that is already fitted swaps it');
assert.equal(equipWeapon(fit.player, 2, 'heavy').reason, 'no_slot');
assert.equal(equipWeapon(fit.player, 0, 'beam').reason, 'not_owned');
// A third slot takes a new gun straight away.
const three = { ...p, ship: { ...p.ship, systems: { ...p.ship.systems, weapons: 4 } } };
bought = buyWeapon(three, 'missile');
assert.deepEqual(shipLoadout(bought.player), ['burst', 'heavy', 'missile']);
// Weapons fitted beyond the slots (an old save) are ignored, not lost.
const tampered = { ...p, ship: { ...p.ship, armory: ['ion', 'beam'], loadout: ['ion', 'beam', 'burst'] } };
assert.deepEqual(shipLoadout(tampered), ['ion', 'beam']);
assert.deepEqual(shipLoadout({ ...p, ship: { ...p.ship, loadout: ['beam'] } }), ['burst', 'heavy'], 'unowned guns fall back to the starting pair');
// Saves keep the armory through migration.
const kept = migratePlayer({ ...bought.player });
assert.deepEqual(kept.ship.armory, ['missile']);
assert.deepEqual(shipLoadout(kept), ['burst', 'heavy', 'missile']);

// The weapons room shows slots, storage and prices.
const html = renderArmory(fit.player);
assert.ok(html.includes('2/2 slots fitted'));
assert.ok(html.includes('data-act="weapon-buy" data-weapon="missile"'));
assert.ok(html.includes('Slot 1'));
for (const id of Object.keys(WEAPON_CATALOG)) assert.ok(html.includes(WEAPON_CATALOG[id].name), id);

// Drydock text names the fight effects.
assert.match(systemStat('weapons', 4), /3 slots/);
assert.match(systemStat('shields', 6), /2 layers/);
assert.match(systemStat('engines', 3), /Dodge \+2%/);
assert.match(systemStat('sensors', 2), /Aim \+2%/);

console.log('ship weapons ok');
