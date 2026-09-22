import { createNewPlayer } from '../src/systems/player.js';
import { contractDayKey, generateContractBoard, ensureContractBoard, reviewContractOffer } from '../src/systems/contracts.js';

// Catches nondeterministic selection, missing profile coverage, incomplete card data,
// and replacing a saved same-day board.
// Catches using UTC midnight instead of the player's local calendar day.
const localLateNight = new Date(2026, 8, 21, 23, 30);
if (contractDayKey(localLateNight) !== '2026-09-21') throw new Error('contract day must use local date');
const now = Date.UTC(2026, 8, 21, 12);
const player = { ...createNewPlayer(), createdAt: now - 86400000, tutorial: { script: 3, completed: true, phase: 'done' } };
const a = generateContractBoard(player, now);
const b = generateContractBoard(player, now);
if (a.offers.map((x) => x.profile).join(',') !== 'reliable,risky,strange') throw new Error('profiles');
if (new Set(a.offers.map((x) => x.id)).size !== 3) throw new Error('offer ids');
if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('board not deterministic');
for (const offer of a.offers) {
  if (!offer.destinationId || !offer.title || !offer.brief || offer.normalFuel < 2) throw new Error('incomplete offer');
  if (!['Low', 'Guarded', 'High'].includes(offer.danger)) throw new Error('danger');
}
const stored = { ...player, contractBoard: a };
const ensured = ensureContractBoard(stored, now + 60000);
if (ensured.player.contractBoard !== a) throw new Error('stored board replaced');
const review = reviewContractOffer(stored, a.offers[0].id);
if (!review.ok || review.cost.fuel < 1 || !review.rewardBand.label || !review.favoredTrait.label) throw new Error('review');
console.log('contract_board.test.mjs OK');
