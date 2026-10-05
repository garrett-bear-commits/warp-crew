import { readFileSync } from 'node:fs';
import {
  HULL_PX,
  SPARROW_LAYOUT,
  canonicalRoomId,
  roomAtExact,
  roomById,
  validateSparrowLayout,
} from '../src/data/starterShip.js';
import { STATIONS } from '../src/systems/stations.js';

const source = JSON.parse(readFileSync(new URL('../src/data/art/sparrowV4Layout.json', import.meta.url), 'utf8'));

// Rooms follow the v4 art, bow to stern, port before starboard.
const expectedIds = [
  'bridge',
  'shields',
  'weapons',
  'sensors',
  'medbay',
  'quarters',
  'mess',
  'cargo',
  'armory',
  'engineering',
];

const ids = SPARROW_LAYOUT.rooms.map((room) => room.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
  throw new Error(`room ids ${ids.join(',')}`);
}

// One source of truth: the world size and geometry come from the measured layout JSON.
if (HULL_PX.w !== source.sourceSize.width || HULL_PX.h !== source.sourceSize.height) {
  throw new Error(`hull size ${HULL_PX.w}x${HULL_PX.h} does not match the layout`);
}
for (const authored of source.rooms) {
  const room = SPARROW_LAYOUT.rooms.find((candidate) => candidate.id === authored.id);
  if (room.label !== authored.label || room.left !== authored.left || room.w !== authored.width) {
    throw new Error(`${authored.id} differs from the layout JSON`);
  }
}
if (SPARROW_LAYOUT.effects.thrusters.length !== 4) throw new Error('v4 has four engine bells');

const errors = validateSparrowLayout();
if (errors.length) throw new Error(errors.join('\n'));

for (const room of SPARROW_LAYOUT.rooms) {
  const hit = roomAtExact(room.workAnchor.x, room.workAnchor.y);
  if (hit?.id !== room.id) {
    throw new Error(`${room.id} work anchor resolves to ${hit?.id}`);
  }
}

if (roomAtExact(50, 50) !== null) {
  throw new Error('central spine must not select a room');
}

// The four fight stations stand in the rooms named after their systems.
const stationRooms = Object.fromEntries(Object.entries(STATIONS).map(([id, station]) => [id, station.roomId]));
if (JSON.stringify(stationRooms) !== JSON.stringify({ helm: 'bridge', shields: 'shields', weapons: 'weapons', engineering: 'engineering' })) {
  throw new Error(`station rooms ${JSON.stringify(stationRooms)}`);
}
for (const station of Object.values(STATIONS)) {
  if (!ids.includes(station.roomId)) throw new Error(`station room ${station.roomId} missing`);
}

// v3 room ids still resolve.
for (const [old, now] of [['operations', 'sensors'], ['workshop', 'weapons'], ['stores', 'armory'], ['cargo', 'cargo']]) {
  if (canonicalRoomId(old) !== now || roomById(old).id !== now) throw new Error(`${old} should resolve to ${now}`);
}
if (canonicalRoomId(null) !== null) throw new Error('no room stays no room');

console.log('ship_layout.test.mjs OK');
