// @ts-nocheck
/** Authored door graph plus collision-checked walking segments. */
import { DOOR_ROUTE_GRAPH, SPARROW_LAYOUT } from './starterShip.js';
import { findPath, isWalkablePct } from './navGrid.js';

const disconnected = () => ({ ok: false, reason: 'disconnected' });

function graphRoute(from, to) {
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const node = path.at(-1);
    if (node === to) return path;
    for (const next of DOOR_ROUTE_GRAPH[node] || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

function segmentWalkable(from, to) {
  const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkablePct(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
  }
  return true;
}

function pathSegment(from, to, room, via, nextRoom) {
  const points = findPath(from.x, from.y, to.x, to.y, { strict: true });
  if (!points?.length) return null;
  let previous = from;
  for (const point of points) {
    if (!segmentWalkable(previous, point)) return null;
    previous = point;
  }
  return points.map((point, index) => ({
    x: point.x,
    y: point.y,
    room: index === points.length - 1 ? nextRoom : room,
    ...(index === points.length - 1 && via ? { via } : {}),
  }));
}

/** Return a walk to the room's work marker, or an explicit disconnected result. */
export function routeToWorkAnchor(from, roomId) {
  const source = SPARROW_LAYOUT.rooms.find((room) => room.id === from?.room);
  const target = SPARROW_LAYOUT.rooms.find((room) => room.id === roomId);
  if (!source || !target || !Number.isFinite(from.x) || !Number.isFinite(from.y)) return disconnected();
  if (!isWalkablePct(from.x, from.y)) return disconnected();

  const points = [];
  let current = { x: from.x, y: from.y };
  let room = source.id;
  const append = (destination, via = null, nextRoom = room) => {
    const segment = pathSegment(current, destination, room, via, nextRoom);
    if (!segment) return false;
    points.push(...segment);
    current = destination;
    room = nextRoom;
    return true;
  };

  if (source.id !== target.id) {
    const graphPath = graphRoute(source.id, target.id);
    if (!graphPath || graphPath.length !== 3 || graphPath[1] !== 'spine') return disconnected();
    const sourceDoor = SPARROW_LAYOUT.doors.find((door) => door.roomId === source.id);
    const targetDoor = SPARROW_LAYOUT.doors.find((door) => door.roomId === target.id);
    if (!sourceDoor || !targetDoor) return disconnected();
    if (!append(sourceDoor.room, 'door-exit')) return disconnected();
    if (!append(sourceDoor.spine)) return disconnected();
    if (!append(targetDoor.spine)) return disconnected();
    if (!append(targetDoor.room, 'door-enter', target.id)) return disconnected();
  }
  if (!append(target.workAnchor, null, target.id)) return disconnected();
  return { ok: true, points };
}
