import assert from 'node:assert/strict';
import { SHIPS } from '../src/data/ships.js';
import { PLANET_DEFS } from '../src/data/planets.js';
import { NODES, STORY_BEATS } from '../src/data/sectors.js';
import { ENCOUNTERS_V1 } from '../src/systems/combat.js';

// Player-facing copy stays in the game's voice: no launch phases, SKUs, genre labels or design-speak.
const DEV_WORDS = /\b(tutorial|SKUs?|IAP|LiveOps|soft[- ]?launch|placeholder|TODO|provisional|mid-?core|mid-?game|end-?game|monetization|telemetry|F2P|roadmap|fast follow|season spine|not shipped|story-adjacent|QA)\b/i;
const clean = (text, where) => assert.doesNotMatch(String(text ?? ''), DEV_WORDS, `${where} reads like developer language: "${text}"`);

// Hulls: one short in-world sentence about what the ship is good at.
for (const ship of Object.values(SHIPS)) {
  clean(ship.blurb, `${ship.id} blurb`);
  clean(ship.history, `${ship.id} history`);
  assert.match(ship.blurb, /^[^.!?]+[.!?]$/, `${ship.id} blurb is a single sentence`);
  assert.ok(ship.blurb.length <= 80, `${ship.id} blurb is short`);
}

// Expedition sites: their own lines, never a copy of a map beacon.
const beaconBlurbs = new Map(Object.values(NODES).map((node) => [node.blurb, node.id]));
for (const planet of PLANET_DEFS) {
  clean(planet.blurb, `${planet.id} blurb`);
  clean(planet.win, `${planet.id} win`);
  clean(planet.fail, `${planet.id} fail`);
  assert.equal(beaconBlurbs.has(planet.blurb), false, `${planet.id} copies the ${beaconBlurbs.get(planet.blurb)} beacon blurb`);
}
for (const node of Object.values(NODES)) clean(node.blurb, `${node.id} blurb`);
for (const [id, beat] of Object.entries(STORY_BEATS)) { clean(beat.title, `${id} title`); clean(beat.text, `${id} text`); }

// Encounters: the tell's advice matches the real-time crew fight, in one short line.
const CURRENT_FIGHT = /\b(Weapons|Shields|Engines|Helm|Overcharge|Board|Hold|security|engineer|crew)\b/;
const RETIRED_ORDER_TALK = /\d|\bBrace\b|\bBurn\b|effective power|hull loss|crew injur|payout|chance/i;
for (const encounter of ENCOUNTERS_V1) {
  for (const key of ['name', 'blurb', 'win', 'fail']) clean(encounter[key], `${encounter.id} ${key}`);
  const { label, text, reason } = encounter.tell;
  clean(label, `${encounter.id} tell label`);
  clean(text, `${encounter.id} tell text`);
  clean(reason, `${encounter.id} tell advice`);
  assert.ok(reason.length <= 80, `${encounter.id} tell advice is one short line`);
  assert.doesNotMatch(reason, RETIRED_ORDER_TALK, `${encounter.id} tell advice still talks about the old order system: "${reason}"`);
  assert.match(reason, CURRENT_FIGHT, `${encounter.id} tell advice names something the player can do in the fight: "${reason}"`);
}
assert.equal(new Set(ENCOUNTERS_V1.map((encounter) => encounter.tell.reason)).size, ENCOUNTERS_V1.length, 'each tell gives its own advice');

console.log('player_copy.test.mjs OK');
