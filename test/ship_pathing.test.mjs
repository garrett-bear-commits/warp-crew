import { SPARROW_LAYOUT, pathRooms } from '../src/data/starterShip.js';
import {
  findPath,
  isWalkablePct,
  nearestWalkableInRoom,
} from '../src/data/navGrid.js';

for (const from of SPARROW_LAYOUT.rooms) {
  const start = nearestWalkableInRoom(from.id, 0.25);
  if (!isWalkablePct(start.x, start.y)) {
    throw new Error(`${from.id} start blocked`);
  }
  for (const to of SPARROW_LAYOUT.rooms) {
    const end = nearestWalkableInRoom(to.id, 0.75);
    const path = findPath(start.x, start.y, end.x, end.y);
    if (!path.length) throw new Error(`${from.id} -> ${to.id} empty`);
    for (const point of path) {
      if (!isWalkablePct(point.x, point.y)) {
        throw new Error(`${from.id} -> ${to.id} crosses blocked space at ${point.x},${point.y}`);
      }
    }
  }
}

const authored = pathRooms('operations', 'engineering');
const expectedAuthored = [
  { x: 47, y: 32, room: 'operations', via: 'door-exit' },
  { x: 48, y: 32, room: null, via: 'spine' },
  { x: 52, y: 79.5, room: null, via: 'spine' },
  { x: 54, y: 79.5, room: 'engineering', via: 'door-enter' },
];
if (JSON.stringify(authored) !== JSON.stringify(expectedAuthored)) {
  throw new Error(`authored route ${JSON.stringify(authored)}`);
}

// Strict callers must receive a failure instead of the legacy destination fallback.
if (findPath(50, 17.5, 56, 84, { strict: true }) !== null) {
  throw new Error('strict path accepted a blocked bridge chair start');
}
if (findPath(-100, -100, 56, 84, { strict: true }) !== null) {
  throw new Error('strict path accepted an off-hull start');
}

console.log('ship_pathing.test.mjs OK');
