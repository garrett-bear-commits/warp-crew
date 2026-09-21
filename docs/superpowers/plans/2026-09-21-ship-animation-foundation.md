# Ship and Animation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sparrow's four coarse interaction rectangles and tiny bobbing crew with nine art-aligned rooms, shared movement geometry, and stable, readable four-direction animation on phones.

**Architecture:** `src/data/starterShip.js` becomes the single manifest for room input, pathing, labels, doors, blockers, and effects. Pure animation math moves into `src/ui/crewAnimation.js`; the canvas renderer consumes profiles rather than guessing crop and scale. `bridge.js` keeps orchestration while room geometry rendering is extracted to a focused `shipView.js` helper.

**Tech Stack:** Vite 6, browser Canvas 2D, ES modules, direct Node assertion scripts, CSS, existing Jest platform facade.

**Spec:** `docs/design/21-ship-animation-foundation.md`

## Global Constraints

- Preserve current game rules, currencies, content catalogs, and player save schema.
- Use `public/art/space/sparrow-hull-v3.png` at 1152 by 1728 as the geometry reference.
- Preserve Ninefold row order: down, left, right, up.
- Use the sheet's actual frames; add no sine wave, CSS translation, or state-specific vertical bob.
- Keep actor feet stationary when frame or direction changes.
- Room and HUD touch targets must be at least 44 by 44 CSS pixels at 390 by 844.
- Do not activate or deploy production.
- Keep `Mobile Game UI.jpg` and `package-lock.json` out of every package commit unless the user explicitly assigns them to the package.

---

### Task 1: Create the authoritative Sparrow manifest

**Files:**
- Modify: `src/data/starterShip.js`
- Create: `test/ship_layout.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `SPARROW_LAYOUT`, `ROOMS`, `roomById(id)`, `roomAtExact(x, y)`, `pointInPolygon(x, y, points)`, `validateSparrowLayout()`.
- Preserves: `HULL_PX`, `HALLWAYS`, `ROOM_GRAPH`, `DOOR_PTS`, `FURNITURE`, `THRUSTERS`, `homeRoomId()`, `doorPoint()`, `pathRooms()`, and `roomAt()` as compatibility exports until Task 2 migrates callers.

- [ ] **Step 1: Write the failing manifest test**

```js
import {
  SPARROW_LAYOUT,
  roomAtExact,
  validateSparrowLayout,
} from '../src/data/starterShip.js';

