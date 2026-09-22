import assert from 'node:assert/strict';
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';
import {
  contractShipSignals,
  renderRoomHotspot,
  renderShipFeedback,
} from '../src/ui/shipView.js';
import { renderHotspots, renderPlatformLoginEntry } from '../src/ui/bridge.js';
import { crewTargetStates, moveCrewToDeparture } from '../src/ui/crewWalk.js';

// Catches losing the ship-space indication for an active/returned route or
// failing to render the durable first Sparrow repair after the route clears.
const base = { activeContract: null, flags: {}, crew: [] };
assert.deepEqual(contractShipSignals(base), {
  operationsActive: false,
  cargoReady: false,
  firstRepairLit: false,
});
assert.deepEqual(contractShipSignals({
  ...base,
  activeContract: { stage: 'choice' },
}), {
  operationsActive: true,
  cargoReady: false,
  firstRepairLit: false,
});
assert.deepEqual(contractShipSignals({
  ...base,
  activeContract: { stage: 'return' },
  flags: { sparrowFirstRepair: true },
}), {
  operationsActive: false,
  cargoReady: true,
  firstRepairLit: true,
});
assert.equal(contractShipSignals({
  ...base,
  flags: { sparrowFirstRepair: true },
}).firstRepairLit, true);

const operations = SPARROW_LAYOUT.rooms.find((room) => room.id === 'operations');
const operationsHtml = renderRoomHotspot({ room: operations, signal: 'route' });
assert.match(operationsHtml, /contract-route/);
assert.match(operationsHtml, /aria-label="Operations, route active"/);
assert.match(operationsHtml, />ROUTE</);

const cargo = SPARROW_LAYOUT.rooms.find((room) => room.id === 'cargo');
const cargoHtml = renderRoomHotspot({ room: cargo, signal: 'return' });
assert.match(cargoHtml, /contract-return/);
assert.match(cargoHtml, /aria-label="Cargo Hold, reward ready"/);
assert.match(cargoHtml, />REWARD</);

const repairHtml = renderShipFeedback({
  operationsActive: false,
  cargoReady: false,
  firstRepairLit: true,
});
assert.match(repairHtml, /sparrow-first-repair is-lit/);
assert.match(repairHtml, /Sparrow repair online/);
assert.match(repairHtml, /repair-prop/);

const shipPlayer = {
  ship: { systems: { sensors: 1, cargo: 1 } },
  activeContract: { stage: 'choice' },
  activeExpedition: null,
  flags: {},
};
const routeHotspots = renderHotspots(shipPlayer, { pendingWhole: false }, false, null);
assert.match(routeHotspots, /contract-route/);
assert.doesNotMatch(routeHotspots, /contract-return/);
const returnHotspots = renderHotspots({
  ...shipPlayer,
  activeContract: { stage: 'return' },
}, { pendingWhole: false }, false, null);
assert.match(returnHotspots, /contract-return/);
assert.doesNotMatch(returnHotspots, /contract-route/);

const crew = [
  { instanceId: 'crew-pilot', role: 'pilot', status: 'ready' },
  { instanceId: 'crew-engineer', role: 'engineer', status: 'ready' },
  { instanceId: 'crew-gunner', role: 'gunner', status: 'ready' },
];
const routeTargets = crewTargetStates({
  crew,
  activeContract: { stage: 'choice' },
});
assert.deepEqual(routeTargets, [
  {
    crewInstanceId: 'crew-pilot',
    mode: 'contract-station',
    roomId: 'bridge',
    anchors: [{ x: 56, y: 20 }],
    immediate: false,
  },
  {
    crewInstanceId: 'crew-engineer',
    mode: 'contract-station',
    roomId: 'engineering',
    anchors: [{ x: 56, y: 84 }],
    immediate: false,
  },
]);

const departureTargets = crewTargetStates({ crew, activeContract: null }, {
  departingCrewInstanceIds: ['crew-gunner', 'crew-pilot'],
  reducedMotion: true,
});
assert.deepEqual(departureTargets.map((target) => target.crewInstanceId), ['crew-gunner', 'crew-pilot']);
for (const target of departureTargets) {
  assert.equal(target.mode, 'expedition-departure');
  assert.equal(target.roomId, 'cargo');
  assert.deepEqual(target.anchors, [
    SPARROW_LAYOUT.anchors.cargoDeparture,
    SPARROW_LAYOUT.anchors.airlock,
  ]);
  assert.equal(target.immediate, true);
}
assert.equal(departureTargets.some((target) => target.crewInstanceId === 'crew-engineer'), false);

let reducedDepartureComplete = false;
const reducedPlan = moveCrewToDeparture({ crew, activeContract: null }, ['crew-gunner'], {
  reducedMotion: true,
  onDone: () => { reducedDepartureComplete = true; },
});
assert.equal(reducedDepartureComplete, true);
assert.deepEqual(reducedPlan, [departureTargets[0]]);

const loginEntry = renderPlatformLoginEntry();
assert.match(loginEntry, /data-act="prompt-login"/);
assert.match(loginEntry, /Optional Jest sign-in/);
assert.doesNotMatch(loginEntry, /register|save|sync|across devices?/i);

console.log('contract_ship_feedback.test.mjs OK');
