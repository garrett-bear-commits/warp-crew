// Regressions for the 2026-10-09 independent review of crew kits (docs/audits/2026-10-09-crew-kits-review.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as F from '../src/systems/ftlCombat.js';
import { fightSalvagePct } from '../src/systems/contractRewards.js';

const C = (id, role, station, kit, grade = 0.3, bonus = 0.05) => ({ id, role, station, kit, grade, bonus });
const tap = (s, crewId) => { const c = structuredClone(s); c.crew.find(m => m.id === crewId).charge = 100; return F.applyFtlCommand(c, { type: 'ability', crewId }).state; };

test('1. a fight that ends before any tick after Four-Arm Oath expires still saves valid', () => {
  for (const finisher of ['board', 'freeShot']) {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const crew = [C('v', 'security', 'shields', 'merc_vorn', 0.3, 0.06), C('x', 'gunner', 'weapons', 'merc_vex', 0.3, 0.05)];
      let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'pirate_wing', seed, threat: 0.6, crew, tactics: ['board'], enemyHull: 21, loadout: ['ion'] });
      s = F.applyFtlCommand(tap(s, 'v'), { type: 'hold', hold: true }).state;
      for (let i = 0; i < 6; i++) s = F.advanceFtlEncounter(s).state;
      if (s.result !== null || s.shields.layers !== 2) continue;
      if (finisher === 'board') s = F.advanceFtlEncounter(s, 'board').state;
      else { s.enemy.hull = 4; s = F.advanceFtlEncounter(tap(s, 'x')).state; }
      if (s.result === null) continue;
      found = true;
      assert.ok(F.validFtlBody(s), `${finisher} at seed ${seed}: the finished fight is a valid save`);
      assert.ok(s.shields.layers <= s.shields.max, 'the extra layer is gone once the oath ends');
    }
    assert.ok(found, `${finisher}: the scenario was reached`);
  }
});

test('2. the validator only accepts ability state the crew aboard could produce', () => {
  const s = F.advanceFtlEncounter(F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 5, threat: 1, auto: true,
    crew: [C('t', 'trader', null, 'merc_plip', 0.02, 0.05), C('g', 'gunner', 'weapons', 'merc_jen', 0.06, 0.02)] })).state;
  assert.ok(F.validFtlBody(s));
  const bad = {
    'a trader kit swapped for the Apex pilot': x => { x.crew[0].kit = 'merc_voidwake'; },
    'a trader with a 200% passive': x => { x.crew[0].bonus = 2; },
    'salvage with no salvage move aboard': x => { x.fx.salvage = 100; x.fx.salvageUsed = true; },
    'sure hits with no sure-hit move aboard': x => { x.fx.sureHit = { n: 10, roomPct: 50, crit: true, splash: true }; },
    'dodges with no dodge move aboard': x => { x.fx.dodgeNext = 10; },
    'pierce with no pierce move aboard': x => { x.fx.pierce = 10; },
    'evade with no evade move aboard': x => { x.fx.evade = { bonus: 100, through: x.beat + 30, dodgeCharge: 0 }; },
  };
  for (const [name, edit] of Object.entries(bad)) {
    const x = structuredClone(s);
    edit(x);
    assert.equal(F.validFtlBody(x), false, `rejected: ${name}`);
  }
  // A real salvage move aboard may carry its salvage (plus the trader passive): bounded, not +300%.
  const moth = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 5, threat: 1, crew: [C('m', 'trader', null, 'merc_moth', 0.16, 0.14)] });
  const sold = F.advanceFtlEncounter(tap(moth, 'm')).state;
  assert.ok(F.validFtlBody(sold));
  assert.ok(fightSalvagePct(sold) <= 60);
});

test('3. a weaker cast never replaces a stronger effect that is still running', () => {
  const crew = [C('nyx', 'scout', null, 'merc_nyx'), C('rex', 'pilot', 'helm', 'merc_rex')];
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 9, threat: 1, crew });
  s = tap(tap(s, 'nyx'), 'rex');
  s = F.advanceFtlEncounter(s).state;
  assert.equal(s.fx.evade.bonus, 100, 'the Hallway Moved keeps its full dodge');
  const zephyr = [C('z', 'pilot', null, 'merc_zephyr', 0.44, 1), C('rex', 'pilot', 'helm', 'merc_rex')];
  let z = F.advanceFtlEncounter(tap(F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 9, threat: 1, crew: zephyr }), 'z')).state;
  z = F.advanceFtlEncounter(tap(z, 'rex')).state;
  assert.equal(z.fx.evade.bonus, 40);
  assert.equal(z.fx.evade.dodgeCharge, 15, 'the dodge charge keeps running');
});

test('4. The Hallway Moved: every enemy shot misses, even with a wrecked helm', () => {
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 3, threat: 1.4, crew: [C('nyx', 'scout', null, 'merc_nyx')] });
  s.rooms.helm.integrity = 0;
  s.shields.layers = 0;
  for (const w of s.enemy.weapons) w.progressMs = w.chargeMs - 1;
  const r = F.advanceFtlEncounter(tap(s, 'nyx'));
  const incoming = r.events.filter(e => e.from === 'enemy');
  assert.ok(incoming.length > 0);
  assert.ok(incoming.every(e => e.outcome === 'miss'), 'nothing lands while it runs');
});