const ids = SPARROW_LAYOUT.rooms.map((room) => room.id);
const expected = [
  'bridge', 'operations', 'medbay', 'quarters', 'workshop',
  'cargo', 'mess', 'stores', 'engineering',
];
if (JSON.stringify(ids) !== JSON.stringify(expected)) {
  throw new Error(`room ids ${ids.join(',')}`);
}
const errors = validateSparrowLayout();
if (errors.length) throw new Error(errors.join('\n'));
for (const room of SPARROW_LAYOUT.rooms) {
  const hit = roomAtExact(room.workAnchor.x, room.workAnchor.y);
  if (hit?.id !== room.id) throw new Error(`${room.id} work anchor resolves to ${hit?.id}`);
}
if (roomAtExact(50, 64) !== null) throw new Error('central spine must not select a room');
console.log('ship_layout.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify the missing exports fail**

Run: `node test/ship_layout.test.mjs`  
Expected: FAIL because `SPARROW_LAYOUT` is not exported.

- [ ] **Step 3: Implement the manifest and exact hit testing**

Use these exact room, door, hall, blocker, and effect records as the first calibrated manifest:

```js
const rectPolygon = (left, top, width, height) => [
  { x: left, y: top },
  { x: left + width, y: top },
  { x: left + width, y: top + height },
  { x: left, y: top + height },
];

const room = ({ id, label, system = null, role = null, left, top, width, height, workAnchor, doorId }) => ({
  id,
  name: label,
  label,
  system,
  role,
  hitPolygon: rectPolygon(left, top, width, height),
  walkBounds: { left, top, width, height },
  workAnchor,
  labelAnchor: { x: left + width / 2, y: top + height / 2 },
  doorId,
  left,
  top,
  w: width,
  h: height,
  walkX: workAnchor.x,
  walkY: workAnchor.y,
});

export const SPARROW_LAYOUT = {
  sourceSize: { width: 1152, height: 1728 },
  rooms: [
    room({ id: 'bridge', label: 'Bridge', role: 'pilot', left: 38, top: 10, width: 24, height: 13, workAnchor: { x: 56, y: 20 }, doorId: 'door_bridge' }),
    room({ id: 'operations', label: 'Operations', system: 'sensors', role: 'scout', left: 28, top: 25, width: 19, height: 14, workAnchor: { x: 43, y: 35 }, doorId: 'door_operations' }),
    room({ id: 'medbay', label: 'Medbay', system: 'medbay', role: 'medic', left: 54, top: 25, width: 19, height: 14, workAnchor: { x: 58, y: 35 }, doorId: 'door_medbay' }),
    room({ id: 'quarters', label: 'Quarters', system: 'quarters', left: 27, top: 40, width: 20, height: 14, workAnchor: { x: 45, y: 52 }, doorId: 'door_quarters' }),
    room({ id: 'workshop', label: 'Workshop', system: 'weapons', role: 'gunner', left: 54, top: 40, width: 20, height: 14, workAnchor: { x: 64, y: 51 }, doorId: 'door_workshop' }),
    room({ id: 'cargo', label: 'Cargo Hold', system: 'cargo', role: 'trader', left: 25, top: 56, width: 22, height: 16, workAnchor: { x: 45, y: 69 }, doorId: 'door_cargo' }),
    room({ id: 'mess', label: 'Mess', left: 54, top: 56, width: 21, height: 16, workAnchor: { x: 56, y: 69 }, doorId: 'door_mess' }),
    room({ id: 'stores', label: 'Stores', system: 'cargo', role: 'security', left: 24, top: 73, width: 23, height: 13, workAnchor: { x: 45, y: 84 }, doorId: 'door_stores' }),
    room({ id: 'engineering', label: 'Engineering', system: 'engines', role: 'engineer', left: 54, top: 73, width: 22, height: 13, workAnchor: { x: 56, y: 84 }, doorId: 'door_engineering' }),
  ],
  doors: [
    { id: 'door_bridge', roomId: 'bridge', room: { x: 50, y: 22 }, spine: { x: 50, y: 24 } },
    { id: 'door_operations', roomId: 'operations', room: { x: 47, y: 32 }, spine: { x: 48, y: 32 } },
    { id: 'door_medbay', roomId: 'medbay', room: { x: 54, y: 32 }, spine: { x: 52, y: 32 } },
    { id: 'door_quarters', roomId: 'quarters', room: { x: 47, y: 47 }, spine: { x: 48, y: 47 } },
    { id: 'door_workshop', roomId: 'workshop', room: { x: 54, y: 47 }, spine: { x: 52, y: 47 } },
    { id: 'door_cargo', roomId: 'cargo', room: { x: 47, y: 64 }, spine: { x: 48, y: 64 } },
    { id: 'door_mess', roomId: 'mess', room: { x: 54, y: 64 }, spine: { x: 52, y: 64 } },
    { id: 'door_stores', roomId: 'stores', room: { x: 47, y: 79.5 }, spine: { x: 48, y: 79.5 } },
    { id: 'door_engineering', roomId: 'engineering', room: { x: 54, y: 79.5 }, spine: { x: 52, y: 79.5 } },
  ],
  halls: [
    { id: 'spine', left: 47.5, top: 22, width: 5, height: 67 },
  ],
  blockers: [
    { id: 'bridge_chair', shape: 'ellipse', x: 50, y: 17.5, rx: 2.5, ry: 4 },
    { id: 'operations_console', shape: 'rect', left: 28.5, top: 26, width: 12, height: 5 },
    { id: 'medbay_bed', shape: 'rect', left: 63.2, top: 26.5, width: 6.5, height: 10.5 },
    { id: 'quarters_bunks', shape: 'rect', left: 28, top: 41, width: 15, height: 10 },
    { id: 'workshop_counter', shape: 'rect', left: 57, top: 41, width: 15, height: 4 },
    { id: 'cargo_crates', shape: 'rect', left: 26, top: 57, width: 15, height: 12 },
    { id: 'mess_table', shape: 'rect', left: 58, top: 58, width: 13, height: 8 },
    { id: 'stores_crates', shape: 'rect', left: 25, top: 74, width: 14, height: 9 },
    { id: 'engineering_machine', shape: 'rect', left: 59, top: 74, width: 13, height: 8 },
  ],
  effects: { thrusters: [{ x: 32.5, y: 91.2 }, { x: 67.5, y: 91.2 }] },
};

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function roomAtExact(x, y) {
  return SPARROW_LAYOUT.rooms.find((candidate) => pointInPolygon(x, y, candidate.hitPolygon)) || null;
}
```

`validateSparrowLayout()` must return string errors for duplicate IDs, polygons with fewer than three points, coordinates outside 0–100, missing or mismatched doors, unknown systems, work anchors outside their room, and room-center overlap. It must not throw so the test can report all defects together.

- [ ] **Step 4: Add and run the focused script**

Add `"test:ship": "node test/ship_layout.test.mjs"` to `scripts` in `package.json`.

Run: `npm run test:ship`  
Expected: `ship_layout.test.mjs OK`.

- [ ] **Step 5: Commit the manifest slice**

```sh
git add src/data/starterShip.js test/ship_layout.test.mjs package.json
git commit -m "feat: define Sparrow room manifest"
```

### Task 2: Derive pathing from the manifest

**Files:**
- Modify: `src/data/navGrid.js`
- Modify: `src/data/starterShip.js`
- Modify: `src/ui/crewWalk.js`
- Create: `test/ship_pathing.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SPARROW_LAYOUT`, `roomById()`, `roomAtExact()` from Task 1.
- Produces: `findPath(x0, y0, x1, y1)`, `isWalkablePct(x, y)`, `nearestWalkableInRoom(roomId, seed)`, and manifest-derived `pathRooms(from, to)`.

- [ ] **Step 1: Write the failing all-rooms reachability test**

```js
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { findPath, isWalkablePct, nearestWalkableInRoom } from '../src/data/navGrid.js';

for (const from of SPARROW_LAYOUT.rooms) {
  const start = nearestWalkableInRoom(from.id, 0.25);
  if (!isWalkablePct(start.x, start.y)) throw new Error(`${from.id} start blocked`);
  for (const to of SPARROW_LAYOUT.rooms) {
    const end = nearestWalkableInRoom(to.id, 0.75);
    const path = findPath(start.x, start.y, end.x, end.y);
    if (!path.length) throw new Error(`${from.id} -> ${to.id} empty`);
    for (const point of path) {
      if (!isWalkablePct(point.x, point.y)) throw new Error(`${from.id} -> ${to.id} crosses blocked space`);
    }
  }
}
console.log('ship_pathing.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify it fails on the new rooms**

Run: `node test/ship_pathing.test.mjs`  
Expected: FAIL because the grid still derives connectivity from the four-room graph.

- [ ] **Step 3: Build walkability from the manifest**

Update `navGrid.js` so `cellWalkable()` uses `room.walkBounds`, `SPARROW_LAYOUT.halls`, and `SPARROW_LAYOUT.blockers`. Replace the hardcoded room-name loop in `inDoor()` with `SPARROW_LAYOUT.doors`.

Build room routes through a virtual `spine` node:

```js
export function pathRooms(from, to) {
  if (from === to) return [];
  const fromDoor = SPARROW_LAYOUT.doors.find((door) => door.roomId === from);
  const toDoor = SPARROW_LAYOUT.doors.find((door) => door.roomId === to);
  if (!fromDoor || !toDoor) return [];
  return [
    { ...fromDoor.room, room: from, via: 'door-exit' },
    { ...fromDoor.spine, room: null, via: 'spine' },
    { ...toDoor.spine, room: null, via: 'spine' },
    { ...toDoor.room, room: to, via: 'door-enter' },
  ];
}
```

Update `crewWalk.js` in the same slice only enough to consume coordinate waypoints rather than treating every route hop as a room ID. A corridor coordinate must leave `a.room` unchanged until `door-enter`.

- [ ] **Step 4: Run layout and path tests**

Run: `node test/ship_layout.test.mjs`  
Expected: PASS.

Run: `node test/ship_pathing.test.mjs`  
Expected: `ship_pathing.test.mjs OK`.

- [ ] **Step 5: Commit the pathing slice**

```sh
git add src/data/starterShip.js src/data/navGrid.js src/ui/crewWalk.js test/ship_pathing.test.mjs package.json
git commit -m "feat: route crew through Sparrow manifest"
```

### Task 3: Add pure animation profiles and stable placement math

**Files:**
- Create: `src/ui/crewAnimation.js`
- Create: `test/crew_animation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `DIRECTION_ROW`, `ANIMATION_PROFILES`, `animationProfileFor(bodyFamily)`, `walkFrameSource(direction, frame, profile)`, and `walkFrameDestination(footX, footY, profile, displayHeight)`.

- [ ] **Step 1: Write the failing animation contract test**

```js
import {
  ANIMATION_PROFILES,
  walkFrameSource,
  walkFrameDestination,
} from '../src/ui/crewAnimation.js';

const profile = ANIMATION_PROFILES.standard_humanoid;
const expectedRows = { down: 0, left: 1, right: 2, up: 3 };
for (const [direction, row] of Object.entries(expectedRows)) {
  for (let frame = 0; frame < 8; frame++) {
    const source = walkFrameSource(direction, frame, profile);
    if (source.sy !== row * 96 + 12) throw new Error(`${direction} row ${source.sy}`);
    if (source.sx !== (frame % 4) * 96 + 24) throw new Error(`${direction} frame ${frame}`);
    if (source.sx + source.sw > 384 || source.sy + source.sh > 384) throw new Error('crop outside sheet');
  }
}
const baseline = walkFrameDestination(100, 200, profile, 52);
if (baseline.height !== 52 || baseline.width !== 52 * 48 / 72) throw new Error('display dimensions');
if (Math.abs(baseline.x + profile.footAnchor.x * baseline.scale - 100) > 0.001) throw new Error('foot x moved');
if (Math.abs(baseline.y + profile.footAnchor.y * baseline.scale - 200) > 0.001) throw new Error('foot y moved');
if (profile.displayHeight < 44) throw new Error('phone sprite too small');
console.log('crew_animation.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node test/crew_animation.test.mjs`  
Expected: FAIL with module-not-found for `crewAnimation.js`.

- [ ] **Step 3: Implement the pure module**

```js
export const DIRECTION_ROW = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });

export const ANIMATION_PROFILES = Object.freeze({
  standard_humanoid: Object.freeze({
    id: 'standard_humanoid',
    sourceCell: { width: 96, height: 96 },
    frameCrop: { x: 24, y: 12, width: 48, height: 72 },
    footAnchor: { x: 24, y: 66 },
    displayHeight: 52,
    shadow: { width: 18, height: 5, offsetY: 1 },
    framesPerDirection: 4,
    fps: 7,
  }),
});

export function animationProfileFor(bodyFamily = 'standard_humanoid') {
  return ANIMATION_PROFILES[bodyFamily] || ANIMATION_PROFILES.standard_humanoid;
}

export function walkFrameSource(direction, frame, profile = animationProfileFor()) {
  const row = DIRECTION_ROW[direction] ?? DIRECTION_ROW.down;
  const column = Math.floor(frame) % profile.framesPerDirection;
  return {
    sx: column * profile.sourceCell.width + profile.frameCrop.x,
    sy: row * profile.sourceCell.height + profile.frameCrop.y,
    sw: profile.frameCrop.width,
    sh: profile.frameCrop.height,
  };
}

export function walkFrameDestination(footX, footY, profile = animationProfileFor(), displayHeight = profile.displayHeight) {
  const scale = displayHeight / profile.frameCrop.height;
  return {
    x: footX - profile.footAnchor.x * scale,
    y: footY - profile.footAnchor.y * scale,
    width: profile.frameCrop.width * scale,
    height: displayHeight,
    scale,
  };
}
```

- [ ] **Step 4: Run the animation test**

Run: `node test/crew_animation.test.mjs`  
Expected: `crew_animation.test.mjs OK`.

- [ ] **Step 5: Commit the animation contract**

```sh
git add src/ui/crewAnimation.js test/crew_animation.test.mjs package.json
git commit -m "feat: add anchored crew animation profiles"
```

### Task 4: Render cropped Ninefold frames without bobbing

**Files:**
- Modify: `src/ui/crewArt.js`
- Modify: `src/ui/crewWalk.js`
- Modify: `src/ui/style.css`
- Modify: `test/crew_animation.test.mjs`

**Interfaces:**
- Consumes: animation profile and frame helpers from Task 3.
- Produces: `walkAssetFor(templateId, role, bodyFamily)` returning `{ image, profile }` and a canvas renderer whose path coordinate is the foot position.

- [ ] **Step 1: Extend the test with a source scan that forbids synthetic bobbing**

```js
import fs from 'node:fs';

const walkSource = fs.readFileSync(new URL('../src/ui/crewWalk.js', import.meta.url), 'utf8');
for (const forbidden of ['Math.sin(clock * 16', 'Math.sin(clock * 8', '+ bob']) {
  if (walkSource.includes(forbidden)) throw new Error(`synthetic bob remains: ${forbidden}`);
}
```

- [ ] **Step 2: Run the test and verify it detects the current bob**

Run: `node test/crew_animation.test.mjs`  
Expected: FAIL with `synthetic bob remains`.

- [ ] **Step 3: Replace full-cell drawing with profile drawing**

In `crewArt.js`, add:

```js
import { animationProfileFor } from './crewAnimation.js';

export function walkAssetFor(templateId, role, bodyFamily = 'standard_humanoid') {
  return {
    image: walkSheetFor(templateId, role),
    profile: animationProfileFor(bodyFamily),
  };
}
```

In `crewWalk.js`:

- store `bodyFamily: crew.bodyFamily || 'standard_humanoid'` on every actor;
- derive source and destination rectangles using the Task 3 helpers;
- use the actor's canvas path coordinate as the foot position;
- draw the shadow from `profile.shadow` at the path coordinate;
- remove `SPRITE`, the local `DIR_ROW`, and the `bob` expression;
- stop advancing walk frames while idle or doing unless that state has a compatible authored sheet.

The draw call becomes:

```js
const asset = walkAssetFor(a.templateId, a.role, a.bodyFamily);
const source = walkFrameSource(a.dir, a.state === 'walk' ? a.frame : 0, asset.profile);
const dest = walkFrameDestination(x, y, asset.profile);
g.drawImage(asset.image, source.sx, source.sy, source.sw, source.sh, dest.x, dest.y, dest.width, dest.height);
```

- [ ] **Step 4: Run focused tests and build**

Run: `node test/crew_animation.test.mjs`  
Expected: PASS.

Run: `node test/ship_pathing.test.mjs`  
Expected: PASS.

Run: `npm run build`  
Expected: Vite production build exits 0.

- [ ] **Step 5: Commit the renderer slice**

```sh
git add src/ui/crewArt.js src/ui/crewWalk.js src/ui/style.css test/crew_animation.test.mjs
git commit -m "fix: render grounded four-direction crew"
```

### Task 5: Render exact room polygons and expanded room actions

**Files:**
- Create: `src/ui/shipView.js`
- Create: `test/ship_view.test.mjs`
- Modify: `src/ui/bridge.js`
- Modify: `src/ui/style.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SPARROW_LAYOUT.rooms` from Task 1.
- Produces: `polygonCss(points)`, `roomStyle(room)`, and `renderRoomHotspot({ room, selected, alert, level })`.

- [ ] **Step 1: Write the failing view-helper test**

```js
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { polygonCss, renderRoomHotspot } from '../src/ui/shipView.js';

const bridge = SPARROW_LAYOUT.rooms.find((room) => room.id === 'bridge');
const clip = polygonCss(bridge.hitPolygon);
if (!clip.startsWith('polygon(') || !clip.includes('%')) throw new Error(`clip ${clip}`);
const html = renderRoomHotspot({ room: bridge, selected: true, alert: 'good', level: null });
if (!html.includes('data-room="bridge"')) throw new Error('missing room id');
if (!html.includes('aria-label="Bridge')) throw new Error('missing accessible label');
if (!html.includes('selected')) throw new Error('missing selected state');
if (!html.includes('clip-path:')) throw new Error('missing polygon style');
console.log('ship_view.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node test/ship_view.test.mjs`  
Expected: FAIL with module-not-found for `shipView.js`.

- [ ] **Step 3: Implement view helpers and wire `bridge.js`**

`polygonCss()` must serialize every point as `${x}% ${y}%`. `roomStyle()` must return full-layer positioning plus `clip-path`, so polygons stay in source-image coordinates:

```js
export function roomStyle(room) {
  return `left:0;top:0;width:100%;height:100%;clip-path:${polygonCss(room.hitPolygon)}`;
}
```

Replace `renderHotspots()` with a map through `renderRoomHotspot()`. Update `roomPip()` and `roomActions()` for all nine IDs:

- Bridge: contracts.
- Operations: contracts and Sensors upgrade.
- Medbay: crew and Medbay upgrade.
- Quarters: crew and Quarters upgrade.
- Workshop: Weapons upgrade.
- Cargo Hold: expeditions and Cargo upgrade.
- Mess: crew.
- Stores: fuel purchase.
- Engineering: claim fuel, repair hull, and Engines upgrade.

The player should never lose access to an existing Sparrow system because the room model became more precise.

- [ ] **Step 4: Make labels selected/contextual and targets measurable**

In CSS, render each hotspot as a full-layer clipped button. Hide `.room-tag` by default; show it for `.selected`, `.has-alert`, and keyboard focus. Set the label to at least 16px and a minimum 44px visual/touch box through its positioned label container. Retain a visible focus outline.

- [ ] **Step 5: Run the view, layout, and build checks**

Run: `node test/ship_view.test.mjs`  
Expected: PASS.

Run: `node test/ship_layout.test.mjs`  
Expected: PASS.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit the interaction slice**

```sh
git add src/ui/shipView.js src/ui/bridge.js src/ui/style.css test/ship_view.test.mjs package.json
git commit -m "feat: align Sparrow interactions to rooms"
```

### Task 6: Add a development geometry overlay

**Files:**
- Create: `src/ui/shipDebug.js`
- Create: `test/ship_debug.test.mjs`
- Modify: `src/ui/bridge.js`
- Modify: `src/ui/style.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: the complete `SPARROW_LAYOUT` manifest.
- Produces: `shipDebugEnabled({ dev, search })` and `renderShipDebug(layout)`.

- [ ] **Step 1: Write the failing debug test**

```js
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import { renderShipDebug, shipDebugEnabled } from '../src/ui/shipDebug.js';

if (!shipDebugEnabled({ dev: true, search: '?shipDebug=1' })) throw new Error('debug flag off');
if (shipDebugEnabled({ dev: false, search: '?shipDebug=1' })) throw new Error('debug leaked to production');
const html = renderShipDebug(SPARROW_LAYOUT);
for (const room of SPARROW_LAYOUT.rooms) {
  if (!html.includes(`data-debug-room="${room.id}"`)) throw new Error(`missing ${room.id}`);
}
for (const door of SPARROW_LAYOUT.doors) {
  if (!html.includes(`data-debug-door="${door.id}"`)) throw new Error(`missing ${door.id}`);
}
console.log('ship_debug.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node test/ship_debug.test.mjs`  
Expected: FAIL with module-not-found for `shipDebug.js`.

- [ ] **Step 3: Implement a development-only SVG overlay**

`shipDebugEnabled()` returns `dev && new URLSearchParams(search).get('shipDebug') === '1'`. `renderShipDebug()` returns an SVG with:

- polygon outlines and IDs for rooms;
- rectangles for halls and walk bounds;
- circles for room and spine door coordinates;
- markers for work anchors, blockers, and thrusters.

Mount it inside `.ship-fit` only when `import.meta.env.DEV` and the query flag are both true. Give the SVG `pointer-events: none` so it cannot change hit testing.

- [ ] **Step 4: Run focused checks**

Run: `node test/ship_debug.test.mjs`  
Expected: PASS.

Run: `npm run build`  
Expected: PASS and no production-only code path enables the overlay.

- [ ] **Step 5: Commit the debug tooling**

```sh
git add src/ui/shipDebug.js src/ui/bridge.js src/ui/style.css test/ship_debug.test.mjs package.json
git commit -m "dev: add Sparrow geometry overlay"
```

### Task 7: Complete phone sizing and reduced-motion behavior

**Files:**
- Modify: `src/ui/style.css`
- Modify: `src/ui/crewWalk.js`
- Create: `test/mobile_ship_contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: rendered ship, hotspots, and animation profiles from Tasks 3–6.
- Produces: 44px interactive HUD and room-sheet controls, a stable 390 by 844 ship layout, and a nonessential-effects switch for reduced motion.

- [ ] **Step 1: Write the failing source contract test**

```js
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
const walk = fs.readFileSync(new URL('../src/ui/crewWalk.js', import.meta.url), 'utf8');
if (!/\.hud-chip[\s\S]*?min-height:\s*44px/.test(css)) throw new Error('HUD target below 44px');
if (!/prefers-reduced-motion:[\s]*reduce/.test(css)) throw new Error('reduced motion query missing');
if (!walk.includes('matchMedia')) throw new Error('canvas reduced-motion detection missing');
console.log('mobile_ship_contract.test.mjs OK');
```

- [ ] **Step 2: Run the test and verify the current 36px HUD fails**

Run: `node test/mobile_ship_contract.test.mjs`  
Expected: FAIL with `HUD target below 44px`.

- [ ] **Step 3: Implement mobile and reduced-motion constraints**

- Change `.hud-chip` minimum height from 36px to 44px.
- Keep `.ship-fit` within the remaining stage and prevent the selected room sheet from obscuring the selected compartment.
- Give every `.room-sheet button` and `.icon-close` at least a 44px hit box.
- Add a `matchMedia('(prefers-reduced-motion: reduce)')` listener in `crewWalk.js`.
- When reduced motion is active, do not spawn thruster particles and render the actor's current direction at frame zero; path position still updates so state remains accurate.
- Remove `.crew-sprite` from active CSS if no DOM sprite caller remains after the canvas migration.

- [ ] **Step 4: Run mobile contract and build checks**

Run: `node test/mobile_ship_contract.test.mjs`  
Expected: PASS.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit the mobile slice**

```sh
git add src/ui/style.css src/ui/crewWalk.js test/mobile_ship_contract.test.mjs package.json
git commit -m "fix: enforce mobile ship interaction sizing"
```

### Task 8: Verify the package and update evidence

**Files:**
- Modify: `docs/audits/2026-09-21-current-build-audit.md`
- Modify: `docs/design/21-ship-animation-foundation.md`
- Create: `docs/qa/2026-09-21-ship-animation-foundation.md`
- Create: `docs/qa/artifacts/ship-before-390x844.png`
- Create: `docs/qa/artifacts/ship-after-390x844.png`
- Create: `docs/qa/artifacts/ship-debug-390x844.png`
- Create: `docs/qa/artifacts/crew-four-directions-390x844.png`

**Interfaces:**
- Consumes: the implemented package and all focused tests.
- Produces: revision-stamped automated results and phone visual evidence; no deployment artifact.

- [ ] **Step 1: Run every focused test separately**

Run: `node test/ship_layout.test.mjs`  
Expected: PASS.

Run: `node test/ship_pathing.test.mjs`  
Expected: PASS.

Run: `node test/crew_animation.test.mjs`  
Expected: PASS.

Run: `node test/ship_view.test.mjs`  
Expected: PASS.

Run: `node test/ship_debug.test.mjs`  
Expected: PASS.

Run: `node test/mobile_ship_contract.test.mjs`  
Expected: PASS.

- [ ] **Step 2: Run broad regression checks**

Run: `node test/sanity.mjs`  
Expected: PASS with the current content totals.

Run: `npm run build`  
Expected: PASS.

Run: `npm test`  
Expected before owning packages reconcile them: the two already-audited historical failures may remain in `phase_c.test.mjs` and `tutorial_week.test.mjs`; no new failure is accepted. Record exact output rather than labeling the entire suite green.

- [ ] **Step 3: Capture the required 390 by 844 states**

Run the Vite development server, open the game at 390 by 844, and save:

- baseline from the pre-change source or existing audit capture as `ship-before-390x844.png`;
- normal ship home as `ship-after-390x844.png`;
- `?shipDebug=1` as `ship-debug-390x844.png`;
- a composite or timed capture proving up, down, left, and right movement as `crew-four-directions-390x844.png`.

Inspect every image, not only its existence. Confirm room overlays align to visible floor plates, selected labels are readable, crew are at least 44px tall, feet remain grounded, and no sheet blocks its selected room.

- [ ] **Step 4: Perform touch and animation checks**

At 390 by 844:

- tap all nine compartments near their center and near each shared boundary;
- confirm corridor and exterior hull taps select nothing;
- record measured bounding boxes for HUD actions and selected-room controls;
- observe at least three actors crossing between upper and lower rooms;
- enable reduced motion and confirm path state remains correct without thruster particles or frame cycling.

Record pass/fail and any corrected manifest coordinates in `docs/qa/2026-09-21-ship-animation-foundation.md`.

- [ ] **Step 5: Update audit and spec status truthfully**

Mark only proven findings as resolved. Keep body-family art, full real-device performance, and later ship hulls in Not Verified. Add the implementation revision and commands actually run to the QA report.

- [ ] **Step 6: Commit the verified evidence**

```sh
git add docs/audits/2026-09-21-current-build-audit.md docs/design/21-ship-animation-foundation.md docs/qa
git commit -m "docs: verify ship animation foundation"
```

## Self-review

- Spec coverage: room geometry, pathing, exact input, Ninefold crop/anchor/scale, no bobbing, body-family seam, debug tooling, mobile sizing, reduced motion, automated evidence, and visual evidence each map to a task.
- Deliberate exclusions: tutorial, daily loop, combat rules, expedition selection, economy, paid products, and new body-family art remain separate packages rather than hidden inside this plan.
- Placeholder scan: implementation values, all nine manifest records, all nine doors, blocker records, and interfaces are explicit; no undecided implementation slot remains in the tasks.
- Type consistency: all geometry uses normalized percentage points; source-frame math uses pixel rectangles; path coordinates remain percentage points; canvas destination values are CSS pixels.
