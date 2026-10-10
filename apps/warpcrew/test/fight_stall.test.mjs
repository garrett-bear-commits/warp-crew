// A fight must end (balance pass 2026-10-09, docs/qa/2026-10-09-balance-pass.md "A fight can stall forever").
// Before the fix, station crew never left their post: with every crew member aboard holding a station and the
// Weapons room unmanned, a fire or a boarding party there knocked the guns offline for good. The enemy kept
// shooting into shields it could not beat, so the fight ran for minutes or never ended. Now, when nobody aboard
// is free, one crew member from a post that is not in trouble answers a burning, boarded or offline room and goes
// home once it is whole. Saved fights keep their shape: old saves load and finish, edited ones are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startFtlEncounter, advanceFtlEncounter, validFtlBody, MAX_FIGHT_BEATS, PLAYER_ROOMS, RULES } from '../src/systems/ftlCombat.js';
import { migratePlayer } from '../src/systems/player.js';
import { normalizeEncounterState } from '../src/systems/encounterState.js';
import { sessionAction } from '../src/systems/sessionLoop.js';

const clone = value => JSON.parse(JSON.stringify(value));
/** Every crew member aboard holds a station; Weapons is the one left empty. */
const STATIONED = [
  { id: 'cap', role: 'pilot', station: 'helm' },
  { id: 'eng', role: 'engineer', station: 'engineering' },
  { id: 'ops', role: 'scout', station: 'shields' },
];
const inTrouble = (state, id) => state.rooms[id].fire > 0 || state.rooms[id].integrity <= 0
  || (state.boarders?.phase === 'aboard' && state.boarders.room === id);

/** Plays a fight hands-off (conceding when downed) and tracks how long a room in trouble went unattended. */
function play(state, cap = 1000) {
  let unattended = 0;
  let worstUnattended = 0;
  let weaponsFire = false;
  let weaponsBoarded = false;
  const beats = [];
  while (state.result === null && state.beat < cap) {
    state = advanceFtlEncounter(state, state.phase === 'downed' ? 'concede' : null).state;
    assert.ok(validFtlBody(state), `valid at beat ${state.beat}`);
    weaponsFire ||= state.rooms.weapons.fire > 0;
    weaponsBoarded ||= state.boarders?.phase === 'aboard' && state.boarders.room === 'weapons';
    const alone = PLAYER_ROOMS.some(id => inTrouble(state, id) && !state.crew.some(member => member.room === id));
    unattended = alone ? unattended + 1 : 0;
    worstUnattended = Math.max(worstUnattended, unattended);
    beats.push(state);
  }
  return { state, worstUnattended, weaponsFire, weaponsBoarded, beats };
}

test('every crew member at a station: a fire in the empty Weapons room is put out and the fight ends', () => {
  // A plain Sparrow against an Even pirate (production fight setup). Before the fix this fire burned the guns
  // out at beat 29 and the enemy needed until beat 356 to finish the ship.
  const fight = startFtlEncounter({ acceptanceId: 'stall-fire', encounterId: 'pirate_wing', seed: 7919, threat: 0.8, crew: STATIONED,
    shipLevels: { shields: 1, weapons: 1, engines: 1, sensors: 1 } });
  const { state, worstUnattended, weaponsFire, beats } = play(fight);
  assert.ok(weaponsFire, 'the Weapons room catches fire in this fight');
  assert.notEqual(state.result, null, 'the fight ends');
  assert.ok(state.beat <= MAX_FIGHT_BEATS, `ends within ${MAX_FIGHT_BEATS} beats (took ${state.beat})`);
  assert.ok(worstUnattended <= 1, 'a room in trouble is answered on the next beat');
  // The engineer answers (their job), then goes home once the room is whole.
  const call = beats.findIndex(s => s.crew.find(c => c.id === 'eng').room === 'weapons');
  assert.ok(call >= 0, 'the engineer leaves Engineering for Weapons');
  assert.ok(beats.slice(call).some(s => s.crew.find(c => c.id === 'eng').room === 'engineering'), 'and goes back to Engineering');
  // Deterministic: the same fight plays the same way.
  assert.deepEqual(play(fight).state, state);
});

