// Crew kits in FTL-lite fights: signature moves, real passives, Auto, save validation.
// Design: docs/superpowers/specs/2026-10-09-crew-matter-design.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  startFtlEncounter, advanceFtlEncounter, applyFtlCommand, validFtlBody, ftlPolicyStep, manning, playerEvasion,
  enemyEvasion, critChance, kitFight, abilityUseful, enemyLoadout, enemyStartHull, KIT_ENEMY, ENEMY_HULL, MAX_FIGHT_BEATS,
  playerShieldCap,
} from '../src/systems/ftlCombat.js';
import { CREW_KITS, ROLE_MOVES, EFFECT_TYPES, kitFor } from '../src/data/crewKits.js';
import { CREW_CATALOG } from '../src/data/crewRoster.js';
import { fightSalvagePct } from '../src/systems/contractRewards.js';
import { crewGrade, fightingCrew } from '../src/systems/encounterState.js';

const clone = value => structuredClone(value);
const C = (id, role, station, kit, grade = 0.1, bonus = 0) => ({ id, role, station, ...(kit ? { kit, grade, bonus } : {}) });
const TEAM = [C('p', 'pilot', 'helm', 'merc_rex', 0.04), C('g', 'gunner', 'weapons', 'merc_jen', 0.06, 0.02), C('e', 'engineer', 'engineering', 'merc_bolt', 0.04, 0.05)];
const start = (crew = TEAM, extra = {}) => startFtlEncounter({ acceptanceId: 'k', encounterId: 'pirate_wing', seed: 99, threat: 1, crew, ...extra });

/** Charge one crew member, tap them, play one beat. */
function cast(state, crewId) {
  const s = clone(state);
  s.crew.find(c => c.id === crewId).charge = 100;
  const tapped = applyFtlCommand(s, { type: 'ability', crewId });
  assert.equal(tapped.ok, true, tapped.reason);
  const r = advanceFtlEncounter(tapped.state);
  assert.ok(validFtlBody(r.state), 'state after a cast is valid');
  assert.ok(r.events.some(e => e.type === 'ability' && e.crewId === crewId), 'the cast is an event');
  return r;
}

test('every merc has a kit built only from known effects', () => {
  for (const template of CREW_CATALOG) {
    const kit = kitFor(template.id, template.role);
    assert.ok(kit, `${template.id} has a kit`);
    assert.ok(kit.move && kit.charge >= 10 && kit.charge <= 30, `${template.id} move and charge`);
    for (const effect of kit.effects) assert.ok(EFFECT_TYPES.includes(effect.type), `${template.id} effect ${effect.type}`);
  }
  for (const id of Object.keys(CREW_KITS)) assert.ok(CREW_CATALOG.some(t => t.id === id), `${id} is a real merc`);
  for (const template of CREW_CATALOG.filter(t => !['common'].includes(t.rarity))) {
    assert.ok(CREW_KITS[template.id], `${template.id} (${template.rarity}) has its own move`);
  }
  assert.equal(kitFor('captain_gunner', 'gunner'), ROLE_MOVES.gunner, "a captain's order is the role's standard move");
});

test('a fight without kits plays exactly as before (no fx, no abilities, flat mastery)', () => {
  const legacy = start([C('p', 'pilot', 'helm'), C('g', 'gunner', 'weapons')]);
  assert.equal(kitFight(legacy), false);
  assert.ok(!Object.hasOwn(legacy, 'fx') && !Object.hasOwn(legacy.intent, 'cast') && !Object.hasOwn(legacy.intent, 'auto'));
  assert.equal(manning(legacy, 'helm'), 1.3);
  assert.equal(legacy.enemy.hull, ENEMY_HULL);
  assert.equal(applyFtlCommand(legacy, { type: 'auto', auto: true }).ok, false);
  assert.ok(validFtlBody(legacy));
});

