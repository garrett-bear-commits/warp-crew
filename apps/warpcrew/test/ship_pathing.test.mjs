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

// Expected points come from the layout, so this holds for whichever Sparrow art is installed.
const doorOf = (id) => SPARROW_LAYOUT.doors.find((door) => door.roomId === id);
const roomOf = (id) => SPARROW_LAYOUT.rooms.find((room) => room.id === id);
const spine = SPARROW_LAYOUT.halls.find((hall) => hall.id === 'spine');
const authored = pathRooms('sensors', 'engineering');
const expectedAuthored = [
  { ...doorOf('sensors').room, room: 'sensors', via: 'door-exit' },
  { ...doorOf('sensors').spine, room: null, via: 'spine' },
  // Engineering's door is at the top of the bay, where the spine ends (not through the reactor column).
  { ...doorOf('engineering').spine, room: null, via: 'spine' },
  { ...doorOf('engineering').room, room: 'engineering', via: 'door-enter' },
];
if (JSON.stringify(authored) !== JSON.stringify(expectedAuthored)) {
  throw new Error(`authored route ${JSON.stringify(authored)}`);
}
if (doorOf('engineering').room.y <= roomOf('engineering').top) throw new Error('engineering door opens from the top of the bay');

// Strict callers must receive a failure instead of the legacy destination fallback.
// Off-floor hull plating is the blocked case.
const engineeringSpot = roomOf('engineering').workAnchor;
if (isWalkablePct(10, 30)) throw new Error('hull plating outside the rooms must not be walkable');
if (findPath(10, 30, engineeringSpot.x, engineeringSpot.y, { strict: true }) !== null) {
  throw new Error('strict path accepted a start on hull plating');
}
if (findPath(-100, -100, engineeringSpot.x, engineeringSpot.y, { strict: true }) !== null) {
  throw new Error('strict path accepted an off-hull start');
}

// Doors are gaps, not walls: the strip between a side room and the spine is
// walkable only at its door.
const shields = roomOf('shields');
const gapX = (shields.left + shields.w + spine.left) / 2;
if (!isWalkablePct(gapX, doorOf('shields').room.y)) throw new Error('shields door gap blocked');
if (isWalkablePct(gapX, doorOf('shields').room.y - 4)) throw new Error('shields wall is walkable away from its door');

// Furniture blocks walking, and every room's work spot stays clear of it.
for (const blocker of SPARROW_LAYOUT.blockers) {
  const cx = blocker.left + blocker.width / 2;
  const cy = blocker.top + blocker.height / 2;
  if (isWalkablePct(cx, cy)) throw new Error(`${blocker.id} does not block walking`);
}
for (const room of SPARROW_LAYOUT.rooms) {
  if (!isWalkablePct(room.workAnchor.x, room.workAnchor.y)) throw new Error(`${room.id} work spot is blocked`);
}

// Departures and arrivals use the port airlock beside Cargo.
const { airlock, cargoDeparture } = SPARROW_LAYOUT.anchors;
for (const point of [airlock, cargoDeparture]) {
  if (!isWalkablePct(point.x, point.y)) throw new Error(`anchor ${JSON.stringify(point)} blocked`);
}
if (!findPath(cargoDeparture.x, cargoDeparture.y, airlock.x, airlock.y, { strict: true })) {
  throw new Error('cargo cannot reach the airlock');
}

console.log('ship_pathing.test.mjs OK');
