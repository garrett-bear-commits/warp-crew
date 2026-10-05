import assert from 'node:assert/strict';
import { dockRepair, DOCK_REPAIR } from '../src/systems/passives.js';

const now = Date.UTC(2030, 8, 22, 12);
const hour = 3_600_000;
const ship = (hull, hullRepairAt) => ({ ship: { hull, ...(hullRepairAt === undefined ? {} : { hullRepairAt }) } });

// A whole ship is left alone (no save churn on every render).
const whole = ship(100, now - 5 * hour);
assert.equal(dockRepair(whole, now), whole);
// A damaged ship from an older save starts its repair clock now, without retroactive repair.
const old = dockRepair(ship(40), now);
assert.equal(old.ship.hull, 40);
assert.equal(old.ship.hullRepairAt, now);
// 25 hull an hour; leftover time carries to the next point.
const repaired = dockRepair(ship(40, now - 2 * hour), now);
assert.equal(repaired.ship.hull, 40 + 2 * DOCK_REPAIR.hullPerHour);
const partial = dockRepair(ship(40, now - 30 * 60_000 - 1000), now);
assert.equal(partial.ship.hull, 52);
assert.ok(partial.ship.hullRepairAt <= now && partial.ship.hullRepairAt > now - 144_000, 'remainder is kept');
// Next day: full again, capped at 100.
assert.equal(dockRepair(ship(5, now - 24 * hour), now).ship.hull, 100);
// No repairs mid-fight.
const fighting = { ...ship(30, now - 10 * hour), activeEncounter: { result: null } };
assert.equal(dockRepair(fighting, now), fighting);
console.log('dock_repair.test.mjs OK');
