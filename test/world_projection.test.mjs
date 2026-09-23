import assert from 'node:assert/strict';
import { effectScreenPoint, visibleLandmarks, worldProjection } from '../src/ui/worldProjection.js';

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

console.log('world projection tests passed');
