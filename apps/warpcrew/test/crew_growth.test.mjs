// After the hire: level caps by stars, shards from duplicates past 5 stars, Ascension (crew-matter design §5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCrewInstance, recomputeCrew, levelCap, ASCENSION, crewPowerOf, catalogById } from '../src/data/crewRoster.js';
import { applyPullToRoster, levelCrew, ascendCrew, ascensionStatus } from '../src/systems/gacha.js';
import { fightingCrew } from '../src/systems/encounterState.js';
import { startFtlEncounter, abilityChargeBeats, validFtlBody } from '../src/systems/ftlCombat.js';

test('level caps rise with stars and Ascension; a maxed Common no longer out-powers the Apex', () => {
  assert.equal(levelCap({ stars: 1 }), 10);
  assert.equal(levelCap({ stars: 5 }), 30);
  assert.equal(levelCap({ stars: 5, ascension: 3 }), 60);
  const kira = createCrewInstance('merc_kira', { instanceId: 'k' });
  let player = { crew: [{ ...kira, level: 10 }], wallet: { medals: 1e6 } };
  assert.equal(levelCrew(player, 'k').reason, 'level_cap');
  player = { crew: [{ ...kira, level: 9 }], wallet: { medals: 1e6 } };
  assert.equal(levelCrew(player, 'k').ok, true);
  const common1Star = crewPowerOf(catalogById('merc_rex'), { level: levelCap({ stars: 1 }) });
  assert.ok(common1Star < catalogById('merc_voidwake').basePower, 'a 1-star Common at its cap stays below a fresh Apex');
});

test('duplicates past 5 stars become shards; shards and medals buy Ascension', () => {
  const five = recomputeCrew({ ...createCrewInstance('merc_kira', { instanceId: 'k' }), stars: 5 });
  let player = { crew: [five], crewSlots: 3, reserve: [], wallet: { medals: 2000, credits: 0 } };
  assert.equal(ascensionStatus(player.crew[0], player.wallet).reason, 'needs_shards');
  for (let i = 0; i < 2; i++) {
    const r = applyPullToRoster(player, createCrewInstance('merc_kira', { instanceId: `dupe${i}` }));
    assert.equal(r.kind, 'shard', 'a copy past 5 stars is a shard, not a sale');
    player = r.player;
  }
  assert.equal(player.crew[0].shards, 2);
  assert.equal(player.wallet.credits, 0, 'nothing was sold');
  const up = ascendCrew(player, 'k');
  assert.equal(up.ok, true, up.reason);
  assert.equal(up.crew.ascension, 1);
  assert.equal(up.crew.shards, 0);
  assert.equal(up.player.wallet.medals, 2000 - ASCENSION[1].medals);
  assert.ok(up.crew.power > player.crew[0].power);
  assert.equal(levelCap(up.crew), 40);
  assert.equal(ascendCrew({ ...player, crew: [{ ...five, stars: 4 }] }, 'k').reason, 'needs_5_stars');
});

test('an ascended merc brings their tier into the fight: the move charges 2 beats faster per step', () => {
  const vet = recomputeCrew({ ...createCrewInstance('merc_kira', { instanceId: 'v' }), stars: 5, ascension: 2 });
  const [fighter] = fightingCrew({ crew: [vet], crewSlots: 2, stationAssignments: { v: 'weapons' } }, 0, { kits: true });
  assert.equal(fighter.tier, 2);
  const fight = startFtlEncounter({ acceptanceId: 'a', encounterId: 'x', seed: 1, threat: 1, crew: [fighter] });
  assert.equal(abilityChargeBeats(fight.crew[0]), 14 - 4);
  assert.ok(validFtlBody(fight));
  const edited = structuredClone(fight);
  edited.crew[0].tier = 7;
  assert.equal(validFtlBody(edited), false, 'an edited tier is rejected');
});
