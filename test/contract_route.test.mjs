import { createNewPlayer } from '../src/systems/player.js';
import {
  ensureContractBoard,
  acceptContract,
  previewContractAction,
  commitContractAction,
  claimContractReward,
  abandonContract,
  normalizeContractState,
} from '../src/systems/contracts.js';

// Catches spending on accept, replaying a stale action, skipping a route stage,
// losing the saved result, or granting the same reward twice.
const now = Date.UTC(2026, 8, 21, 12);
let player = {
  ...createNewPlayer(),
  wallet: { ...createNewPlayer().wallet, fuel: 8 },
  tutorial: { script: 3, completed: true, phase: 'done' },
};
player = ensureContractBoard(player, now).player;
const offer = player.contractBoard.offers.find((candidate) => candidate.profile === 'risky');
let res = acceptContract(player, offer.id);
if (!res.ok || res.player.activeContract.stage !== 'briefing' || res.player.wallet.fuel !== 8) {
  throw new Error('accept');
}
player = res.player;

const launch = previewContractAction(player, { id: 'launch' });
res = commitContractAction(player, launch, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'choice' || res.player.wallet.fuel !== 7) {
  throw new Error('launch');
}
const afterLaunch = res.player;
if (commitContractAction(afterLaunch, launch, { rng: () => 0 }).ok) throw new Error('stale launch replay');

const push = previewContractAction(afterLaunch, { id: 'push' });
res = commitContractAction(afterLaunch, push, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'confrontation' || res.player.wallet.fuel !== 6) {
  throw new Error('push');
}

const order = previewContractAction(res.player, { id: 'order', orderId: 'brace' });
res = commitContractAction(res.player, order, { rng: () => 0 });
if (!res.ok || res.player.activeContract.stage !== 'return' || !res.player.activeContract.result) {
  throw new Error('resolve');
}
const beforeClaim = res.player.wallet.credits;
const claimed = claimContractReward(res.player);
if (!claimed.ok || claimed.player.wallet.credits <= beforeClaim || claimed.player.activeContract !== null) {
  throw new Error('claim');
}
if (claimContractReward(claimed.player).ok) throw new Error('double claim');

// Catches rerolling or losing a resolved route during JSON persistence.
const saved = JSON.parse(JSON.stringify(res.player));
if (saved.activeContract.stage !== 'return') throw new Error('reload stage');
if (JSON.stringify(saved.activeContract.result) !== JSON.stringify(res.player.activeContract.result)) {
  throw new Error('reload result');
}
if (saved.activeContract.encounterId !== res.player.activeContract.encounterId) throw new Error('reload encounter');

// Catches fuel checks occurring after mutation and active routes rerolling at midnight.
const poor = { ...afterLaunch, wallet: { ...afterLaunch.wallet, fuel: 0 } };
const poorPreview = previewContractAction(poor, { id: 'push' });
if (poorPreview.ok || poorPreview.reason !== 'not_enough_fuel') throw new Error('fuel gate');
const poorBefore = JSON.stringify(poor);
if (commitContractAction(poor, push, { rng: () => 0 }).ok || JSON.stringify(poor) !== poorBefore) {
  throw new Error('fuel commit mutation');
}
const midnight = ensureContractBoard(afterLaunch, now + 86400000 * 2).player;
if (midnight.contractBoard.dayKey !== afterLaunch.contractBoard.dayKey) throw new Error('active midnight reroll');

// Catches accepting missing, completed, or competing offers.
if (acceptContract(player, 'missing').reason !== 'contract_already_active') throw new Error('competing offer gate');
if (acceptContract({ ...player, activeContract: null }, 'missing').reason !== 'unknown_offer') throw new Error('unknown offer gate');
const completedPlayer = {
  ...player,
  activeContract: null,
  contractBoard: { ...player.contractBoard, completedOfferIds: [offer.id] },
};
if (acceptContract(completedPlayer, offer.id).reason !== 'offer_completed') throw new Error('completed offer gate');

// Catches preview mutation and commits forged for the wrong route stage.
const beforePreview = JSON.stringify(afterLaunch);
if (!previewContractAction(afterLaunch, { id: 'push' }).ok || JSON.stringify(afterLaunch) !== beforePreview) {
  throw new Error('preview mutation');
}
const wrongStage = { ...push, action: { id: 'launch' } };
if (commitContractAction(afterLaunch, wrongStage, { rng: () => 0 }).reason !== 'wrong_contract_stage') {
  throw new Error('wrong stage commit');
}

function confrontationPlayer() {
  let routePlayer = {
    ...createNewPlayer(),
    wallet: { ...createNewPlayer().wallet, fuel: 8 },
    tutorial: { script: 3, completed: true, phase: 'done' },
  };
  routePlayer = ensureContractBoard(routePlayer, now).player;
  const risky = routePlayer.contractBoard.offers.find((candidate) => candidate.profile === 'risky');
  routePlayer = acceptContract(routePlayer, risky.id).player;
  routePlayer = commitContractAction(
    routePlayer,
    previewContractAction(routePlayer, { id: 'launch' }),
    { rng: () => 0 },
  ).player;
  routePlayer = commitContractAction(
    routePlayer,
    previewContractAction(routePlayer, { id: 'push' }),
    { rng: () => 0 },
  ).player;
  return routePlayer;
}

