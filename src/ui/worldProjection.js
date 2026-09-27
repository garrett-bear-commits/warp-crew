import { project } from './shipCamera.js';

const DEFAULT_WORLD = { w: 1152, h: 1728 };

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
      worldX: -600 + random() * 2352,
      worldY: -600 + random() * 2928,
      size: random() < 0.1 ? 2 : 1,
      depth: random(),
    });
  }
  items.push({ id: 'planet', kind: 'planet', worldX: 130 + random() * 180, worldY: 230 + random() * 250, size: 220 });
  items.push({ id: 'ice', kind: 'ice', worldX: 850 + random() * 140, worldY: 1100 + random() * 230, size: 135 });
  items.push({ id: 'nebula', kind: 'nebula', worldX: 670 + random() * 220, worldY: 600 + random() * 200, size: 820 });
  items.push({ id: 'hole', kind: 'hole', worldX: 270 + random() * 560, worldY: 1400 + random() * 180, size: 170 });
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
