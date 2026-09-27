const SHIP_REFERENCE = Object.freeze({ w: 1152, h: 1728 });
const BATTLE_MARGIN = 1.55;
const SMALLEST_AUTHORED_ROOM_WIDTH = 0.19;
const ROOMS_ACROSS_AT_NEAR_LIMIT = 2.5;
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
  const focusedRoomWidth = world.w * SMALLEST_AUTHORED_ROOM_WIDTH;
  const minScale = Math.min(
    viewport.w / (world.w * BATTLE_MARGIN),
    viewport.h / (world.h * BATTLE_MARGIN),
  );
  const targetScale = Math.max(
    MIN_STATION_TARGET / focusedRoomWidth,
    viewport.w / (ROOMS_ACROSS_AT_NEAR_LIMIT * focusedRoomWidth),
  );
  const maxScale = Math.max(targetScale, minScale);
  return { minScale, maxScale };
}

function axisBounds(viewportSize, renderedSize) {
  if (renderedSize <= viewportSize) {
    const centeredOrigin = (viewportSize - renderedSize) / 2;
    return { min: centeredOrigin, max: centeredOrigin };
  }
  const overlap = Math.min(viewportSize, renderedSize * 0.2);
  return { min: overlap - renderedSize, max: viewportSize - overlap };
}

/** Keep at least 20% of the rendered world, or the whole viewport, visible per axis. */
export function clampCamera(camera) {
  const viewport = normalizedViewport(camera.viewport);
  const world = normalizedWorld(camera.world);
  const { minScale, maxScale } = scaleLimits(viewport, world);
  const scale = Math.max(minScale, Math.min(maxScale, finite(camera.scale, minScale)));
  const renderedW = world.w * scale;
  const renderedH = world.h * scale;
  const xBounds = axisBounds(viewport.w, renderedW);
  const yBounds = axisBounds(viewport.h, renderedH);

  return {
    ...camera,
    x: Math.max(xBounds.min, Math.min(xBounds.max, finite(camera.x, viewport.w / 2))),
    y: Math.max(yBounds.min, Math.min(yBounds.max, finite(camera.y, viewport.h / 2))),
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
