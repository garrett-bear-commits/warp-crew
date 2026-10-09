// Crew families: two or four of a family aboard give a fight bonus (crew-matter design §6).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAMILIES, familyOf, familyTiers } from '../src/data/families.js';
import { CREW_CATALOG, STARTER_CAPTAINS } from '../src/data/crewRoster.js';
import * as F from '../src/systems/ftlCombat.js';
import { fightSalvagePct } from '../src/systems/contractRewards.js';

const C = (id, role, station, kit, grade = 0.1, bonus = 0.02) => ({ id, role, station, kit, grade, bonus });
const start = crew => F.startFtlEncounter({ acceptanceId: 'f', encounterId: 'x', seed: 21, threat: 1, crew });

test('every hireable merc belongs to one family; captains are freelance', () => {
  for (const t of CREW_CATALOG) {
    if (STARTER_CAPTAINS.includes(t.id)) assert.equal(familyOf(t.id), null);
    else assert.ok(FAMILIES[familyOf(t.id)], `${t.id} (${t.faction}) has a family`);
  }
  assert.deepEqual(familyTiers(['merc_bolt', 'merc_nub']), { yards: 1 });
  assert.deepEqual(familyTiers(['merc_bolt', 'merc_nub', 'merc_cog', 'merc_tink']), { yards: 2 });
  assert.deepEqual(familyTiers(['merc_bolt', 'merc_rex']), {}, 'one of a family is no bonus');
});

test('two of the Yards repair faster; four start their moves at 75%', () => {
  const lone = start([C('a', 'engineer', 'engineering', 'merc_bolt'), C('b', 'gunner', 'weapons', 'merc_jen')]);
  const pair = start([C('a', 'engineer', 'engineering', 'merc_bolt'), C('b', 'engineer', 'weapons', 'merc_nub')]);
  for (const s of [lone, pair]) { s.rooms.engineering.integrity = 40; s.shields.layers = 3; s.shields.max = 1; }
  // Same damage, one beat of repair; shields up so nothing new lands.
  const repaired = s => { const c = structuredClone(s); c.shields.max = 1; c.shields.layers = 1; return F.advanceFtlEncounter(c).state.rooms.engineering.integrity; };
  assert.ok(repaired(pair) > repaired(lone), 'the Yards pair repairs faster');
  const four = start(['merc_bolt', 'merc_nub', 'merc_cog', 'merc_tink'].map((k, i) => C(`y${i}`, 'engineer', null, k)));
  assert.ok(four.crew.every(c => c.charge === 75));
  assert.ok(F.validFtlBody(four));
});

test('the Unbound start charged; Free Wings crit more; the Survey aims better; Haulers salvage more', () => {
  const unbound2 = start([C('e', 'gunner', 'weapons', 'merc_eclipse', 0.64, 0.16), C('n', 'scout', null, 'merc_nemi', 0.1, 0.05)]);
  assert.ok(unbound2.crew.every(c => c.charge === 65));
  const unbound4 = start([C('e', 'gunner', 'weapons', 'merc_eclipse', 0.64, 0.16), C('n', 'scout', null, 'merc_nemi', 0.1, 0.05),
    C('p', 'engineer', null, 'merc_prism', 0.46, 0.2), C('v', 'pilot', 'helm', 'merc_voidwake', 0.88, 1.4)]);
  assert.ok(unbound4.crew.every(c => c.charge === 100));
  assert.ok(F.validFtlBody(unbound4));
  const wings = start([C('k', 'gunner', 'weapons', 'merc_kira', 0.12, 0.05), C('d', 'gunner', null, 'merc_dax', 0.06, 0.025)]);
  assert.equal(Math.round(F.critChance(wings) * 1000), Math.round((0.05 + 0.03) * 1000));
  const survey = start([C('j', 'scout', null, 'merc_juno', 0.04, 0), C('b', 'scout', null, 'merc_brink', 0.1, 0)]);
  const solo = start([C('j', 'scout', null, 'merc_juno', 0.04, 0), C('r', 'pilot', 'helm', 'merc_rex', 0.04, 0)]);
  assert.equal(F.enemyEvasion(solo) - F.enemyEvasion(survey), 5);
  const haulers = start([C('r', 'pilot', 'helm', 'merc_rex', 0.04, 0), C('t', 'pilot', null, 'merc_tess', 0.04, 0.15)]);
  assert.equal(fightSalvagePct(haulers), 10);
});
