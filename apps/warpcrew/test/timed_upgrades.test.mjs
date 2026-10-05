import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { upgradeSystem, completeShipBuild, skipShipBuild, buildMinutesFor, buildSkipGems, UPGRADE_BUILD } from '../src/systems/hangar.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { renderRoomSheet } from '../src/ui/bridge.js';
import { ROOMS } from '../src/data/starterShip.js';

const now = Date.UTC(2030, 8, 22, 12);
const base = createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 });
const rich = { ...base, tutorial: { ...base.tutorial, completed: true, phase: 'done' },
  wallet: { ...base.wallet, credits: 100000, gems: 100 }, ship: { ...base.ship, systems: { ...base.ship.systems, weapons: 2 } } };

// Levels up to 3 are instant.
assert.equal(buildMinutesFor(3), 0);
let step = upgradeSystem(rich, 'weapons', now);
assert.equal(step.ok, true);
assert.equal(step.player.ship.systems.weapons, 3);
assert.equal(step.player.shipBuild, undefined);

// Level 4 builds for 30 minutes; credits are paid up front and the level waits.
const credits = step.player.wallet.credits;
step = upgradeSystem(step.player, 'weapons', now);
assert.equal(step.ok, true);
assert.equal(step.player.ship.systems.weapons, 3, 'the level is not granted early');
assert.equal(step.player.shipBuild.targetLevel, 4);
assert.equal(step.player.shipBuild.endAt - now, UPGRADE_BUILD.minutes[4] * 60000);
assert.ok(step.player.wallet.credits < credits);
assert.equal(upgradeSystem(step.player, 'shields', now).reason, 'drydock_busy', 'one drydock');
assert.deepEqual(migratePlayer(JSON.parse(JSON.stringify(step.player))).shipBuild, step.player.shipBuild, 'builds survive reload');

// It completes on its own once the timer runs out.
assert.equal(completeShipBuild(step.player, now + 29 * 60000).completed, null);
const done = prepareSession(step.player, now + 30 * 60000);
assert.equal(done.ship.systems.weapons, 4);
assert.equal(done.shipBuild, null);

// Skipping costs ~10 gems per remaining hour (min 5) and finishes now.
assert.equal(buildSkipGems(30 * 60000), 5);
assert.equal(buildSkipGems(4 * 3600000), 40);
const skipped = skipShipBuild(step.player, now + 60000);
assert.equal(skipped.ok, true);
assert.equal(skipped.player.ship.systems.weapons, 4);
assert.equal(skipped.player.wallet.gems, rich.wallet.gems - skipped.gems);
assert.equal(skipShipBuild({ ...step.player, wallet: { ...step.player.wallet, gems: 0 } }, now).reason, 'not_enough_gems');
const viaSession = sessionAction(step.player, {}, 'ship-build-skip', {}, { now: now + 60000 });
assert.equal(viaSession.ok, true);
assert.equal(viaSession.player.ship.systems.weapons, 4);

// Build lengths climb to an 8-hour cap.
assert.deepEqual([4, 5, 6, 7, 8, 12].map(buildMinutesFor), [30, 60, 120, 240, 480, 480]);

// The room sheet shows the build with its skip, and blocks other upgrades.
const sheet = renderRoomSheet(step.player, ROOMS.find(room => room.id === 'weapons'), { current: 5 }, now);
assert.match(sheet, /Building Weapons Lv 4 · .* left<\/span><b>Skip \d+g/);
const engine = renderRoomSheet(step.player, ROOMS.find(room => room.id === 'engineering'), { current: 5 }, now);
assert.match(engine, /data-act="ship-upgrade" data-system="engines" disabled>.*drydock busy/);

console.log('timed_upgrades.test.mjs OK');
