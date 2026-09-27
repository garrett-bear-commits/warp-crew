import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crewArt from '../src/ui/crewArt.js';
import { CREW_CATALOG } from '../src/data/crewRoster.js';
import { CREW_LOOKS } from '../src/data/looks.js';
import { CREW_RIG } from '../src/data/crewRigManifest.js';

const { resolveCrewSheet, walkAssetFor, rigLookFor, rigFamilyFor } = crewArt;

// Idle portraits elsewhere keep their contract: alien/droid never borrow a human strip.
const generic = { src: 'generic-human' };
const library = { merc_rex: generic };
assert.equal(resolveCrewSheet('captain_alien', 'scout', library), null);
assert.equal(resolveCrewSheet('captain_droid', 'engineer', library), null);
assert.equal(resolveCrewSheet('merc_jen', 'gunner', library), generic);

// The static identity markers are gone: every ship actor is an animated sprite.
assert.equal(crewArt.staticCrewMarkerFor, undefined);

// The baked JSON and the generated module agree.
const json = JSON.parse(readFileSync(new URL('../public/art/crew/manifest.json', import.meta.url), 'utf8'));
assert.deepEqual(json, CREW_RIG);

const FAMILY = { human: 'human', alien: 'alien', droid: 'droid' };
const pngSize = (bytes) => ({ w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) });
const variants = { alien: new Set(), droid: new Set() };
for (const template of CREW_CATALOG) {
  const entry = CREW_RIG.looks[template.id];
  assert.ok(entry, `${template.id} has baked ship sprites`);
  assert.ok(CREW_LOOKS[template.id], `${template.id} has a look`);
  assert.equal(entry.family, FAMILY[template.species], `${template.id} (${template.species}) family`);
  assert.equal(rigLookFor(template.id, template.role).lookId, template.id);
  assert.equal(rigFamilyFor(template.id, template.role), entry.family);
  if (variants[entry.family]) variants[entry.family].add(entry.variant);
  for (const [clip, spec] of Object.entries(CREW_RIG.animations)) {
    const path = entry.sheets[clip];
    assert.equal(path, `art/crew/${template.id}_${clip}.png`);
    const size = pngSize(readFileSync(new URL(`../public/${path}`, import.meta.url)));
    assert.deepEqual(size, { w: CREW_RIG.cell.w * spec.frames, h: CREW_RIG.cell.h }, `${path} strip size`);
  }
}
assert.ok(variants.alien.size >= 3, `alien variants ${[...variants.alien]}`);
assert.ok(variants.droid.size >= 2, `droid variants ${[...variants.droid]}`);

for (const id of ['captain_alien', 'captain_droid']) {
  const asset = walkAssetFor(id, 'scout');
  assert.notEqual(asset.family, 'human', `${id} is not a human sprite`);
  assert.equal(asset.lookId, id);
  assert.deepEqual(Object.keys(asset.sheets).sort(), ['idle', 'walk', 'work']);
}
assert.equal(walkAssetFor('captain_alien').family, 'alien');
assert.equal(walkAssetFor('captain_droid').family, 'droid');
assert.equal(walkAssetFor('merc_jen').family, 'human');
// Unknown templates fall back to the role look, never to nothing.
assert.equal(rigLookFor('unknown_template', 'engineer').lookId, 'merc_bolt');
assert.equal(rigLookFor('unknown_template', 'nobody').lookId, 'merc_rex');

console.log('crew_art_identity.test.mjs OK');
