import assert from 'node:assert/strict';
import { effectScreenPoint, visibleLandmarks, worldProjection } from '../src/ui/worldProjection.js';
import { makeCamera } from '../src/ui/shipCamera.js';
import { attachCombat, playCombat } from '../src/ui/combatView.js';
import { stopStageLoop } from '../src/ui/stageLoop.js';

const base = { x: 0, y: 0, scale: 1, viewport: { w: 390, h: 620 }, world: { w: 1152, h: 1728 } };
const fx = { worldX: 100, worldY: 150 };

assert.deepEqual(worldProjection(base, { x: 100, y: 150 }), { x: 100, y: 150 });
assert.deepEqual(effectScreenPoint(base, fx), { x: 100, y: 150 });
assert.deepEqual(effectScreenPoint({ ...base, x: -20, scale: 2 }, fx), { x: 180, y: 300 });

const near = visibleLandmarks(77, base);
const moved = visibleLandmarks(77, { ...base, x: -100, y: -80, scale: 1.25, viewport: { w: 430, h: 700 } });
assert.ok(near.length > 0 && moved.length > 0, 'both camera views show landmarks');
const movedById = new Map(moved.map(({ id, worldX, worldY }) => [id, { worldX, worldY }]));
const shared = near.filter(({ id }) => movedById.has(id));
assert.ok(shared.length > 0, 'the camera views share landmarks');
for (const { id, worldX, worldY } of shared) {
  assert.deepEqual(movedById.get(id), { worldX, worldY }, `${id} keeps its world coordinates`);
}
assert.notDeepEqual(
  visibleLandmarks(78, base).map(({ id, worldX, worldY }) => [id, worldX, worldY]),
  near.map(({ id, worldX, worldY }) => [id, worldX, worldY]),
  'a different seed makes a different layout',
);
const wideView = { ...base, x: 600, y: 600, viewport: { w: 2400, h: 3000 } };
assert.ok(visibleLandmarks(77, wideView).some(item => item.kind === 'hole'),
  'the existing black-hole landmark remains in the world');

// A close station view must become a battle overview before the first draw.
globalThis.Image = class { complete = true; naturalWidth = 64; };
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.ResizeObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
let camera = makeCamera({ w: 390, h: 620 }, { w: 1152, h: 1728 }, { x: 400, y: 1400 }, 0.9);
const closeScale = camera.scale;
let cameraSets = 0;
const combatCanvas = {
  width: 0, height: 0, style: {}, classList: { add() {} },
  getBoundingClientRect: () => ({ width: 390, height: 620 }),
  getContext: () => ({ setTransform() {} }),
};
attachCombat(combatCanvas, { style: {} }, () => camera, next => {
  camera = next;
  cameraSets++;
});
playCombat({ preview: { encounter: { name: 'Pirate Scout' } }, win: true });
assert.equal(cameraSets, 1, 'combat applies a camera overview before drawing');
assert.ok(camera.scale < closeScale, 'battle starts at a wider scale than a close station view');
for (const point of [{ worldX: 576, worldY: 121 }, { worldX: 1030, worldY: 240 }]) {
  const screen = effectScreenPoint(camera, point);
  assert.ok(screen.x >= 55 && screen.x <= 335 && screen.y >= 40 && screen.y <= 580,
    `both combat anchors fit inside safe screen bounds: ${JSON.stringify(screen)}`);
}
stopStageLoop();

console.log('world projection tests passed');