test('5. Later holds the hull against a failed boarding party too', () => {
  for (let seed = 1; seed < 300; seed++) {
    let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed, threat: 1.6, tactics: ['board'], crew: [C('sol', 'medic', null, 'merc_solace', 0.44, 0.14)] });
    s.hull = 30;
    s = F.advanceFtlEncounter(tap(s, 'sol')).state;
    s.enemy.hull = 20;
    s.hull = 26;
    const r = F.advanceFtlEncounter(s, 'board');
    if (r.state.tactics.board.success !== false) continue;
    assert.ok(r.state.hull >= 25, `seed ${seed}: the hull holds at the line (got ${r.state.hull})`);
    assert.equal(r.state.result, null);
    return;
  }
  assert.fail('no failed boarding found');
});

test('6. Cold Read is not spent by missiles (they already pass shields)', () => {
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 4, threat: 1, loadout: ['missile'], crew: [C('q', 'scout', null, 'merc_quill', 0.16, 0.08)] });
  s.enemy.shields.layers = 1;
  s.weapons[0].chargeMs = F.WEAPON_CATALOG.missile.chargeMs;
  const r = F.advanceFtlEncounter(tap(s, 'q'));
  assert.ok(r.events.some(e => e.from === 'player' && e.weapon === 'missile'));
  assert.equal(r.state.fx.pierce, 3, 'all three pierces are still there');
});

test('7. targeting sees Editing take their last shield away', () => {
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 4, threat: 1, crew: [C('ar', 'engineer', null, 'merc_archon', 0.68, 0.26)] });
  assert.equal(s.enemy.shields.max, 1);
  s = F.advanceFtlEncounter(tap(s, 'ar')).state;
  assert.equal(F.autoTarget(s), 'weapons', 'no shield left to break');
  const step = F.ftlPolicyStep(s, 'smart');
  assert.ok(!step.commands.some(c => c.type === 'hold' && c.hold === true), 'the smart captain stops holding volleys');
});

test('8. stacking sure-hit moves keeps the better shots', () => {
  const crew = [C('hex', 'gunner', 'weapons', 'merc_hex', 0.2, 0.08), C('juno', 'scout', null, 'merc_juno', 0.04, 0.03)];
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 4, threat: 1, crew });
  s = F.advanceFtlEncounter(tap(tap(s, 'hex'), 'juno')).state;
  assert.equal(s.fx.sureHit.crit, true, "HEX-19's crits survive Juno's cast");
});

test('9. the enemy charge bar stands still while their guns are bribed', () => {
  let s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 4, threat: 1, crew: [C('p', 'trader', null, 'merc_plip', 0.02, 0.05)] });
  s = F.advanceFtlEncounter(tap(s, 'p')).state;
  assert.equal(F.enemyChargePerBeat(s), 0);
});

test('10. fights without kits report enemy hit damage exactly as before', () => {
  const s = F.startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 8, threat: 1.6, hull: 2, crew: [{ id: 'p', role: 'pilot', station: 'helm' }] });
  let st = s;
  for (let i = 0; i < 40 && st.result === null; i++) {
    const r = F.advanceFtlEncounter(st);
    for (const e of r.events.filter(x => x.from === 'enemy' && x.outcome === 'hit')) {
      assert.equal(e.damage, st.enemy.weapons.find(w => w.id === e.weapon).damage, 'damage is the weapon damage');
    }
    st = r.state;
    if (st.phase === 'downed') break;
  }
});

test('2b. a saved fight cannot swap a fighter for a stronger merc than the one on the roster', async () => {
  const { kitCrewMatchesRoster, crewGrade } = await import('../src/systems/encounterState.js');
  const player = { crew: [{ instanceId: 'a', templateId: 'merc_plip', role: 'trader', power: 9, passive: { tradeCredits: 0.05 } }] };
  const fight = F.startFtlEncounter({ acceptanceId: 'x', encounterId: 'x', seed: 1, threat: 1,
    crew: [{ id: 'a', role: 'trader', station: null, kit: 'merc_plip', grade: crewGrade(9), bonus: 0.05 }] });
  assert.equal(kitCrewMatchesRoster(player, fight), true);
  const swapped = structuredClone(fight);
  Object.assign(swapped.crew[0], { kit: 'merc_voidwake', role: 'pilot', grade: 1 });
  assert.equal(kitCrewMatchesRoster(player, swapped), false);
  // Grade is not tied to today's power: power is recomputed on load and a fight must survive that.
  const reloaded = structuredClone(fight);
  reloaded.crew[0].grade = 0.3;
  assert.equal(kitCrewMatchesRoster(player, reloaded), true);
  const ascended = structuredClone(fight);
  ascended.crew[0].tier = 3;
  assert.equal(kitCrewMatchesRoster(player, ascended), false);
});