test('a kit fight starts half charged, with tougher enemies and grade-scaled mastery', () => {
  const s = start();
  assert.equal(kitFight(s), true);
  assert.deepEqual(s.fx, {});
  assert.deepEqual(s.intent.cast, []);
  assert.equal(s.intent.auto, false);
  assert.ok(s.crew.every(c => c.charge === 50));
  assert.equal(s.enemy.hull, KIT_ENEMY.hull);
  assert.equal(enemyStartHull(s), KIT_ENEMY.hull);
  assert.equal(s.enemy.weapons[0].damage, enemyLoadout(1, { kits: true }).weapons[0].damage);
  assert.ok(enemyLoadout(1, { kits: true }).weapons[0].damage > enemyLoadout(1).weapons[0].damage);
  const strong = start([C('p', 'pilot', 'helm', 'merc_harrow', 0.46)]);
  assert.ok(manning(strong, 'helm') > manning(s, 'helm'), 'a better pilot runs the helm better');
  assert.ok(playerEvasion(strong) > playerEvasion(s), 'and dodges more');
  assert.ok(validFtlBody(s));
});

test('commands: tap only a charged kit, never twice; Auto toggles', () => {
  const s = start();
  assert.equal(applyFtlCommand(s, { type: 'ability', crewId: 'p' }).reason, 'not_ready');
  assert.equal(applyFtlCommand(s, { type: 'ability', crewId: 'nobody' }).reason, 'unknown_crew');
  const charged = clone(s);
  charged.crew[0].charge = 100;
  const once = applyFtlCommand(charged, { type: 'ability', crewId: 'p' });
  assert.equal(once.ok, true);
  assert.equal(applyFtlCommand(once.state, { type: 'ability', crewId: 'p' }).reason, 'already_queued');
  assert.ok(validFtlBody(once.state));
  const auto = applyFtlCommand(s, { type: 'auto', auto: true });
  assert.equal(auto.state.intent.auto, true);
});

test('abilities charge every beat, faster with a medic aboard', () => {
  let s = start();
  s = advanceFtlEncounter(s).state;
  const rexGain = s.crew[0].charge - 50;
  assert.ok(rexGain > 0);
  let withMedic = start([...TEAM, C('m', 'medic', null, 'merc_solace', 0.44, 0.14)]);
  withMedic = advanceFtlEncounter(withMedic).state;
  assert.ok(withMedic.crew[0].charge - 50 > rexGain, 'a medic speeds every charge');
});

