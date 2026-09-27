import {
  SPARROW_LAYOUT,
  roomAtExact,
  validateSparrowLayout,
} from '../src/data/starterShip.js';

const expectedIds = [
  'bridge',
  'operations',
  'medbay',
  'quarters',
  'workshop',
  'cargo',
  'mess',
  'stores',
  'engineering',
];

const ids = SPARROW_LAYOUT.rooms.map((room) => room.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
  throw new Error(`room ids ${ids.join(',')}`);
}

const errors = validateSparrowLayout();
if (errors.length) throw new Error(errors.join('\n'));

for (const room of SPARROW_LAYOUT.rooms) {
  const hit = roomAtExact(room.workAnchor.x, room.workAnchor.y);
  if (hit?.id !== room.id) {
    throw new Error(`${room.id} work anchor resolves to ${hit?.id}`);
  }
}

if (roomAtExact(50, 64) !== null) {
  throw new Error('central spine must not select a room');
}

console.log('ship_layout.test.mjs OK');
