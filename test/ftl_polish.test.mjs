import assert from 'node:assert/strict';
import { renderOffscreenThreats } from '../src/ui/bridge.js';
import { makeCamera, focusCamera } from '../src/ui/shipCamera.js';
import { ROOMS, roomWorldPoint, HULL_PX, SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { isWalkablePct, findPath } from '../src/data/navGrid.js';

// Off-screen incoming fire: a chip at the edge for a charging gun aimed at a room out of view.
const world = { w: HULL_PX.w, h: HULL_PX.h };
const viewport = { w: 375, h: 240 };
const bridge = ROOMS.find(room => room.id === 'bridge');
const camera = focusCamera(makeCamera(viewport, world), roomWorldPoint(bridge), (375 / HULL_PX.w) * 1.12);
const encounter = gun => ({ ftl: true, result: null, downed: null,
  rooms: { engineering: { roomId: 'engineering' }, helm: { roomId: 'bridge' } },
  enemy: { weapons: [gun] } });
const root = { _wcCamera: camera };
const below = renderOffscreenThreats(root, encounter({ chargePct: 80, target: 'engineering' }));
assert.match(below, /data-camera="ftl-focus" data-room="engineering"/);
assert.match(below, /▼ Incoming · Engineering/);
assert.equal(renderOffscreenThreats(root, encounter({ chargePct: 20, target: 'engineering' })), '', 'not until the gun is half charged');
assert.equal(renderOffscreenThreats(root, encounter({ chargePct: 90, target: 'helm' })), '', 'a room in view needs no chip');
assert.equal(renderOffscreenThreats(root, { ...encounter({ chargePct: 90, target: 'engineering' }), downed: { enemyHull: 3 } }), '', 'no chips while downed');

// Furniture: crew never stand on props, every work spot and door stays reachable, and the airlock route is open.
assert.ok(SPARROW_LAYOUT.blockers.length >= 20, 'the v4 ship has furniture');
for (const blocker of SPARROW_LAYOUT.blockers) {
  const cx = blocker.left + blocker.width / 2;
  const cy = blocker.top + blocker.height / 2;
  assert.equal(isWalkablePct(cx, cy), false, `${blocker.id} blocks`);
}
for (const room of ROOMS) {
  assert.ok(isWalkablePct(room.workAnchor.x, room.workAnchor.y), `${room.id} work spot is clear`);
  const door = SPARROW_LAYOUT.doors.find(d => d.roomId === room.id);
  const path = findPath(door.room.x, door.room.y, room.workAnchor.x, room.workAnchor.y, { strict: true });
  assert.ok(path && path.length, `${room.id} work spot reachable from its door`);
}
const { cargoDeparture, airlock } = SPARROW_LAYOUT.anchors;
assert.ok(isWalkablePct(cargoDeparture.x, cargoDeparture.y), 'crew can reach the airlock from Cargo');
console.log('ftl_polish.test.mjs OK');