test('signature moves do what they say', () => {
  const base = start([...TEAM,
    C('kira', 'gunner', null, 'merc_kira', 0.12, 0.05), C('quill', 'scout', null, 'merc_quill', 0.16, 0.08),
    C('vex', 'gunner', null, 'merc_vex', 0.2, 0.09), C('drift', 'pilot', null, 'merc_drift', 0.18, 0.5),
    C('vorn', 'security', null, 'merc_vorn', 0.2, 0.1), C('isa', 'medic', null, 'merc_isa', 0.18, 0.08),
    C('plip', 'trader', null, 'merc_plip', 0.02, 0.05), C('syla', 'trader', null, 'merc_syla', 0.08, 0.1),
    C('skarn', 'security', null, 'merc_skarn', 0.32, 0.15), C('wisp', 'scout', null, 'merc_wisp', 0.28, 0.12),
    C('ashen', 'security', null, 'merc_ashen', 0.32, 0.16), C('solace', 'medic', null, 'merc_solace', 0.44, 0.14),
    C('moth', 'trader', null, 'merc_moth', 0.16, 0.14), C('archon', 'engineer', null, 'merc_archon', 0.68, 0.26),
    C('voidwake', 'pilot', null, 'merc_voidwake', 0.88, 1.4), C('eclipse', 'gunner', null, 'merc_eclipse', 0.64, 0.16),
    C('ada', 'medic', null, 'merc_ada', 0.28, 0.1), C('reed', 'scout', null, 'merc_reed', 0.16, 0.085),
  ]);

  // Hot Barrels: guns gain charge.
  const hot = cast(base, 'g');
  assert.ok(hot.state.weapons.every((w, i) => w.chargeMs > base.weapons[i].chargeMs + 1000));

  // Short Fuse: the next volley fires an extra shot.
  assert.equal(cast(base, 'kira').state.fx.extraShots, 1);

  // Cold Read: shots slip through shields.
  assert.equal(cast(base, 'quill').state.fx.pierce, 3);

  // The Note Lands: a free shot through shields.
  const vex = cast(base, 'vex');
  const free = vex.events.filter(e => e.type === 'shot' && e.weapon === 'ability');
  assert.equal(free.length, 1);
  assert.equal(free[0].damage, 6, 'six damage, through shields');
  assert.ok(base.enemy.hull - vex.state.enemy.hull >= 6);

  // Borrowed Wind: the next enemy shots miss.
  const drift = cast(base, 'drift');
  const dodged = drift.events.filter(e => e.from === 'enemy' && e.dodge).length;
  assert.equal(dodged + drift.state.fx.dodgeNext, 2, 'two enemy shots will miss');

  // Four-Arm Oath: a layer above max while it runs, and the save stays valid.
  const vorn = cast(base, 'vorn');
  assert.equal(playerShieldCap(vorn.state), vorn.state.shields.max + 1);
  assert.ok(vorn.state.shields.layers <= vorn.state.shields.max + 1);

  // Field Surgery: hull back.
  const hurt = clone(base);
  hurt.hull = 50;
  const isa = cast(hurt, 'isa');
  assert.ok(isa.events.some(e => e.type === 'hull_patch' && e.amount === 8));

  // Bribe the Gunner: enemy guns stop charging.
  const plip = cast(base, 'plip');
  assert.deepEqual(plip.state.enemy.weapons.map(w => w.progressMs), base.enemy.weapons.map(w => w.progressMs));

  // Harmonic Haggle: a shield layer down.
  assert.ok(cast(base, 'syla').state.enemy.shields.layers < base.enemy.shields.max);

  // Cleave Along the Grain: the targeted room takes the hit.
  const skarn = cast(base, 'skarn');
  assert.ok(skarn.events.some(e => e.type === 'strike' && e.damage === 4));

  // Already in the Room: the targeted room goes offline.
  const wisp = cast(base, 'wisp');
  const target = wisp.events.find(e => e.type === 'strike').room;
  assert.ok(wisp.state.enemy.rooms[target].integrity < 20);

  // The Interesting Part: enemy hits halved.
  assert.equal(cast(base, 'ashen').state.fx.brace.through, base.beat + 5, 'brace runs five beats from the cast');

  // Later: once per fight the hull holds.
  const low = clone(base);
  low.hull = 30;
  const solace = cast(low, 'solace');
  assert.equal(solace.state.fx.lastStandUsed, true);
  let held = solace.state;
  for (let i = 0; i < 6 && held.result === null; i++) held = advanceFtlEncounter(held).state;
  assert.ok(held.hull >= Math.min(25, 30) || held.result === 'win', 'the hull does not drop below the hold line');

  // Already Sold It: salvage on a win.
  const moth = cast(base, 'moth');
  assert.equal(moth.state.fx.salvage, 20);
  assert.equal(fightSalvagePct(moth.state), Math.round(0.14 * 100 + 20), 'the best trader passive plus the move');

  // Editing: the enemy loses a shield layer of maximum for the fight.
  const archon = cast(base, 'archon');
  assert.equal(archon.state.fx.enemyShieldDown, 1);

  // Revoke Distance: their guns back to zero, ours full.
  const voidwake = cast(base, 'voidwake');
  assert.ok(voidwake.events.some(e => e.type === 'rewind'));

  // Hunt Instinct: drone volley and a fire in their weapons room.
  const eclipse = cast(base, 'eclipse');
  assert.equal(eclipse.events.filter(e => e.weapon === 'ability').length, 3);
  assert.ok(eclipse.events.some(e => e.type === 'fire_start' && e.side === 'enemy' && e.room === 'weapons'));

  // I Feel It: everyone else charges up.
  const ada = cast(base, 'ada');
  assert.ok(ada.state.crew.filter(c => c.id !== 'ada').every(c => c.charge === 100), 'every other move jumps from half to full');

  // Floor Plan: the targeted room takes double damage for a while.
  assert.equal(cast(base, 'reed').state.fx.weak.mult, 2);
});

