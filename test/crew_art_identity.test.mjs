import assert from 'node:assert/strict';
import { resolveCrewSheet } from '../src/ui/crewArt.js';

const generic = { src: 'generic-human' };
const library = { merc_rex: generic };
assert.equal(resolveCrewSheet('captain_alien', 'scout', library), null);
assert.equal(resolveCrewSheet('captain_droid', 'engineer', library), null);
assert.equal(resolveCrewSheet('merc_jen', 'gunner', library), generic);
console.log('crew_art_identity.test.mjs OK');
