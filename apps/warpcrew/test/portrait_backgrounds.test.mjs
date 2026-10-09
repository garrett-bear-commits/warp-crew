// Regression: every crew portrait must have a transparent background.
// Eight portraits once shipped with an opaque hot-pink chroma-key square baked in
// (fixed by scripts/key-portrait-magenta.py). Fails if any portrait in
// public/art/pixel/crew-v2/ has an opaque magenta-dominant pixel in its corners, or if
// the opaque magenta share of its border is large. The style C set (2026-10-09) is also
// checked for fully transparent top corners, one 768 x 768 file per merc and captain, and that
// the game points every merc and captain at it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './helpers/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const crewDir = path.join(here, '..', 'public', 'art', 'pixel', 'crew-v2');


// Opaque and clearly the hot-pink key: strong red, almost no green, mid-to-high blue.
function isOpaqueMagenta(r, g, b, a) {
  return a > 200 && r > 170 && g < 90 && b > 90 && b < 210 && r - g > 120;
}

const files = fs.readdirSync(crewDir).filter((f) => f.endsWith('.png')).sort();
assert.ok(files.length >= 40, `expected the full crew portrait set, found ${files.length}`);

const problems = [];
for (const file of files) {
  const { width, height, rgba } = decodePng(fs.readFileSync(path.join(crewDir, file)));
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
  // Busts are cropped at the shoulders, so the body may reach the bottom edge: a baked-in key square would still
  // fill the top corners and the upper border, which is what is checked.
  let corner = 0;
  for (const [x0, y0] of [[0, 0], [width - 4, 0]]) {
    for (let y = y0; y < y0 + 4; y += 1) {
      for (let x = x0; x < x0 + 4; x += 1) if (isOpaqueMagenta(...at(x, y))) corner += 1;
    }
  }
  // Top edge and the upper half of both sides: only a stray pixel or two is tolerated.
  let border = 0;
  let total = 0;
  for (let x = 0; x < width; x += 1) { total += 1; if (isOpaqueMagenta(...at(x, 0))) border += 1; }
  for (let y = 1; y < height / 2; y += 1) {
    for (const x of [0, width - 1]) { total += 1; if (isOpaqueMagenta(...at(x, y))) border += 1; }
  }
  let opaqueCorner = 0;
  for (const [x, y] of [[0, 0], [width - 1, 0]]) if (at(x, y)[3] !== 0) opaqueCorner += 1;
  if (width !== 768 || height !== 768) problems.push(`${file}: ${width}x${height}, expected 768x768`);
  if (opaqueCorner) problems.push(`${file}: ${opaqueCorner} top corners are not transparent`);
  if (corner > 0 || border / total > 0.02) {
    problems.push(`${file}: ${corner} opaque magenta corner pixels, ${border}/${total} on the border`);
  }
}

assert.deepEqual(
  problems,
  [],
  `crew portraits with a baked-in magenta background (run scripts/key-portrait-magenta.py):\n${problems.join('\n')}`,
);
// Every merc and starter captain uses its own style C portrait.
const { CREW_CATALOG, STARTER_CAPTAINS } = await import('../src/data/crewRoster.js');
const { portraitFor } = await import('../src/data/portraits.js');
const used = new Set();
for (const id of new Set([...CREW_CATALOG.map(c => c.id), ...STARTER_CAPTAINS])) {
  const url = portraitFor(id);
  const file = url.split('/art/pixel/crew-v2/')[1];
  assert.ok(file && files.includes(file), `${id} uses a style C portrait (got ${url})`);
  assert.ok(!used.has(file), `${id} has its own portrait, not a shared ${file}`);
  used.add(file);
}
assert.equal(used.size, 50);
console.log(`portrait_backgrounds: ${files.length} crew portraits have transparent corners`);
