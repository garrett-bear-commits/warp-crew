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

const authored = pathRooms('sensors', 'engineering');
const expectedAuthored = [
  { x: 43.2, y: 42, room: 'sensors', via: 'door-exit' },
  { x: 50, y: 42, room: null, via: 'spine' },
  { x: 50, y: 80, room: null, via: 'spine' },
  { x: 45.5, y: 80, room: 'engineering', via: 'door-enter' },
];
if (JSON.stringify(authored) !== JSON.stringify(expectedAuthored)) {
  throw new Error(`authored route ${JSON.stringify(authored)}`);
}

// Strict callers must receive a failure instead of the legacy destination fallback.
// (The v4 layout has no furniture blockers; off-floor hull plating is the blocked case.)
if (isWalkablePct(10, 30)) throw new Error('hull plating outside the rooms must not be walkable');
if (findPath(10, 30, 39.7, 82.3, { strict: true }) !== null) {
  throw new Error('strict path accepted a start on hull plating');
}
if (findPath(-100, -100, 39.7, 82.3, { strict: true }) !== null) {
  throw new Error('strict path accepted an off-hull start');
}

// Doors are gaps, not walls: the strip between a side room and the spine is
// walkable only at its door.
if (!isWalkablePct(44.8, 30)) throw new Error('shields door gap blocked');
if (isWalkablePct(44.8, 25)) throw new Error('shields wall is walkable away from its door');

// Departures and arrivals use the port airlock beside Cargo.
const { airlock, cargoDeparture } = SPARROW_LAYOUT.anchors;
for (const point of [airlock, cargoDeparture]) {
  if (!isWalkablePct(point.x, point.y)) throw new Error(`anchor ${JSON.stringify(point)} blocked`);
}
if (!findPath(cargoDeparture.x, cargoDeparture.y, airlock.x, airlock.y, { strict: true })) {
  throw new Error('cargo cannot reach the airlock');
}

console.log('ship_pathing.test.mjs OK');
