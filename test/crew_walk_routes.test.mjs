import assert from 'node:assert/strict';
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { isWalkablePct } from '../src/data/navGrid.js';
import { routeToWorkAnchor } from '../src/data/shipRoutes.js';

// A destination shortcut, blocked segment, or missing authored door should fail these routes.
function assertWalkableRoute(from, destination, route) {
  assert.equal(route.ok, true, `${from.room} -> ${destination}: ${route.reason}`);
  assert.ok(route.points.length > 0);
  let previous = from;
  let entered = from.room === destination;
  for (const point of route.points) {
    assert.ok(isWalkablePct(point.x, point.y), `${destination} blocked point ${JSON.stringify(point)}`);
    const steps = Math.max(2, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) * 4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      assert.ok(isWalkablePct(previous.x + (point.x - previous.x) * t, previous.y + (point.y - previous.y) * t), `${destination} blocked segment ${JSON.stringify(previous)} -> ${JSON.stringify(point)}`);
    }
    if (point.room === destination && from.room !== destination && !entered) {
      assert.equal(point.via, 'door-enter', `entered ${destination} without an authored door`);
      entered = true;
    }
    previous = point;
  }
  const anchor = SPARROW_LAYOUT.rooms.find((room) => room.id === destination).workAnchor;
  assert.deepEqual({ x: previous.x, y: previous.y }, anchor);
  if (from.room !== destination) {
    assert.ok(route.points.some((point) => point.via === 'door-exit'));
    assert.ok(route.points.some((point) => point.via === 'door-enter'));
  }
}

for (const fromRoom of SPARROW_LAYOUT.rooms) {
  for (const toRoom of SPARROW_LAYOUT.rooms) {
    const from = { ...fromRoom.workAnchor, room: fromRoom.id };
    assertWalkableRoute(from, toRoom.id, routeToWorkAnchor(from, toRoom.id));
  }
}

assert.deepEqual(
  routeToWorkAnchor({ x: -100, y: -100, room: 'missing' }, 'engineering'),
  { ok: false, reason: 'disconnected' },
);
assert.deepEqual(
  routeToWorkAnchor({ x: 56, y: 20, room: 'bridge' }, 'missing'),
  { ok: false, reason: 'disconnected' },
);
assert.deepEqual(
  routeToWorkAnchor({ x: 50, y: 17.5, room: 'bridge' }, 'engineering'),
  { ok: false, reason: 'disconnected' },
);

console.log('crew_walk_routes.test.mjs OK');