test('Cold Read shots pass shields; Borrowed Wind dodges the next enemy shots', () => {
  // Their shield is up and our guns are ready: pierced shots hit the hull and leave the layer standing.
  const q = start([C('g', 'gunner', 'weapons', 'merc_jen', 0.06, 0), C('quill', 'scout', null, 'merc_quill', 0.16, 0)]);
  q.enemy.shields.layers = 1;
  q.enemy.rooms.engines.integrity = 0; // nothing dodges, so every shot lands
  for (const w of q.weapons) w.chargeMs = 11000;
  const pierced = cast(q, 'quill');
  const hits = pierced.events.filter(e => e.from === 'player' && e.outcome === 'hit');
  assert.ok(hits.length >= 3, 'three shots get through');
  assert.equal(pierced.events.filter(e => e.from === 'player' && e.outcome === 'shield').length, 0, 'none spent on the shield');

  // Their guns are about to fire at an unshielded Sparrow: both shots of the volley miss.
  const d = start([C('drift', 'pilot', null, 'merc_drift', 0.18, 0.5)]);
  d.shields.layers = 0;
  d.rooms.shields.integrity = 0; // shields down and staying down
  for (const w of d.enemy.weapons) w.progressMs = w.chargeMs - 1;
  const dodge = cast(d, 'drift');
  const incoming = dodge.events.filter(e => e.from === 'enemy');
  assert.ok(incoming.length >= 2);
  assert.equal(incoming.filter(e => e.dodge).length, 2, 'the next two enemy shots miss');
});

test('a free shot can finish the fight', () => {
  const s = start([C('vex', 'gunner', 'weapons', 'merc_vex', 0.2, 0.09)]);
  s.enemy.hull = 4;
  const r = cast(s, 'vex');
  assert.equal(r.state.result, 'win');
  assert.equal(r.state.enemy.hull, 0);
});

test('real passives: gunners crit, scouts aim, traders salvage', () => {
  const s = start([C('g', 'gunner', 'weapons', 'merc_onyx', 0.48, 0.12), C('s', 'scout', null, 'merc_wisp', 0.28, 0.12)]);
  assert.equal(critChance(s), 0.12);
  const blind = start([C('g', 'gunner', 'weapons', 'merc_onyx', 0.48, 0.12)]);
  assert.equal(enemyEvasion(blind) - enemyEvasion(s), 12, 'a scout aboard takes their bonus off enemy evasion');
  let crits = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let f = startFtlEncounter({ acceptanceId: 'c', encounterId: 'x', seed, threat: 0.8, crew: [C('g', 'gunner', 'weapons', 'merc_onyx', 0.48, 0.5)] });
    for (let i = 0; i < 40 && f.result === null; i++) {
      const r = advanceFtlEncounter(f);
      crits += r.events.filter(e => e.crit).length;
      f = r.state;
    }
  }
  assert.ok(crits > 0, 'crit chance produces crits');
  assert.equal(fightSalvagePct(start([C('t', 'trader', null, 'merc_lora', 0.26, 0.18)])), 18);
  assert.equal(fightSalvagePct(start([C('t', 'trader', null)])), 0, 'no kit, no passive');
});

function playOut(state, { policy = 'smart', reloadAt = -1 } = {}) {
  let s = state;
  let abilities = 0;
  for (let i = 0; i < MAX_FIGHT_BEATS && s.result === null; i++) {
    if (s.phase === 'downed') { s = advanceFtlEncounter(s, 'concede').state; break; }
    if (i === reloadAt) s = JSON.parse(JSON.stringify(s));
    for (const command of ftlPolicyStep(s, policy).commands) { const r = applyFtlCommand(s, command); if (r.ok) s = r.state; }
    const r = advanceFtlEncounter(s);
    assert.ok(validFtlBody(r.state), `beat ${r.state.beat} valid`);
    abilities += r.events.filter(e => e.type === 'ability').length;
    s = r.state;
  }
  return { s, abilities };
}

