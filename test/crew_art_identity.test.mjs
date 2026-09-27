import assert from 'node:assert/strict';
import * as crewArt from '../src/ui/crewArt.js';
import * as crewWalk from '../src/ui/crewWalk.js';
import { portraitFor } from '../src/data/portraits.js';

const { resolveCrewSheet, walkAssetFor } = crewArt;

const generic = { src: 'generic-human' };
const library = { merc_rex: generic };
assert.equal(resolveCrewSheet('captain_alien', 'scout', library), null);
assert.equal(resolveCrewSheet('captain_droid', 'engineer', library), null);
assert.equal(resolveCrewSheet('merc_jen', 'gunner', library), generic);
assert.equal(typeof crewArt.staticCrewMarkerFor, 'function');
assert.equal(typeof crewWalk.drawCrewIdentityMarker, 'function');
const { staticCrewMarkerFor } = crewArt;
const { drawCrewIdentityMarker } = crewWalk;
const alien = staticCrewMarkerFor('captain_alien');
const droid = staticCrewMarkerFor('captain_droid');
assert.equal(alien.src, portraitFor('captain_alien'));
assert.equal(droid.src, portraitFor('captain_droid'));
assert.notEqual(alien.src, droid.src);
assert.notEqual(alien.shape, droid.shape);
assert.equal(staticCrewMarkerFor('merc_jen'), null);
assert.equal(walkAssetFor('captain_alien', 'scout').marker.src, alien.src);
assert.equal(walkAssetFor('captain_droid', 'engineer').marker.src, droid.src);
assert.equal(walkAssetFor('captain_alien', 'scout').image, null);
assert.equal(walkAssetFor('captain_droid', 'engineer').image, null);

function drawCalls(marker) {
  const calls = [];
  const g = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, arc() {}, clip() {},
    stroke() {}, fill() {}, fillText() {}, drawImage(...args) { calls.push(args); },
  };
  const portrait = { complete: true, naturalWidth: 256, naturalHeight: 256, src: marker.src };
  drawCrewIdentityMarker(g, marker, portrait, { x: 100, y: 120 });
  return calls;
}
assert.equal(drawCalls(alien).length, 1);
assert.equal(drawCalls(droid).length, 1);
assert.notEqual(drawCalls(alien)[0][0].src, drawCalls(droid)[0][0].src);
console.log('crew_art_identity.test.mjs OK');