test('boarders holding the empty Weapons room are fought off; before, this fight never ended', () => {
  // Two shield layers against a one-gun raider: it can never land a shot, so with the guns sabotaged offline
  // nothing could end the fight (it was still running at beat 5000 before the fix).
  const fight = startFtlEncounter({ acceptanceId: 'stall-boarders', encounterId: 'scrapper_gang', seed: 209458, threat: 1, crew: STATIONED,
    boarders: true, shipLevels: { shields: 6, weapons: 1, engines: 6, sensors: 1 } });
  const { state, weaponsBoarded, worstUnattended } = play(fight);
  assert.ok(weaponsBoarded, 'boarders land in the Weapons room');
  assert.equal(state.result, 'win', 'the guns come back and the fight is won');
  assert.ok(state.beat <= MAX_FIGHT_BEATS, `ends within ${MAX_FIGHT_BEATS} beats (took ${state.beat})`);
  assert.equal(state.boarders.phase, 'repelled');
  assert.ok(worstUnattended <= 1);
});

test('crew only leave a post when nobody is free and their own room is not in trouble', () => {
  // With a free crew member aboard, station crew stay at their posts (unchanged); the free one does the running.
  const withFree = startFtlEncounter({ acceptanceId: 'free', encounterId: 'pirate_wing', seed: 7919, threat: 0.8,
    crew: [...STATIONED, { id: 'deck', role: 'gunner', station: null }], shipLevels: { shields: 1, weapons: 1, engines: 1, sensors: 1 } });
  const burning = clone(withFree);
  burning.rooms.weapons.fire = 100;
  for (const s of play(burning).beats) {
    for (const member of s.crew.filter(c => c.station)) assert.equal(member.room, member.station, `${member.id} keeps their post at beat ${s.beat}`);
  }
  assert.equal(advanceFtlEncounter(burning).state.crew.find(c => c.id === 'deck').room, 'weapons', 'the free crew member goes');

  // All stationed: the pilot's own Helm is burning, so the pilot stays; the engineer takes the Weapons fire.
  const both = clone(startFtlEncounter({ acceptanceId: 'both', encounterId: 'pirate_wing', seed: 11, threat: 1, crew: STATIONED }));
  both.rooms.helm.fire = 100;
  both.rooms.weapons.fire = 100;
  const next = advanceFtlEncounter(both).state;
  assert.deepEqual(Object.fromEntries(next.crew.map(c => [c.id, c.room])), { cap: 'helm', eng: 'weapons', ops: 'shields' });

  // A captain's order wins: a crew member moved by hand is not called away while the order holds.
  const ordered = clone(both);
  ordered.intent.moves = { eng: 'shields' };
  const held = advanceFtlEncounter(ordered).state;
  assert.equal(held.crew.find(c => c.id === 'eng').room, 'shields');
  assert.equal(held.crew.find(c => c.id === 'ops').room, 'weapons', 'the next crew member in line answers instead');

  // Merely damaged rooms are not emergencies: nobody leaves a post to patch a working room.
  const dented = clone(startFtlEncounter({ acceptanceId: 'dent', encounterId: 'pirate_wing', seed: 11, threat: 1, crew: STATIONED }));
  dented.rooms.weapons.integrity = 30;
  assert.ok(advanceFtlEncounter(dented).state.crew.every(c => c.room === c.station));

  // Nobody aboard: nothing changes (an empty room keeps burning, as before).
  const empty = clone(startFtlEncounter({ acceptanceId: 'empty', encounterId: 'pirate_wing', seed: 11, threat: 1, crew: [] }));
  empty.rooms.weapons.fire = 100;
  assert.ok(advanceFtlEncounter(empty).state.rooms.weapons.fire > 0);
});

