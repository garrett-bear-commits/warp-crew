### Task 4: Door-truthful station walks

**Files:** Create `src/data/shipRoutes.js`, `test/crew_walk_routes.test.mjs`; modify `src/data/starterShip.js`, `src/data/navGrid.js`, `src/ui/crewWalk.js`; extend `test/ship_pathing.test.mjs`.

**Interfaces:** `routeToWorkAnchor(from, roomId)` returns `{ ok:true, points }` or `{ ok:false, reason:'disconnected' }`; each point is walkable and transitions rooms only at an authored `door-enter`/`door-exit`. `crewTargetStates(player, options)` consumes persisted station assignments from Task 5; until Task 5 it uses the existing bridge/engineering targets.

- [ ] **Step 1: Write failing route test**:

```js
import assert from 'node:assert/strict';
import { routeToWorkAnchor } from '../src/data/shipRoutes.js';
import { isWalkablePct } from '../src/data/navGrid.js';
const route = routeToWorkAnchor({ x: 56, y: 20, room: 'bridge' }, 'engineering');
assert.equal(route.ok, true);
assert.ok(route.points.some(p => p.via === 'door-enter'));
assert.ok(route.points.every(p => isWalkablePct(p.x, p.y)));
assert.deepEqual(routeToWorkAnchor({ x: -100, y: -100, room: 'missing' }, 'engineering'), { ok: false, reason: 'disconnected' });
```

- [ ] **Step 2: Run** `node test/crew_walk_routes.test.mjs`; expect missing export.
- [ ] **Step 3: Implement** graph-based route in `shipRoutes.js` (which imports both `starterShip.js` and `navGrid.js`, avoiding a reverse import cycle) to the room's `workAnchor`; validate every path segment against `isWalkablePct` and return failure instead of nearest-room teleport fallback. Preserve the actor on failure:

```js
const route = routeToWorkAnchor({ x: actor.x, y: actor.y, room: actor.room }, destinationRoom);
if (!route.ok) { console.warn('[crew-route]', actor.id, route.reason); return; }
actor.path = route.points;
```

Make station doors/hall and work markers visibly clear in the cutaway without replacing the 1,152×1,728 reference art. Simulation never waits for decorative arrival.
- [ ] **Step 4: Run** `node test/crew_walk_routes.test.mjs`, `npm run test:ship`; inspect a screen recording of bridge→engineering and engineering→weapons at close zoom; expect door crossings and no hull jump.
- [ ] **Step 5: Commit** `fix: route crew through visible ship doors` with task files only.

