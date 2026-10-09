# Task 4 report: door-truthful station walks

Local commit: `9445abd` (`fix: route crew through visible ship doors`). The report itself is in the ignored `.superpowers/sdd` coordination directory and is not part of the commit.

## Result

Implemented authored door routing in `src/data/shipRoutes.js`. Every route segment uses strict A* and sampled walkability checks; a disconnected route returns `{ ok: false, reason: 'disconnected' }`. Ambient, contract station, arrival, and departure walks use this route. Failures leave the actor at its last valid position, log `[crew-route]`, and still settle departure/arrival callbacks. Room identity changes only at `door-enter`. Reduced-motion snaps remain available only after a complete route validates. Simulation and combat resolution do not await decorative walks.

The crew canvas draws subtle spine, door, and work-anchor markers above the unchanged 1,152×1,728 hull art. The actor coordinate system remains hull-relative percentages.

## TDD evidence

- RED: `node test/crew_walk_routes.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/data/shipRoutes.js` before implementation.
- GREEN: `node test/crew_walk_routes.test.mjs` exits 0 (`crew_walk_routes.test.mjs OK`). It checks every authored room pair, sampled walkability of every segment, door exit/entry markers, exact work anchor, and invalid/blocked requests.
- The first `npm run test:loop` after adding canvas markers exited 1: the existing canvas test double lacked `setLineDash`, preventing its departure trace. Reworked markers to use `fillRect`, then reran the suite green.

## Final verification

- `node test/crew_walk_routes.test.mjs`: PASS.
- `npm run test:ship`: PASS, five ship tests.
- `npm run test:loop`: PASS, including `contract_ship_feedback.test.mjs` and 15 final-review subtests.
- `npm test`: PASS, including 15 final-review subtests.
- `npm run build`: PASS, Vite transformed 56 modules.
- `git diff --check`: PASS.

## Files

- `src/data/starterShip.js`: physical door/spine graph.
- `src/data/navGrid.js`: strict A* failure mode while preserving the legacy default.
- `src/data/shipRoutes.js`: validated work-anchor route.
- `src/ui/crewWalk.js`: route consumption, failure handling, canvas wayfinding.
- `test/crew_walk_routes.test.mjs`: all room-pair route behavior and failures.
- `test/ship_pathing.test.mjs`: strict path rejection cases.

## Self-review and remaining check

The physical graph is a star because the current Sparrow layout has one spine and one door per room. No reverse import was introduced: `shipRoutes.js` imports the layout and pathfinder. Existing legacy `findPath` behavior remains the default for other callers. I inspected the route-point traces through tests; I did not inspect a close-zoom screen recording of bridge→engineering and engineering→workshop. That visual acceptance check remains for integration QA. User-owned untracked `Mobile Game UI.jpg` and `package-lock.json` were not changed or staged.

## Review fix round 1

Local review-fix commit: `832f544` (`fix: preserve door routes and unblock expedition controls`).

Root causes: a mid-walk actor retains its previous `room` while physically on the spine, so a same-room reroute could skip door markers; `departureInFlight` also blocked committed expedition controls in both the action handler and rendered buttons.

RED evidence:

- `node test/crew_walk_routes.test.mjs` exited 1 at the new spine-to-Bridge assertion: no `door-enter` point was present.
- `node test/contract_ship_feedback.test.mjs` exited 1 because `cancelCrewDeparture` did not exist before the callback cleanup behavior was implemented. Existing controls had been disabled by `departureActionBlocked` and `departureLock`.

GREEN evidence after the focused fix:

- `node test/crew_walk_routes.test.mjs`: PASS.
- `node test/contract_ship_feedback.test.mjs`: PASS.
- `npm run test:ship`: PASS (five ship tests).
- `npm run test:loop`: PASS (including the ship-feedback test and 15 final-review subtests).
- `npm test`: PASS (including 15 final-review subtests).
- `npm run build`: PASS (Vite transformed 56 modules).
- `git diff --check`: PASS.

Changed files in the review fix: `src/data/shipRoutes.js`, `src/main.js`, `src/ui/bridge.js`, `src/ui/crewWalk.js`, `test/crew_walk_routes.test.mjs`, and `test/contract_ship_feedback.test.mjs`. Routes now derive the origin from physical room geometry, or from the spine when between rooms. Claim, Skip, and Extract render enabled immediately after the persisted start; the existing `sessionAction` guard against another start still keys off `activeExpedition`. When a resolved action is saved, the current boarding animation is cancelled and its generation invalidated, so an old completion cannot alter the newer presentation state. The visual recording check above remains outstanding.
