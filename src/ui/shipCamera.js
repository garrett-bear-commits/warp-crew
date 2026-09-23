const SHIP_REFERENCE = Object.freeze({ w: 1152, h: 1728 });
const BATTLE_MARGIN = 1.55;
const FOCUSED_STATION_REFERENCE = 64;
const MIN_STATION_TARGET = 44;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveSize(value, fallback) {
  const size = finite(value, fallback);
  return size > 0 ? size : fallback;
}

function normalizedViewport(viewport) {
  return { w: positiveSize(viewport?.w, 1), h: positiveSize(viewport?.h, 1) };
}

function normalizedWorld(world) {
  return { w: positiveSize(world?.w, SHIP_REFERENCE.w), h: positiveSize(world?.h, SHIP_REFERENCE.h) };
}

function scaleLimits(viewport, world) {
  const minScale = Math.min(
    viewport.w / (world.w * BATTLE_MARGIN),
    viewport.h / (world.h * BATTLE_MARGIN),
  );
  const maxScale = Math.max(MIN_STATION_TARGET / FOCUSED_STATION_REFERENCE, minScale);
  return { minScale, maxScale };
}

/** Keep a meaningful slice of each world axis on screen, while allowing a full frame. */
export function clampCamera(camera) {
  const viewport = normalizedViewport(camera.viewport);
  const world = normalizedWorld(camera.world);
  const { minScale, maxScale } = scaleLimits(viewport, world);
  const scale = Math.max(minScale, Math.min(maxScale, finite(camera.scale, minScale)));
  const renderedW = world.w * scale;
  const renderedH = world.h * scale;
  const minX = renderedW <= viewport.w ? viewport.w - renderedW : viewport.w - renderedW * 0.8;
  const maxX = renderedW <= viewport.w ? 0 : renderedW * 0.2;
  const minY = renderedH <= viewport.h ? viewport.h - renderedH : viewport.h - renderedH * 0.8;
  const maxY = renderedH <= viewport.h ? 0 : renderedH * 0.2;

  return {
    ...camera,
    x: Math.max(minX, Math.min(maxX, finite(camera.x, viewport.w / 2))),
    y: Math.max(minY, Math.min(maxY, finite(camera.y, viewport.h / 2))),
    scale,
    minScale,
    maxScale,
    viewport,
    world,
  };
}

export function makeCamera(viewport, world, focus, scale) {
  const safeViewport = normalizedViewport(viewport);
  const safeWorld = normalizedWorld(world);
  const limits = scaleLimits(safeViewport, safeWorld);
  const safeScale = Math.max(limits.minScale, Math.min(limits.maxScale, finite(scale, limits.minScale)));
  const focusX = finite(focus?.x, safeWorld.w / 2);
  const focusY = finite(focus?.y, safeWorld.h / 2);
  return clampCamera({
    x: safeViewport.w / 2 - focusX * safeScale,
    y: safeViewport.h / 2 - focusY * safeScale,
    scale: safeScale,
    minScale: limits.minScale,
    maxScale: limits.maxScale,
    viewport: safeViewport,
    world: safeWorld,
  });
}

export const project = (camera, point) => ({
  x: camera.x + finite(point?.x, 0) * camera.scale,
  y: camera.y + finite(point?.y, 0) * camera.scale,
});

export const unproject = (camera, point) => ({
  x: (finite(point?.x, 0) - camera.x) / camera.scale,
  y: (finite(point?.y, 0) - camera.y) / camera.scale,
});

export function pan(camera, dx, dy) {
  return clampCamera({
    ...camera,
    x: camera.x + finite(dx, 0),
    y: camera.y + finite(dy, 0),
  });
}

export function zoomAt(camera, factor, anchor) {
  const safeAnchor = { x: finite(anchor?.x, camera.viewport.w / 2), y: finite(anchor?.y, camera.viewport.h / 2) };
  const worldPoint = unproject(camera, safeAnchor);
  const zoomFactor = finite(factor, 1);
  const scale = Math.max(camera.minScale, Math.min(camera.maxScale, camera.scale * zoomFactor));
  return clampCamera({
    ...camera,
    scale,
    x: safeAnchor.x - worldPoint.x * scale,
    y: safeAnchor.y - worldPoint.y * scale,
  });
}

export function resizeCamera(camera, viewport) {
  const safeViewport = normalizedViewport(viewport);
  const center = { x: camera.viewport.w / 2, y: camera.viewport.h / 2 };
  const worldCenter = unproject(camera, center);
  const { minScale, maxScale } = scaleLimits(safeViewport, camera.world);
  const scale = Math.max(minScale, Math.min(maxScale, camera.scale));
  return clampCamera({
    ...camera,
    x: safeViewport.w / 2 - worldCenter.x * scale,
    y: safeViewport.h / 2 - worldCenter.y * scale,
    scale,
    minScale,
    maxScale,
    viewport: safeViewport,
  });
}

export function focusCamera(camera, worldPoint, targetScale = camera.scale) {
  const safeScale = Math.max(camera.minScale, Math.min(camera.maxScale, finite(targetScale, camera.scale)));
  return clampCamera({
    ...camera,
    x: camera.viewport.w / 2 - finite(worldPoint?.x, camera.world.w / 2) * safeScale,
    y: camera.viewport.h / 2 - finite(worldPoint?.y, camera.world.h / 2) * safeScale,
    scale: safeScale,
  });
}
