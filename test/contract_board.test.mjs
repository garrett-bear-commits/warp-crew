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

// The first post-tutorial job must actually expose the crew-run normal fight,
// regardless of the daily seed; later boards retain their normal variety.
const firstV4 = { ...player, tutorial: { script: 4, completed: true, phase: 'done' },
  stats: { ...player.stats, contractsCompleted: 1 } };
const patrol = generateContractBoard(firstV4, Date.UTC(2026, 8, 23, 12));
if (patrol.offers.length !== 3) throw new Error('first board must keep three offers');
if (patrol.offers[0].destinationId !== 'lane_a' || patrol.offers[0].routeContent.encounterId !== 'pirate_scout') {
  throw new Error('first post-tutorial reliable job must lead to crew-run pirate scout combat');
}
const later = generateContractBoard({ ...firstV4, stats: { ...firstV4.stats, contractsCompleted: 2 } }, Date.UTC(2026, 8, 23, 12));
if (later.offers[0].title === patrol.offers[0].title && later.offers[0].destinationId === patrol.offers[0].destinationId) {
  throw new Error('later boards must not be locked to the first patrol');
}
console.log('contract_board.test.mjs OK');
