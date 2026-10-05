import assert from 'node:assert/strict';
import { ENEMY_FAMILIES, enemyArtFor } from '../src/data/art/enemyArt.js';
import { ENCOUNTERS_V1 } from '../src/systems/combat.js';
import { renderFtlEnemy } from '../src/ui/ftlView.js';

// Every encounter has a cutaway with all four targetable rooms inside the image.
assert.deepEqual(ENEMY_FAMILIES, ['pirate', 'scrapper', 'swarm', 'ice', 'shade', 'crown']);
for (const encounter of ENCOUNTERS_V1) {
  const art = enemyArtFor(encounter.id);
  assert.ok(ENEMY_FAMILIES.includes(art.family), `${encounter.id} has a family`);
  for (const id of ['weapons', 'shields', 'engines', 'helm']) {
    const r = art.rooms[id];
    assert.ok(r, `${art.family} has ${id}`);
    assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= 100 && r.top + r.height <= 100, `${art.family} ${id} inside the image`);
  }
}
assert.equal(enemyArtFor('swarm_brood').family, 'swarm');
assert.equal(enemyArtFor('unknown_enemy').family, 'pirate', 'unknown encounters fall back to the pirate hull');

// The panel draws the family art with rooms placed over their rectangles.
const room = { integrity: 100, fire: false, offline: false, damaged: false };
const view = { ftl: true, encounterId: 'ice_raiders', acceptanceId: 'a', revision: 1, beat: 1, result: null, downed: null, enemyName: 'Ice Raiders',
  threatLabel: 'Even', target: 'shields', targetChosen: false,
  enemy: { hull: 40, hullMax: 42, evasion: 10, shields: { layers: 1, max: 1, full: 1 },
    rooms: Object.fromEntries(['weapons', 'shields', 'engines', 'helm'].map(id => [id, { ...room, label: id }])),
    weapons: [{ shots: 2, damage: 8, chargePct: 40, nextPct: 50, targetLabel: 'Helm' }] } };
const html = renderFtlEnemy(view);
assert.match(html, /art\/enemies\/ice\.png/);
assert.match(html, /family-ice/);
const ice = enemyArtFor('ice_raiders').rooms.weapons;
assert.match(html, new RegExp(`data-enemy-room="weapons"[^]*?|style="left:${ice.left}%;top:${ice.top}%`));
console.log('enemy_art.test.mjs OK');
