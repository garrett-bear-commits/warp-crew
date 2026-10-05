import { project } from './shipCamera.js';
import { HULL_PX } from '../data/starterShip.js';

const DEFAULT_WORLD = HULL_PX;
const W = HULL_PX;

export const worldProjection = (camera, worldPoint) => project(camera, worldPoint);

export const effectScreenPoint = (camera, effect) => worldProjection(camera, {
  x: effect.worldX,
  y: effect.worldY,
});

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

const cache = new Map();

function landmarks(seed) {
  const key = seed >>> 0;
  if (cache.has(key)) return cache.get(key);
  const random = randomFor(key);
  const items = [];
  for (let i = 0; i < 190; i++) {
    items.push({
      id: `star-${i}`,
      kind: 'star',
      worldX: -600 + random() * (W.w + 1200),
      worldY: -600 + random() * (W.h + 1200),
      size: random() < 0.1 ? 2 : 1,
      depth: random(),
    });
  }
  // Landmark spots are shares of the hull's world size.
  const at = (x, dx, y, dy) => ({ worldX: W.w * (x + random() * dx), worldY: W.h * (y + random() * dy) });
  items.push({ id: 'planet', kind: 'planet', ...at(0.113, 0.156, 0.133, 0.145), size: 220 });
  items.push({ id: 'ice', kind: 'ice', ...at(0.738, 0.122, 0.637, 0.133), size: 135 });
  items.push({ id: 'nebula', kind: 'nebula', ...at(0.582, 0.191, 0.347, 0.116), size: 820 });
  items.push({ id: 'hole', kind: 'hole', ...at(0.234, 0.486, 0.81, 0.104), size: 170 });
  cache.set(key, items);
  return items;
}

/** Return camera-visible landmarks while retaining their seeded world coordinates. */
export function visibleLandmarks(seed, camera) {
  const view = camera?.viewport || DEFAULT_WORLD;
  return landmarks(seed).filter(item => {
    const point = effectScreenPoint(camera, item);
    const margin = item.size * camera.scale;
    return point.x + margin >= 0 && point.x - margin <= view.w
      && point.y + margin >= 0 && point.y - margin <= view.h;
  });
}
