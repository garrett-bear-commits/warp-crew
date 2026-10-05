import assert from 'node:assert/strict';
import {
  startFtlEncounter, advanceFtlEncounter, applyFtlCommand, validFtlBody, enemyLoadout, PLAYER_WEAPONS,
  playerShieldCap, currentTarget, ftlRallyEligible, RULES, BEAT_MS,
} from '../src/systems/ftlCombat.js';
import { playFight } from '../scripts/ftl-balance.mjs';

const CREW = [
  { id: 'cap', role: 'pilot', station: 'helm' },
  { id: 'gun', role: 'gunner', station: 'weapons' },
  { id: 'eng', role: 'engineer', station: 'shields' },
  { id: 'deck', role: 'scout', station: null },
];
const start = (extra = {}) => startFtlEncounter({ acceptanceId: 'fight-1', encounterId: 'pirate_wing', seed: 4242, threat: 1, crew: CREW, ...extra });
const run = (state, beats, order = null) => {
  for (let i = 0; i < beats && state.result === null && state.phase === 'combat'; i += 1) state = advanceFtlEncounter(state, order).state;
  return state;
};

// One beat is one second of fight time.
assert.equal(BEAT_MS, 1000);

// Deterministic and valid at every beat, across threats, tactics, boarders, Rally and concede.
for (const threat of [0.6, 0.8, 1, 1.2, 1.4, 1.6]) {
  for (let seed = 1; seed <= 40; seed += 1) {
    const opts = { seed: seed * 97, threat, tactics: ['burn', 'board'], boarders: seed % 2 === 0 };
    let a = start(opts);
    let b = start(opts);
    assert.ok(validFtlBody(a), 'fresh fight is valid');
    let guard = 0;
    while (a.result === null && guard < 400) {
      const order = a.phase === 'downed' ? (seed % 3 === 0 ? 'concede' : 'rally') : guard === 3 && seed % 5 === 0 ? 'burn' : null;
      a = advanceFtlEncounter(a, order).state;
      b = advanceFtlEncounter(b, order).state;
      assert.deepEqual(a, b, 'same seed, same fight');
      assert.ok(validFtlBody(a), `valid at beat ${a.beat} (threat ${threat}, seed ${seed})`);
      guard += 1;
    }
    assert.notEqual(a.result, null, 'every fight ends');
    assert.ok(a.beat >= 10, 'no instant fights');
  }
}

// Commands change intent only; time does not move.
let s = start();
const targeted = applyFtlCommand(s, { type: 'target', room: 'weapons' });
assert.equal(targeted.ok, true);
assert.equal(targeted.state.beat, 0);
assert.equal(targeted.state.intent.target, 'weapons');
assert.equal(currentTarget(targeted.state), 'weapons');
assert.equal(applyFtlCommand(s, { type: 'target', room: 'bridge' }).reason, 'unknown_room');
assert.equal(applyFtlCommand(s, { type: 'move', crewId: 'nobody', room: 'helm' }).reason, 'unknown_crew');
assert.equal(applyFtlCommand(s, { type: 'warp' }).reason, 'unknown_command');
assert.equal(currentTarget(s), 'shields', 'an idle captain shoots shields first');

// A move lands on the next beat and sticks for a while.
const moved = advanceFtlEncounter(applyFtlCommand(s, { type: 'move', crewId: 'gun', room: 'engineering' }).state).state;
assert.equal(moved.crew.find(c => c.id === 'gun').room, 'engineering');
assert.deepEqual(moved.intent.moves, {});
assert.ok(validFtlBody(moved));

// Hold: weapons wait for each other and fire together.
let held = applyFtlCommand(start({ threat: 0.6 }), { type: 'hold', hold: true }).state;
let volleys = [];
for (let i = 0; i < 25 && held.result === null; i += 1) {
  const step = advanceFtlEncounter(held);
  held = step.state;
  const shots = step.events.filter(ev => ev.type === 'shot' && ev.from === 'player');
  if (shots.length) volleys.push(new Set(shots.map(ev => ev.weapon)).size);
}
assert.ok(volleys.length > 0 && volleys.every(n => n === PLAYER_WEAPONS.length), 'held weapons always fire as one volley');

