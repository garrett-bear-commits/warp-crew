// The 2026-10-09 style C art pass (docs/art/2026-10-09-art-pass-2-ledger.md): every ship, scene, icon and space
// sprite the game draws comes from the new set, sprites have transparent backgrounds, and each enemy ship's four
// target rooms sit on the ship's own rooms (the first measured layout must match the art it was measured on).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng } from './helpers/png.mjs';
import { SHIP_ART, SPACE_ART, ICONS, NODE_ART, PLANET_ART, CINEMATIC_ART, SWARM_ART } from '../src/data/portraits.js';
import { ART_VERTICAL_SLICE } from '../src/data/artManifest.js';
import layouts from '../src/data/art/enemyLayouts.json' with { type: 'json' };

const publicFile = url => fileURLToPath(new URL(`../public/${String(url).replace(/^.*?\/?art\//, 'art/')}`, import.meta.url));
const png = url => decodePng(fs.readFileSync(publicFile(url)));
const alphaAt = (img, x, y) => img.rgba[(y * img.width + x) * 4 + 3];
const solid = (img, x, y) => alphaAt(img, x, y) > 200;  // the 256-colour palette rounds full alpha to 254

const sprites = [
  ...Object.values(SHIP_ART), ...Object.values(ICONS), ...Object.values(NODE_ART), ...Object.values(PLANET_ART),
  SWARM_ART, SPACE_ART.planetHero, SPACE_ART.planetIce, SPACE_ART.pirate, SPACE_ART.trader, ...SPACE_ART.asteroids,
];
const scenes = [...Object.values(CINEMATIC_ART)];
const enemies = Object.entries(layouts).filter(([key]) => key !== 'encounters');

// Everything points at the new set (new folders, so no phone shows a cached old image).
for (const url of [...sprites, ...scenes, ...enemies.map(([, layout]) => layout.image)]) {
  assert.match(url, /\/v2\/|-v2\.png$|splash-v4\.png$/, `${url} is style C art`);
  assert.ok(fs.existsSync(publicFile(url)), `${url} is installed`);
}
assert.equal(ART_VERTICAL_SLICE.splash.status, 'style-c');
assert.equal(ART_VERTICAL_SLICE.pirate_scout.status, 'style-c');

// Sprites: all four corners transparent (the navy generation background is keyed out).
for (const url of new Set(sprites)) {
  const img = png(url);
  for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]]) {
    assert.equal(alphaAt(img, x, y), 0, `${url} corner ${x},${y} is transparent`);
  }
}

// Enemy ships: the layout's source size is the image's, and each room's middle is on the ship (opaque), with no two
// target rooms overlapping.
for (const [family, layout] of enemies) {
  const img = png(layout.image);
  assert.deepEqual(layout.sourceSize, { width: img.width, height: img.height }, `${family} source size`);
  assert.deepEqual(layout.rooms.map(room => room.id).sort(), ['engines', 'helm', 'shields', 'weapons'], `${family} rooms`);
  for (const room of layout.rooms) {
    const x = Math.round((room.left + room.width / 2) / 100 * (img.width - 1));
    const y = Math.round((room.top + room.height / 2) / 100 * (img.height - 1));
    assert.ok(solid(img, x, y), `${family} ${room.id} sits on the ship`);
  }
  for (const a of layout.rooms) for (const b of layout.rooms) {
    if (a.id >= b.id) continue;
    const apart = a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top;
    assert.ok(apart, `${family} ${a.id} and ${b.id} do not overlap`);
  }
  for (const mount of layout.mounts) {
    assert.ok(solid(img, Math.round(mount.x / 100 * (img.width - 1)), Math.round(mount.y / 100 * (img.height - 1))),
      `${family} gun mount ${mount.x},${mount.y} is on the hull`);
  }
}

console.log(`art_pass: ${new Set(sprites).size} sprites, ${scenes.length} scenes, ${enemies.length} enemy ships`);
