### Task 5: Persist one crew assignment and derive station outputs

**Files:** Create `src/systems/stations.js`; modify `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/ui/crewWalk.js`; create `test/stations.test.mjs`, `test/station_actions.test.mjs`.

**Interfaces:** `normalizeAssignments(player)` returns a map of crew instance ID to station ID or `null`. `assignStation(player, crewId, stationId, now)` returns `{ ok, player?, reason? }`; `stationOutputs(player, now)` returns `{ helm, shields, weapons, engineering }`, each with `{ staffedBy, baseline, bonus, total, label }`. `station-assign` UI action carries `data.id` and `data.station`; no UI writes the saved map directly. Away/injured crew keep their saved assignment but contribute only baseline.

- [ ] **Step 1: Write failing tests**:

```js
import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { assignStation, stationOutputs } from '../src/systems/stations.js';
const now = 2_000_000, p = createNewPlayer({ now, rng: () => .1 });
const bolt = p.crew.find(c => c.templateId === 'merc_bolt');
const assigned = assignStation(p, bolt.instanceId, 'shields', now);
assert.equal(assigned.ok, true);
assert.equal(assigned.player.stationAssignments[bolt.instanceId], 'shields');
assert.ok(stationOutputs(assigned.player, now).shields.bonus > 0);
const away = { ...assigned.player, crew: assigned.player.crew.map(c => c.instanceId === bolt.instanceId ? { ...c, status: 'expedition' } : c) };
assert.equal(stationOutputs(away, now).shields.bonus, 0);
assert.equal(away.stationAssignments[bolt.instanceId], 'shields');
assert.equal(assignStation(p, bolt.instanceId, 'cargo', now).reason, 'unknown_station');
```

- [ ] **Step 2: Run** `node test/stations.test.mjs`; expect missing module.
- [ ] **Step 3: Implement** four station IDs, one crew per station for this slice, role-specific visible bonuses (pilot at helm, engineer at shields/engineering, gunner at weapons), conservative unmanned baseline, and a single selector shared by HUD and combat. The availability check must be explicit:

```js
const member = player.crew.find(c => c.instanceId === crewId);
if (!member) return { ok: false, reason: 'unknown_crew' };
if (member.status === 'expedition' || (member.injuredUntil || 0) > now) return { ok: false, reason: 'unavailable_crew' };
if (!['helm', 'shields', 'weapons', 'engineering'].includes(stationId)) return { ok: false, reason: 'unknown_station' };
```

Add `stationAssignments` to new saves with Rex at helm and Bolt in reserve so the guided Shields assignment is a real player action; migrate absent maps without moving existing crew or changing old combat selection. Wire a brief crew→station chooser with `station-assign`, a clear work marker, and an output delta; one station remains selected at close camera scale.
- [ ] **Step 4: Add `station_actions.test.mjs`** with `sessionAction(p, {}, 'station-assign', { id: 'missing', station: 'helm' }).reason === 'unknown_crew'`, and assert a valid assignment survives JSON round-trip and `migratePlayer`.
- [ ] **Step 5: Run** `node test/stations.test.mjs`, `node test/station_actions.test.mjs`, `npm run test:loop`, `npm run test:ship`; expect PASS.
- [ ] **Step 6: Commit** `feat: persist crew station assignments` with task files only.