// Shields take a shot before the hull does.
const shielded = start({ threat: 1.6, seed: 11 });
assert.equal(shielded.shields.layers, 1);
let first = null;
let probe = shielded;
for (let i = 0; i < 20 && !first; i += 1) {
  const step = advanceFtlEncounter(probe);
  probe = step.state;
  first = step.events.find(ev => ev.type === 'shot' && ev.from === 'enemy') || null;
}
assert.equal(first.outcome, 'shield', 'the first enemy shot pops the shield layer');

// A wrecked shield room caps the layers.
const wrecked = structuredClone(start());
wrecked.rooms.shields.integrity = 0;
assert.equal(playerShieldCap(wrecked), 0);

// Crew in a burning room put it out; nobody else does.
const burning = structuredClone(start());
burning.rooms.helm.fire = 100;
const putOut = run(burning, 3);
assert.equal(putOut.rooms.helm.fire, 0, 'the pilot puts the bridge fire out');
const unmanned = structuredClone(start({ crew: [] }));
unmanned.rooms.engineering.fire = 100;
assert.ok(advanceFtlEncounter(unmanned).state.rooms.engineering.fire > 0, 'an empty room keeps burning');

// Free crew go where they are needed without being told.
const needy = structuredClone(start());
needy.rooms.engineering.integrity = 30;
assert.equal(advanceFtlEncounter(needy).state.crew.find(c => c.id === 'deck').room, 'engineering');

// Enemy guns come from threat: an edited save is refused.
const tampered = structuredClone(start({ threat: 1.4 }));
tampered.enemy.weapons[0].damage = 1;
assert.equal(validFtlBody(tampered), false);
assert.equal(enemyLoadout(1.4).weapons.length, 2);
assert.equal(enemyLoadout(0.7).shieldLayers, 0);

// Overcharge and Board.
const tactics = start({ tactics: ['burn', 'board'] });
const burnt = advanceFtlEncounter(tactics, 'burn').state;
assert.equal(burnt.tactics.burn.uses, 1);
assert.equal(advanceFtlEncounter(burnt, 'burn').reason, 'used');
assert.equal(advanceFtlEncounter(tactics, 'board').reason, 'enemy_too_strong', 'Board waits for half hull');
assert.equal(advanceFtlEncounter(start(), 'burn').reason, 'order_unavailable', 'locked tactics stay locked');

// Rally keeps the near-miss rule.
const near = structuredClone(start());
near.enemy.hull = 5;
assert.equal(ftlRallyEligible(near), true);
near.enemy.hull = 20;
assert.equal(ftlRallyEligible(near), false);

// A damaged ship carries its hull into the fight.
assert.equal(start({ hull: 55 }).hull, 55);
assert.equal(start({ hull: 55 }).startHull, 55);

// Balance guard: a ladder of difficulty, and playing well pays.
const table = threat => {
  const idle = [];
  const smart = [];
  for (let i = 0; i < 120; i += 1) {
    const seed = 5000 + i * 131;
    idle.push(playFight({ threat, seed }));
    smart.push(playFight({ threat, seed, policy: 'smart' }));
  }
  const rate = list => list.filter(f => f.result === 'win').length / list.length;
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  return { idle: rate(idle), smart: rate(smart), beats: median(idle.map(f => f.beats)) };
};
const easy = table(0.7);
const even = table(1);
const deadly = table(1.3);
const top = table(1.5);
assert.ok(easy.idle >= 0.97, `Favorable is safe (${easy.idle})`);
assert.ok(even.idle >= 0.9, `Even is usually won hands-off (${even.idle})`);
assert.ok(deadly.idle <= 0.9 && deadly.idle >= 0.5, `Deadly is a real risk (${deadly.idle})`);
assert.ok(top.idle <= 0.6, `the top threat is a fight (${top.idle})`);
assert.ok(deadly.smart > deadly.idle && top.smart > top.idle + 0.1, 'targeting and holding volleys pays');
for (const row of [even, deadly, top]) assert.ok(row.beats >= 25 && row.beats <= 65, `fights last 25-65 s (${row.beats})`);
assert.ok(RULES.rallyHull > 1);

console.log('ftl_combat.test.mjs OK');