// Catches dropping Brace's injury prevention / half hull loss and Board's
// forced failure injury when a combat result is stored.
const confrontation = confrontationPlayer();
const braceFail = commitContractAction(
  confrontation,
  previewContractAction(confrontation, { id: 'order', orderId: 'brace' }),
  { rng: () => 1 },
);
if (!braceFail.ok || braceFail.player.activeContract.result.success) throw new Error('brace failure setup');
if (braceFail.player.activeContract.result.injuredCrewId !== null) throw new Error('brace injury prevention');
const boardFail = commitContractAction(
  confrontation,
  previewContractAction(confrontation, { id: 'order', orderId: 'board' }),
  { rng: () => 1 },
);
if (!boardFail.player.activeContract.result.injuredCrewId) throw new Error('board forced injury');
if (!(braceFail.player.activeContract.result.hullLoss < boardFail.player.activeContract.result.hullLoss)) {
  throw new Error('brace hull scaling');
}

// Catches charging Burn without using its paid order or charging the fuel twice.
const burnPlayer = { ...confrontation, wallet: { ...confrontation.wallet, fuel: 1 } };
const burnPreview = previewContractAction(burnPlayer, { id: 'order', orderId: 'burn' });
const burned = commitContractAction(burnPlayer, burnPreview, { rng: () => 0 });
if (!burned.ok || !burned.player.activeContract.result.success || burned.player.wallet.fuel !== 0) {
  throw new Error('burn commit');
}

// Catches granting anything beyond credits/medals for Board's victory bonus.
const braceWin = commitContractAction(
  confrontation,
  previewContractAction(confrontation, { id: 'order', orderId: 'brace' }),
  { rng: () => 0 },
).player.activeContract.result.rewards;
const boardWin = commitContractAction(
  confrontation,
  previewContractAction(confrontation, { id: 'order', orderId: 'board' }),
  { rng: () => 0 },
).player.activeContract.result.rewards;
if (boardWin.credits !== Math.floor(braceWin.credits * 1.25)) throw new Error('board credits');
if (boardWin.medals !== Math.floor(braceWin.medals * 1.25)) throw new Error('board medals');
if (boardWin.reputation !== braceWin.reputation || boardWin.gems !== braceWin.gems || boardWin.fuel !== braceWin.fuel) {
  throw new Error('board reward boundary');
}

// Catches invalid persisted routes poisoning unrelated player state.
const invalid = normalizeContractState({
  ...afterLaunch,
  wallet: { ...afterLaunch.wallet, credits: 321 },
  activeContract: { ...afterLaunch.activeContract, stage: 'teleporting' },
});
if (invalid.activeContract !== null || invalid.wallet.credits !== 321 || invalid.recoveryEvents.at(-1)?.reason !== 'invalid_contract_state') {
  throw new Error('invalid save recovery');
}
const partial = normalizeContractState({
  ...afterLaunch,
  activeContract: { ...afterLaunch.activeContract, routeOutcome: undefined },
});
if (partial.activeContract !== null) throw new Error('partial save recovery');
const normalizedReload = normalizeContractState(saved);
if (normalizedReload.activeContract.stage !== 'return' || normalizedReload.activeContract.revision !== 3) {
  throw new Error('valid save normalization');
}

// Catches abandonment refunds/rewards, stale abandonment, or a missing event payload.
const briefing = acceptContract(
  { ...completedPlayer, contractBoard: { ...completedPlayer.contractBoard, completedOfferIds: [] } },
  offer.id,
).player;
if (abandonContract(briefing, 99).reason !== 'stale_contract_action') throw new Error('stale abandon');
const abandonedBriefing = abandonContract(briefing, 0);
if (!abandonedBriefing.ok || abandonedBriefing.player.activeContract !== null || abandonedBriefing.player.wallet.fuel !== 8) {
  throw new Error('briefing abandon');
}
const abandonedRoute = abandonContract(afterLaunch, afterLaunch.activeContract.revision);
if (!abandonedRoute.ok || abandonedRoute.player.wallet.fuel !== 7 || abandonedRoute.analytics.event !== 'contract_abandoned') {
  throw new Error('route abandon');
}

// Catches a Strange route ignoring its accepted, persisted content selection.
let strangePlayer = {
  ...createNewPlayer(),
  wallet: { ...createNewPlayer().wallet, fuel: 8 },
  tutorial: { script: 3, completed: true, phase: 'done' },
};
strangePlayer = ensureContractBoard(strangePlayer, now).player;
const strangeOffer = strangePlayer.contractBoard.offers.find((candidate) => candidate.profile === 'strange');
strangePlayer = acceptContract(strangePlayer, strangeOffer.id).player;
const strangeKind = strangePlayer.activeContract.routeOutcome.kind;
strangePlayer = commitContractAction(
  strangePlayer,
  previewContractAction(strangePlayer, { id: 'launch' }),
  { rng: () => 0 },
).player;
strangePlayer = commitContractAction(
  strangePlayer,
  previewContractAction(strangePlayer, { id: 'push' }),
  { rng: () => 0 },
).player;
const expectedStrangeStage = strangeKind === 'combat' ? 'confrontation' : 'return';
if (strangePlayer.activeContract.stage !== expectedStrangeStage) throw new Error('strange snapshot route');

// Catches claim omitting durable completion, visit, and daily progress records.
if (claimed.player.stats.contractsCompleted !== 1) throw new Error('completion stat');
if (claimed.player.stats.contractsByProfile.risky !== 1) throw new Error('profile stat');
if (claimed.player.stats.visits[offer.destinationId] !== 1) throw new Error('visit stat');
if (!claimed.player.dailyLoop.contract || !claimed.player.contractBoard.completedOfferIds.includes(offer.id)) {
  throw new Error('claim progress');
}

console.log('contract_route.test.mjs OK');
