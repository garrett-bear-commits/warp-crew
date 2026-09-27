import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { sessionAction, sessionModels } from '../src/systems/sessionLoop.js';
import { stationOutputs } from '../src/systems/stations.js';
import { ENCOUNTERS_V1 } from '../src/systems/combat.js';

const now = 2_000_000;
const player = createNewPlayer({ now, rng: () => 0.1 });
const bolt = player.crew.find(c => c.templateId === 'merc_bolt');

// Catches an action that silently accepts an unknown crew ID or bypasses validation.
assert.equal(sessionAction(player, {}, 'station-assign', { id: 'missing', station: 'helm' }, { now }).reason, 'unknown_crew');
assert.equal(sessionAction(player, {}, 'station-assign', { id: bolt.instanceId, station: 'cargo' }, { now }).reason, 'unknown_station');

// Catches a valid action that only changes UI state or fails a save and migration round trip.
const result = sessionAction(player, {}, 'station-assign', { id: bolt.instanceId, station: 'shields' }, { now });
assert.equal(result.ok, true);
assert.equal(player.stationAssignments[bolt.instanceId], null);
const restored = migratePlayer(JSON.parse(JSON.stringify(result.player)));
assert.equal(restored.stationAssignments[bolt.instanceId], 'shields');
assert.equal(stationOutputs(restored, now).shields.total, 110);
const combat = sessionModels(restored, { pendingCombat: {
  encounter: ENCOUNTERS_V1[0], playerPower: 10, fuelCost: 0, tutorialFight: false,
} }, now).combatOrders;
assert.equal(combat.stationOutputs.shields.total, 110, 'combat model receives the same pure station selector');

// Catches the crew-panel Leave station button failing to clear saved duty.
const cleared = sessionAction(restored, {}, 'station-assign', { id: bolt.instanceId, station: '' }, { now });
assert.equal(cleared.ok, true);
assert.equal(cleared.player.stationAssignments[bolt.instanceId], null);
assert.equal(stationOutputs(cleared.player, now).shields.total, 100);

console.log('station_actions.test.mjs OK');
