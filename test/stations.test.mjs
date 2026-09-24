import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { assignStation, normalizeAssignments, previewStationAssignment, stationOutputs } from '../src/systems/stations.js';
import { crewTargetStates } from '../src/ui/crewWalk.js';
import { renderCrew, renderRoomSheet } from '../src/ui/bridge.js';
import { ROOMS } from '../src/data/starterShip.js';
import { createCrewInstance } from '../src/data/crewRoster.js';

const now = 2_000_000;
const player = createNewPlayer({ now, rng: () => 0.1 });
const rex = player.crew.find(c => c.templateId === 'merc_rex');
const bolt = player.crew.find(c => c.templateId === 'merc_bolt');

// Catches a new save that auto-assigns Bolt and makes the Shields choice meaningless.
assert.deepEqual(normalizeAssignments(player), { [rex.instanceId]: 'helm', [bolt.instanceId]: null });
assert.equal(stationOutputs(player, now).helm.total, 110);
assert.equal(stationOutputs(player, now).shields.total, 100);
assert.deepEqual(previewStationAssignment(player, bolt.instanceId, 'helm', now), {
  ok: true, before: 110, after: 100, delta: -10,
});
assert.deepEqual(previewStationAssignment(player, bolt.instanceId, 'shields', now), {
  ok: true, before: 100, after: 110, delta: 10,
});
assert.deepEqual(previewStationAssignment(player, bolt.instanceId, null, now), {
  ok: false, reason: 'unknown_station',
});

// Catches lost assignment persistence, missing role benefit, and direct mutation of input.
const assigned = assignStation(player, bolt.instanceId, 'shields', now);
assert.equal(assigned.ok, true);
assert.equal(assigned.player.stationAssignments[bolt.instanceId], 'shields');
assert.equal(player.stationAssignments[bolt.instanceId], null);
assert.deepEqual(stationOutputs(assigned.player, now).shields, {
  staffedBy: bolt.instanceId, baseline: 100, bonus: 10, total: 110, label: 'Shields',
});

// Catches an away or injured worker contributing while the saved order should remain.
for (const member of [
  { ...bolt, status: 'expedition' },
  { ...bolt, status: 'injured', injuredUntil: now + 1 },
]) {
  const unavailable = { ...assigned.player, crew: assigned.player.crew.map(c => c.instanceId === bolt.instanceId ? member : c) };
  assert.equal(stationOutputs(unavailable, now).shields.bonus, 0);
  assert.equal(unavailable.stationAssignments[bolt.instanceId], 'shields');
  assert.equal(assignStation(unavailable, bolt.instanceId, 'engineering', now).reason, 'unavailable_crew');
}
const stillInjured = { ...assigned.player, crew: assigned.player.crew.map(c => c.instanceId === bolt.instanceId
  ? { ...c, status: 'injured', injuredUntil: 0 } : c) };
assert.equal(stationOutputs(stillInjured, now).shields.bonus, 0, 'injured status requires recovery before output');

// Catches a station accepting invalid targets or staffing more than one crew member.
assert.equal(assignStation(player, bolt.instanceId, 'cargo', now).reason, 'unknown_station');
assert.equal(assignStation(player, bolt.instanceId, 'toString', now).reason, 'unknown_station');
assert.equal(assignStation(player, 'missing', 'helm', now).reason, 'unknown_crew');
const replaced = assignStation(player, bolt.instanceId, 'helm', now).player;
assert.equal(replaced.stationAssignments[rex.instanceId], null);
assert.equal(replaced.stationAssignments[bolt.instanceId], 'helm');
assert.equal(stationOutputs(replaced, now).helm.bonus, 0, 'engineer has no Helm bonus');
const engineerDuty = assignStation(player, bolt.instanceId, 'engineering', now).player;
assert.equal(stationOutputs(engineerDuty, now).engineering.total, 110);
const jen = createCrewInstance('merc_jen', { instanceId: 'jen_station_test' });
const gunnerDuty = assignStation({ ...player, crew: [...player.crew, jen] }, jen.instanceId, 'weapons', now).player;
assert.equal(stationOutputs(gunnerDuty, now).weapons.total, 110);

// Catches migration assigning old crew without player action or changing combat selection.
const legacy = { ...player };
delete legacy.stationAssignments;
const migrated = migratePlayer(legacy);
assert.deepEqual(normalizeAssignments(migrated), { [rex.instanceId]: null, [bolt.instanceId]: null });
assert.deepEqual(migrated.crew.map(c => c.instanceId), player.crew.map(c => c.instanceId));

// Catches a visible station that disagrees with the authoritative selector or room mapping.
const shieldsRoom = ROOMS.find(room => room.id === 'operations');
const sheet = renderRoomSheet(assigned.player, shieldsRoom, {}, now);
assert.match(sheet, /Bolt/);
assert.match(sheet, /Shields output: 100 \+ 10 = 110/);
assert.match(sheet, new RegExp(`data-act="station-assign" data-id="${bolt.instanceId}" data-station="shields"`));
// Catches a choice that advertises role bonus instead of the actual result when it displaces a worker.
const helmRoom = ROOMS.find(room => room.id === 'bridge');
const helmSheet = renderRoomSheet(player, helmRoom, {}, now);
assert.match(helmSheet, new RegExp(`data-id="${bolt.instanceId}" data-station="helm"[^>]*>Bolt · 100 [(][-]10[)]</button>`));
assert.match(renderRoomSheet(player, shieldsRoom, {}, now), new RegExp(`data-id="${bolt.instanceId}" data-station="shields"[^>]*>Bolt · 110 [(][+]10[)]</button>`));
const crewPanel = renderCrew(player, now);
assert.match(crewPanel, new RegExp(`data-id="${bolt.instanceId}" data-station="helm"[^>]*>Helm 100 [(][-]10[)]</button>`));
assert.match(crewPanel, new RegExp(`data-id="${bolt.instanceId}" data-station="shields"[^>]*>Shields 110 [(][+]10[)]</button>`));
const targets = crewTargetStates(assigned.player);
assert.equal(targets.find(target => target.crewInstanceId === bolt.instanceId)?.roomId, 'operations');
assert.equal(targets.find(target => target.crewInstanceId === rex.instanceId)?.roomId, 'bridge');
const medic = createCrewInstance('merc_moss', { instanceId: 'medic_station_test' });
const medbay = ROOMS.find(room => room.id === 'medbay');
assert.match(renderRoomSheet({ ...player, crew: [...player.crew, medic] }, medbay, {}, now), new RegExp(medic.name));

console.log('stations.test.mjs OK');