// Saved by the engine before this fix (scratch generator, 2026-10-10): a day-7 captain, Sparrow shields and
// engines 6, pilot at Helm and engineer at Shields, on the Reliable contract's push fight against a Scrapper
// Gang. Boarders took the empty Weapons room at beat 8 and had held it, guns offline, until the save at beat 60;
// the old engine needed until beat 610 to end it (the crew's moves chipped the enemy down). Phase 3 added the
// Scrappers' faction block ({ id: 'scrappers' }; their rule is the boarders the fight already had), which every saved
// faction fight now carries (audit 2026-10-10 L3).
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/stalled-boarded-weapons-fight.json', import.meta.url), 'utf8'));

test('a fight saved stalled before the fix loads unchanged, ends, and pays out', () => {
  const { now } = FIXTURE;
  const saved = FIXTURE.player.activeEncounter;
  assert.equal(saved.beat, 60);
  assert.deepEqual([saved.rooms.weapons.integrity, saved.boarders.phase, saved.boarders.room], [0, 'aboard', 'weapons']);
  assert.ok(saved.crew.every(member => member.station && member.room === member.station), 'every crew member at their post');
  assert.equal(validFtlBody(saved), true);
  const loaded = migratePlayer(clone(FIXTURE.player));
  assert.deepEqual(loaded.activeEncounter, saved, 'the saved fight is accepted as it was');
  assert.deepEqual(normalizeEncounterState(loaded).activeEncounter, saved);

  let player = loaded;
  let ui = {};
  for (let beat = 0; beat < MAX_FIGHT_BEATS && !player.activeEncounter.result; beat++) {
    const e = player.activeEncounter;
    const res = sessionAction(player, ui, e.phase === 'downed' ? 'encounter-order' : 'encounter-advance',
      { acceptanceId: e.acceptanceId, revision: e.revision, order: e.phase === 'downed' ? 'concede' : null }, { now });
    assert.ok(res?.ok, `beat ${e.beat + 1} commits`);
    player = res.player;
    ui = { ...ui, ...res.ui };
  }
  const fight = player.activeEncounter;
  assert.notEqual(fight.result, null, `the fight ends within ${MAX_FIGHT_BEATS} more beats`);
  assert.equal(fight.boarders.phase, 'repelled');
  assert.equal(player.activeContract.stage, 'return');
  // The settled fight is still a valid save and its prize can be claimed.
  const reloaded = migratePlayer(clone(player));
  assert.deepEqual(reloaded.activeEncounter, fight);
  const contract = reloaded.activeContract;
  const claimed = sessionAction(reloaded, {}, 'contract-claim', { acceptanceId: contract.acceptanceId, revision: contract.revision, action: 'claim' }, { now });
  assert.ok(claimed?.ok, 'the prize is claimed');
  assert.equal(claimed.player.activeContract, null);
});

test('edited fights are refused as before', () => {
  const edits = {
    'a crew member in a room that does not exist': e => { e.crew[0].room = 'bridge'; },
    'a station that does not exist': e => { e.crew[1].station = 'galley'; },
    'a captain order that never expires': e => { e.crew[0].manualUntil = e.beat + RULES.autoReturnBeats + 1; },
    'softer enemy guns': e => { e.enemy.weapons[0].damage = 1; },
    'a room past full integrity': e => { e.rooms.weapons.integrity = 140; },
    'boarders with extra strength': e => { e.boarders.hp = RULES.boarderHp + 1; },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const player = clone(FIXTURE.player);
    edit(player.activeEncounter);
    assert.equal(validFtlBody(player.activeEncounter), false, name);
    const loaded = normalizeEncounterState(player);
    assert.equal(loaded.activeEncounter, null, `${name}: the fight is dropped`);
    assert.equal(loaded.recoveryEvents.at(-1).reason, 'invalid_encounter_state');
  }
});
