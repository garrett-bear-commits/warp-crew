import assert from 'node:assert/strict';
import { makeCamera, project, unproject, pan, zoomAt, resizeCamera, focusCamera, clampCamera } from '../src/ui/shipCamera.js';

const c = makeCamera({ w: 390, h: 620 }, { w: 1152, h: 1728 }, { x: 540, y: 360 }, 0.9);
const p = { x: 420, y: 530 };
assert.ok(Math.abs(unproject(c, project(c, p)).x - p.x) < 0.001);
assert.ok(Math.abs(unproject(c, project(c, p)).y - p.y) < 0.001);

const midpoint = { x: 200, y: 300 };
const before = unproject(c, midpoint);
const zoomStart = zoomAt(c, 0.8, midpoint);
const enlarged = zoomAt(zoomStart, 1.1, midpoint);
assert.ok(enlarged.scale > zoomStart.scale);
assert.ok(enlarged.scale < zoomStart.maxScale);
assert.ok(Math.abs(unproject(enlarged, midpoint).x - before.x) < 0.001);
assert.ok(Math.abs(unproject(enlarged, midpoint).y - before.y) < 0.001);

const extreme = pan(makeCamera({ w: 100, h: 1000 }, { w: 1152, h: 1728 }, { x: 576, y: 864 }, 1), 1e6, 0);
const extremeWidth = extreme.world.w * extreme.scale;
const visibleWidth = Math.max(0, Math.min(100, extreme.x + extremeWidth) - Math.max(0, extreme.x));
assert.ok(visibleWidth >= Math.min(100, extremeWidth * 0.2) - 0.001);
assert.ok(extreme.scale * extreme.world.w * 0.19 >= 44 - 0.001);

const centered = clampCamera({
  x: 0,
  y: 0,
  scale: 0.01,
  viewport: { w: 1000, h: 2000 },
  world: { w: 1152, h: 1728 },
});
assert.ok(Math.abs(centered.x - (centered.viewport.w - centered.world.w * centered.scale) / 2) < 0.001);
assert.ok(Math.abs(centered.y - (centered.viewport.h - centered.world.h * centered.scale) / 2) < 0.001);
assert.ok(Math.abs(c.maxScale - (390 / (2.5 * 1152 * 0.19))) < 0.001);

assert.ok(pan(c, 1e6, -1e6).x !== c.x + 1e6);
const translated = pan(c, 1e6, -1e6);
assert.ok(translated.x <= translated.viewport.w - translated.world.w * translated.scale * 0.2);
assert.ok(translated.y >= translated.world.h * translated.scale * 0.2 - translated.world.h * translated.scale);
const resized = resizeCamera(c, { w: 360, h: 800 });
assert.ok(Number.isFinite(resized.x));
const oldCenterWorld = unproject(c, { x: 195, y: 310 });
const newCenterWorld = unproject(resized, { x: 180, y: 400 });
assert.ok(Math.abs(newCenterWorld.x - oldCenterWorld.x) < 0.001);
assert.ok(Math.abs(newCenterWorld.y - oldCenterWorld.y) < 0.001);
assert.ok(Math.abs(project(focusCamera(c, p, c.maxScale), p).x - 195) < 1);
assert.ok(Math.abs(project(focusCamera(c, p, c.maxScale), p).y - 310) < 1);
assert.notEqual(translated, c);
assert.equal(c.viewport.w, 390);

console.log('ship_camera.test.mjs OK');
