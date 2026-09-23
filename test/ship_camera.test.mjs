import assert from 'node:assert/strict';
import { makeCamera, project, unproject, pan, zoomAt, resizeCamera, focusCamera } from '../src/ui/shipCamera.js';

const c = makeCamera({ w: 390, h: 620 }, { w: 1152, h: 1728 }, { x: 540, y: 360 }, 0.9);
const p = { x: 420, y: 530 };
assert.ok(Math.abs(unproject(c, project(c, p)).x - p.x) < 0.001);
assert.ok(Math.abs(unproject(c, project(c, p)).y - p.y) < 0.001);

const midpoint = { x: 200, y: 300 };
const before = unproject(c, midpoint);
const enlarged = zoomAt(c, 1.8, midpoint);
assert.ok(Math.abs(unproject(enlarged, midpoint).x - before.x) < 0.001);
assert.ok(Math.abs(unproject(enlarged, midpoint).y - before.y) < 0.001);

assert.ok(pan(c, 1e6, -1e6).x !== c.x + 1e6);
const translated = pan(c, 1e6, -1e6);
assert.ok(translated.x <= translated.world.w * translated.scale * 0.2);
assert.ok(translated.y >= translated.viewport.h - translated.world.h * translated.scale * 0.8);
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