test('Auto casts abilities, deterministically, and a mid-fight reload changes nothing', () => {
  const auto = start(TEAM, { auto: true });
  const a = playOut(auto);
  const b = playOut(auto, { reloadAt: 9 });
  assert.ok(a.abilities > 0, 'Auto used abilities');
  assert.deepEqual(a.s, b.s, 'same seed, same fight; reload is transparent');
  const manual = playOut(start(TEAM));
  assert.equal(manual.abilities, 0, 'Auto off and no taps: no abilities');
});

test('a better crew wins more often (crew-matter success test 2)', () => {
  const common = TEAM;
  const legend = [TEAM[0], C('g', 'gunner', 'weapons', 'merc_onyx', 0.48, 0.12), TEAM[2]];
  const rate = crew => {
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) wins += playOut(startFtlEncounter({ acceptanceId: 'r', encounterId: 'x', seed: seed * 7919, threat: 1.3, crew, auto: true })).s.result === 'win';
    return wins / 60;
  };
  const gap = rate(legend) - rate(common);
  assert.ok(gap >= 0.15, `a Legendary gunner adds at least 15 points on a Dangerous fight (got ${Math.round(gap * 100)})`);
});

test('the validator rejects edited ability state', () => {
  const s = advanceFtlEncounter(start(TEAM, { auto: true })).state;
  assert.ok(validFtlBody(s));
  const bad = [
    x => { x.crew[0].charge = 101; },
    x => { x.intent.cast = ['p']; x.crew[0].charge = 60; },
    x => { x.intent.cast = ['p', 'p']; x.crew[0].charge = 100; },
    x => { x.fx.godMode = true; },
    x => { x.fx.evade = { bonus: 25, through: x.beat + 500, dodgeCharge: 0 }; },
    x => { x.fx.evade = { bonus: 250, through: x.beat, dodgeCharge: 0 }; },
    x => { x.fx.extraShots = 9; },
    x => { x.fx.lastStand = { hold: 25, through: x.beat }; },
    x => { x.shields.layers = x.shields.max + 1; },
    x => { x.crew[0].grade = 3; },
    x => { x.crew[0].kit = 'merc_nobody_xx'; x.crew[0].role = 'nobody'; },
    x => { delete x.fx; },
    x => { delete x.intent.auto; },
    x => { x.enemy.weapons[0].damage -= 1; },
    x => { x.enemy.hull = KIT_ENEMY.hull + 1; },
  ];
  for (const [i, edit] of bad.entries()) {
    const x = clone(s);
    edit(x);
    assert.equal(validFtlBody(x), false, `edit ${i} is rejected`);
  }
  // A legacy fight cannot smuggle a kit in.
  const legacy = clone(start([C('p', 'pilot', 'helm')]));
  legacy.crew[0] = { ...legacy.crew[0], kit: 'merc_rex', grade: 0.1, bonus: 0, charge: 50 };
  assert.equal(validFtlBody(legacy), false);
});

test('Auto only fires a move when it would help', () => {
  const s = start([C('e', 'engineer', 'engineering', 'merc_bolt', 0.04, 0.05)]);
  s.crew[0].charge = 100;
  assert.equal(abilityUseful(s, s.crew[0]), false, 'Patch Job waits while every room is whole');
  s.rooms.weapons.integrity = 40;
  assert.equal(abilityUseful(s, s.crew[0]), true);
});

test('fight grade and kits come from the crew instance', () => {
  assert.equal(crewGrade(10), 0.04);
  assert.equal(crewGrade(30), 0.44);
  assert.equal(crewGrade(100), 1);
  const player = {
    crew: [{ instanceId: 'a', templateId: 'merc_kira', role: 'gunner', power: 14, passive: { critChance: 0.05 }, status: 'ready' }],
    crewSlots: 2, stationAssignments: { a: 'weapons' },
  };
  const [kira] = fightingCrew(player, 0, { kits: true });
  assert.deepEqual({ kit: kira.kit, grade: kira.grade, bonus: kira.bonus }, { kit: 'merc_kira', grade: 0.12, bonus: 0.05 });
  assert.ok(!Object.hasOwn(fightingCrew(player, 0)[0], 'kit'), 'without kits the old shape');
});
