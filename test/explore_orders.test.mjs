import assert from 'node:assert/strict';
import { createNewPlayer } from '../src/systems/player.js';
import { previewTravel, commitTravel } from '../src/systems/travel.js';
const player = createNewPlayer({ tutorialScript: 4 });
player.tutorial.completed = true;
player.tutorial.phase = 'done';
const preview = previewTravel(player, 'lane_a', { rng: () => 0.5 });
// Catches ignored order IDs, missing extra cost, and ignored protection/injury metadata.
const burn = commitTravel(player, preview, { orderId: 'burn', rng: () => 0 });
assert.equal(burn.result.combat.orderId, 'burn');
assert.equal(burn.player.wallet.fuel, player.wallet.fuel - preview.fuelCost - 1);
const brace = commitTravel(player, preview, { orderId: 'brace', rng: () => 0.999 });
const board = commitTravel(player, preview, { orderId: 'board', rng: () => 0.999 });
assert.equal(brace.player.crew.some(c => c.status === 'injured'), false);
assert.equal(board.player.crew.some(c => c.status === 'injured'), true);
assert.equal(player.ship.hull - brace.player.ship.hull, Math.floor((player.ship.hull - board.player.ship.hull) / 2));
assert.equal(commitTravel({ ...player, wallet: { ...player.wallet, fuel: preview.fuelCost } }, preview, { orderId: 'burn' }).ok, false);
assert.equal(commitTravel(player, preview, { orderId: 'bogus' }).ok, false);
console.log('explore_orders.test.mjs OK');
