// @ts-nocheck
/** Deterministic, saved daily Contract Board. Route mutations belong elsewhere. */

import { visibleNodes, NODES } from '../data/sectors.js';
import { CONTRACT_PROFILES, combatWeight, qualifiesForProfile, storySalvageWeight } from '../data/contracts.js';
import { encounterById, previewCombatOrder, resolveCombatOrder, crewPower, rubberBandPower } from './combat.js';
import { grant, scaleSitePayout } from './economy.js';
import { spendFuel } from './fuel.js';
import { fuelCostFor, combatBonuses, hullAfterCombat, injuryMinutesFor, tradePayout } from './passives.js';
import { applyStoryFlag } from './story.js';

export { CONTRACT_PROFILES } from '../data/contracts.js';

export function contractDayKey(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function careerBand(player) {
  if (!player?.tutorial?.completed && !player?.tutorial?.dismissed) return 'intro';
  const flags = player?.flags || {};
  const story = player?.story || {};
  if (flags.crown_opened || story.crownUnlocked) return 'crown';
  if (flags.hollow_opened || story.hollowUnlocked) return 'hollow';
  if (flags.ember_opened || story.emberUnlocked) return 'ember';
  if (flags.veil_opened || story.veilUnlocked) return 'veil';
  return 'spur';
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function xorshift(seed) {
  let state = seed || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pick(items, rng) {
  return items[Math.floor(rng() * items.length)] || items[0];
}

function candidatesFor(profile, nodes) {
  const eligible = nodes.filter((node) => qualifiesForProfile(profile.id, node));
  if (eligible.length) return eligible;
  if (profile.id === 'reliable') return nodes.filter((node) => node.type !== 'danger');
  if (profile.id === 'risky') {
    const highest = Math.max(...nodes.map(combatWeight));
    return nodes.filter((node) => combatWeight(node) === highest);
  }
  if (profile.id === 'strange') {
    const highest = Math.max(...nodes.map(storySalvageWeight));
    return nodes.filter((node) => storySalvageWeight(node) === highest);
  }
  return [];
}

function fallbackFor(profile) {
  const fallbackIds = { reliable: 'lane_a', risky: 'danger_belt', strange: 'scrapyard' };
  return NODES[fallbackIds[profile.id]];
}

function dangerFor(profile, node) {
  if (profile.id === 'risky' || node?.type === 'danger' || combatWeight(node) >= 40) return 'High';
  if (profile.id === 'strange' || combatWeight(node) > 25) return 'Guarded';
  return 'Low';
}

function offerFor(profile, node, boardDay, rng) {
  const beats = pick(profile.routeLengths, rng);
  const normalFuel = 2;
  return {
    id: `offer_${boardDay}_${profile.id}`,
    profile: profile.id,
    icon: profile.icon,
    title: pick(profile.titles, rng),
    brief: pick(profile.briefs, rng),
    destinationId: node.id,
    destinationName: node.name,
    normalFuel,
    beats,
    beatLabel: `${beats} beats`,
    rewardFamily: profile.rewardFamily,
    danger: dangerFor(profile, node),
    favoredTrait: { ...profile.favoredTrait },
  };
}

export function generateContractBoard(player, now = Date.now()) {
  const boardDay = contractDayKey(now);
  const shipId = player?.ship?.shipId || 'sparrow';
  const rng = xorshift(hashSeed(`${boardDay}:${careerBand(player)}:${shipId}`));
  const nodes = visibleNodes(player, now);
  const offers = CONTRACT_PROFILES.map((profile) => {
    const candidates = candidatesFor(profile, nodes);
    return offerFor(profile, pick(candidates, rng) || fallbackFor(profile), boardDay, rng);
  });
  return { dayKey: boardDay, offers, completedOfferIds: [] };
}

export function ensureContractBoard(player, now = Date.now()) {
  const boardDay = contractDayKey(now);
  const saved = player?.contractBoard;
  if (saved && (saved.dayKey === boardDay || player?.activeContract)) {
    return { player, board: saved, refreshed: false };
  }
  const board = generateContractBoard(player, now);
  return { player: { ...player, contractBoard: board }, board, refreshed: true };
}

export function reviewContractOffer(player, offerId) {
  const offer = (player?.contractBoard?.offers || []).find((candidate) => candidate.id === offerId);
  if (!offer) return { ok: false, reason: 'unknown_offer' };
  const fuel = fuelCostFor(player, 1) * (offer.normalFuel || 2);
  return {
    ok: true,
    offer,
    cost: { fuel },
    rewardBand: { label: offer.rewardFamily, family: offer.rewardFamily },
    favoredTrait: { ...offer.favoredTrait },
    consequence: offer.danger === 'High' ? 'Possible hull or crew consequence.' : 'Lower expected danger on this route.',
  };
}

export function tutorialDistressOffer(player) {
  const profile = CONTRACT_PROFILES[2];
  const node = NODES.lane_a;
  return {
    ...offerFor(profile, node, 'tutorial', xorshift(hashSeed(`tutorial:${player?.ship?.shipId || 'sparrow'}`))),
    id: 'offer_tutorial_distress',
    profile: 'distress',
    icon: 'contract_distress',
    title: 'Distress at Dust Lane',
    brief: 'A freighter is calling for help beneath a pirate signal.',
    beats: 2,
    beatLabel: '2 beats',
    normalFuel: 2,
    danger: 'Guarded',
    rewardFamily: 'credits, medals, and reputation',
    favoredTrait: { kind: 'role', id: 'engineer', label: 'Engineer', why: 'An engineer keeps a rescue run together.' },
  };
}

const CONTRACT_STAGES = new Set(['briefing', 'choice', 'confrontation', 'return', 'claimed']);
const CONTRACT_PROFILES_IDS = new Set(['reliable', 'risky', 'strange', 'distress']);

function normalizeRewards(rewards = {}) {
  return {
    credits: Number(rewards.credits) || 0,
    medals: Number(rewards.medals) || 0,
    reputation: Number(rewards.reputation) || 0,
    gems: Number(rewards.gems) || 0,
    fuel: Number(rewards.fuel) || 0,
  };
}

function deterministicIndex(seed, length, salt = '') {
  if (!length) return 0;
  return hashSeed(`${seed}:${salt}`) % length;
}

function preferredOutcomes(offer, node) {
  const outcomes = node?.outcomes || [];
  let preferred = outcomes;
  if (offer.profile === 'reliable') {
    preferred = outcomes.filter((outcome) => outcome.kind === 'trade' || outcome.kind === 'delivery');
  } else if (offer.profile === 'risky') {
    preferred = outcomes.filter((outcome) => outcome.kind === 'combat');
  } else if (offer.profile === 'strange') {
    // Strange routes may snapshot story, salvage, or the occasional fight.
    // The saved selection, rather than a later roll, decides the third beat.
    preferred = outcomes;
  }
  return preferred.length ? preferred : outcomes;
}

function snapshotRouteContent(offer, routeSeed) {
  const node = NODES[offer.destinationId];
  const outcomes = preferredOutcomes(offer, node);
  const routeOutcome = outcomes[deterministicIndex(routeSeed, outcomes.length, 'outcome')] || { kind: 'arrive' };
  let secureOutcomes = (node?.outcomes || []).filter((outcome) => (
    offer.profile === 'strange'
      ? outcome.kind === 'story' || outcome.kind === 'salvage'
      : outcome.kind === 'trade' || outcome.kind === 'delivery' || outcome.kind === 'salvage'
  ));
  if (!secureOutcomes.length && offer.profile === 'strange') {
    secureOutcomes = (NODES.scrapyard?.outcomes || []).filter((outcome) => outcome.kind === 'salvage');
  }
  const secureOutcome = secureOutcomes[deterministicIndex(routeSeed, secureOutcomes.length, 'secure')]
    || routeOutcome;
  const combatOutcomes = (node?.outcomes || []).filter((outcome) => outcome.kind === 'combat');
  const encounterOutcome = routeOutcome.kind === 'combat'
    ? routeOutcome
    : offer.profile === 'strange'
      ? null
      : combatOutcomes[deterministicIndex(routeSeed, combatOutcomes.length, 'encounter')] || null;
  return {
    routeOutcome: { ...routeOutcome },
    secureOutcome: { ...secureOutcome },
    encounterId: encounterOutcome?.encounter || null,
    storyFlag: routeOutcome.kind === 'story' ? routeOutcome.flag || null : null,
  };
}

function readyContractCrew(player, now = Date.now()) {
  const ready = (player?.crew || []).filter((crew) => {
    if (crew.status === 'expedition') return false;
    return crew.status !== 'injured' || (crew.injuredUntil || 0) <= now;
  });
  const slots = Math.max(1, player?.crewSlots || 2);
  return [...ready].sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, slots);
}

function contractFuelCost(player) {
  return fuelCostFor(player, 1);
}

function analyticsEvent(event, fields) {
  return { event, ...fields };
}

function contractDecisionKey(player, contract, action) {
  const crew = readyContractCrew(player).map((member) => ({
    instanceId: member.instanceId,
    power: Number(member.power) || 0,
    status: member.status || 'ready',
    injuredUntil: Number(member.injuredUntil) || 0,
    passive: member.passive || null,
  }));
  const systems = player?.ship?.systems || {};
  const inputs = {
    acceptanceId: contract.acceptanceId,
    revision: contract.revision,
    stage: contract.stage,
    action,
    routeSeed: contract.routeSeed,
    encounterId: contract.encounterId,
    routeOutcome: contract.routeOutcome,
    secureOutcome: contract.secureOutcome,
    storyFlag: contract.storyFlag,
    storyAlreadySeen: Boolean(contract.storyFlag && player?.flags?.[contract.storyFlag]),
    wallet: {
      fuel: Number(player?.wallet?.fuel) || 0,
      reputation: Number(player?.wallet?.reputation) || 0,
    },
    ship: {
      shipId: player?.ship?.shipId || 'sparrow',
      hull: Number(player?.ship?.hull) || 0,
      systems: {
        engines: Number(systems.engines) || 0,
        shields: Number(systems.shields) || 0,
        cargo: Number(systems.cargo) || 0,
        weapons: Number(systems.weapons) || 0,
        sensors: Number(systems.sensors) || 0,
        medbay: Number(systems.medbay) || 0,
      },
    },
    crewSlots: Number(player?.crewSlots) || 0,
    crew,
    visits: Number(player?.stats?.visits?.[contract.destinationId]) || 0,
  };
  return JSON.stringify(inputs);
}

export function acceptContract(player, offerId) {
  if (player?.activeContract) return { ok: false, reason: 'contract_already_active', player };
  const board = player?.contractBoard;
  const offer = (board?.offers || []).find((candidate) => candidate.id === offerId);
  if (!offer) return { ok: false, reason: 'unknown_offer', player };
  if ((board.completedOfferIds || []).includes(offerId)) {
    return { ok: false, reason: 'offer_completed', player };
  }
  const node = NODES[offer.destinationId];
  if (!node) return { ok: false, reason: 'unknown_destination', player };

  const routeSeed = hashSeed(`${offer.id}:${offer.destinationId}:${offer.profile}`);
  const content = snapshotRouteContent(offer, routeSeed);
  const acceptanceSequence = Number.isSafeInteger(player?.contractAcceptanceSequence)
    ? player.contractAcceptanceSequence + 1
    : 1;
  const contractId = `contract_${board.dayKey}_${offer.profile}`;
  const activeContract = {
    id: contractId,
    acceptanceId: `${contractId}:${acceptanceSequence}`,
    offerId: offer.id,
    boardDay: board.dayKey,
    profile: offer.profile,
    title: offer.title,
    destinationId: offer.destinationId,
    favoredTrait: { ...offer.favoredTrait },
    stage: 'briefing',
    revision: 0,
    routeSeed,
    choiceId: null,
    encounterId: content.encounterId,
    orderId: null,
    result: null,
    routeOutcome: content.routeOutcome,
    secureOutcome: content.secureOutcome,
    storyFlag: content.storyFlag,
    beats: offer.beats,
    fuelSpent: 0,
    acceptedAt: Date.now(),
  };
  return {
    ok: true,
    player: { ...player, contractAcceptanceSequence: acceptanceSequence, activeContract },
    analytics: analyticsEvent('contract_accepted', {
      offerId: offer.id,
      profile: offer.profile,
      destination: offer.destinationId,
      traitMatch: false,
    }),
  };
}

function actionPreview(player, contract, action) {
  if (contract.stage === 'briefing' && action?.id === 'launch') {
    if ((player?.ship?.hull ?? 100) <= 8) return { ok: false, reason: 'hull_critical' };
    if (!readyContractCrew(player).length) return { ok: false, reason: 'no_ready_crew' };
    return {
      ok: true,
      cost: { fuel: contractFuelCost(player) },
      consequence: { nextStage: 'choice' },
    };
  }
  if (contract.stage === 'choice' && (action?.id === 'secure' || action?.id === 'push')) {
    let nextStage = 'return';
    if (contract.profile === 'risky' || (action.id === 'push' && contract.encounterId)) nextStage = 'confrontation';
    return {
      ok: true,
      cost: { fuel: contractFuelCost(player) },
      consequence: { nextStage, strongerReward: action.id === 'push' },
    };
  }
  if (contract.stage === 'confrontation' && action?.id === 'order') {
    const encounter = encounterById(contract.encounterId);
    if (!contract.encounterId || encounter.id !== contract.encounterId) {
      return { ok: false, reason: 'unknown_encounter' };
    }
    const crew = readyContractCrew(player);
    const bonus = combatBonuses(player, encounter);
    const playerPower = crewPower(crew) + bonus.extraPower;
    const enemyPower = Math.max(6, Math.round(rubberBandPower(encounter.power, playerPower) * bonus.enemyScale));
    const order = previewCombatOrder({
      playerPower,
      enemyPower,
      orderId: action.orderId,
      fuel: player?.wallet?.fuel ?? 0,
      tutorial: contract.profile === 'distress',
    });
    if (!order.enabled) return { ok: false, reason: order.reason || 'not_enough_fuel' };
    return {
      ok: true,
      cost: { fuel: order.extraFuel || 0 },
      consequence: {
        nextStage: 'return',
        chance: order.chance,
        effectivePower: order.effectivePower,
        enemyPower,
        preventsInjury: Boolean(order.preventsInjury),
        failureHullScale: order.failureHullScale ?? 1,
        forcesFailureInjury: Boolean(order.forcesFailureInjury),
        rewardScale: order.rewardScale || 1,
      },
    };
  }
  return { ok: false, reason: 'wrong_contract_stage' };
}

export function previewContractAction(player, action) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'no_active_contract' };
  const preview = actionPreview(player, contract, action);
  const base = {
    stage: contract.stage,
    revision: contract.revision,
    acceptanceId: contract.acceptanceId,
    decisionKey: contractDecisionKey(player, contract, action),
    action: action ? { ...action } : null,
    cost: preview.cost || { fuel: 0 },
    consequence: preview.consequence || null,
  };
  if (!preview.ok) return { ...base, ok: false, reason: preview.reason };
  if ((player?.wallet?.fuel ?? 0) < (preview.cost?.fuel || 0)) {
    return { ...base, ok: false, reason: 'not_enough_fuel' };
  }
  return { ...base, ok: true };
}

function routeReward(player, contract, selectedOutcome = contract.routeOutcome) {
  const outcome = selectedOutcome || {};
  const visits = player?.stats?.visits?.[contract.destinationId] || 0;
  let base = normalizeRewards(outcome);
  let kind = outcome.kind || 'salvage';
  let storyFlag = kind === 'story' ? outcome.flag || contract.storyFlag || null : null;
  if (kind === 'story') {
    const applied = applyStoryFlag(player, storyFlag);
    base = normalizeRewards(applied.rewards || { credits: 40, reputation: 3 });
  }
  let rewards = scaleSitePayout(base, player, { kind, visits });
  if (kind === 'trade' || kind === 'delivery') {
    rewards = { ...rewards, credits: tradePayout(rewards.credits, readyContractCrew(player)) };
  }
  return {
    success: true,
    rewards: normalizeRewards(rewards),
    hullLoss: 0,
    injuredCrewId: null,
    storyFlag,
    summary: kind === 'story' ? 'The signal resolves into a discovery.' : 'The contract closes cleanly.',
  };
}

function resolveContractCombat(player, contract, orderId, rng) {
  const encounter = encounterById(contract.encounterId);
  const crew = readyContractCrew(player);
  const bonus = combatBonuses(player, encounter);
  const playerPower = crewPower(crew) + bonus.extraPower;
  const enemyPower = Math.max(6, Math.round(rubberBandPower(encounter.power, playerPower) * bonus.enemyScale));
  const combat = resolveCombatOrder({
    playerPower,
    enemyPower,
    orderId,
    encounter,
    rng,
    // Commit already validated and paid the order cost. Reconstruct the
    // pre-spend balance so Burn remains enabled during deterministic resolve.
    fuel: (player?.wallet?.fuel ?? 0) + (orderId === 'burn' ? 1 : 0),
    tutorialGuaranteed: contract.profile === 'distress',
  });
  const visits = player?.stats?.visits?.[contract.destinationId] || 0;
  const rewards = contract.profile === 'distress'
    ? normalizeRewards(combat.rewards)
    : normalizeRewards(scaleSitePayout(combat.rewards, player, { kind: 'combat', visits }));

  const afterNormalHull = hullAfterCombat(player, {
    success: combat.success,
    tutorial: contract.profile === 'distress',
  });
  const originalHull = player?.ship?.hull ?? 100;
  const normalHullLoss = Math.max(0, originalHull - (afterNormalHull.ship?.hull ?? originalHull));
  const hullScale = combat.success ? 1 : (combat.failureHullScale ?? 1);
  const hullLoss = Math.floor(normalHullLoss * hullScale);
  let nextPlayer = {
    ...player,
    ship: { ...player.ship, hull: Math.max(0, originalHull - hullLoss) },
  };

  let injuredCrewId = null;
  const defaultFailureInjury = !combat.success && crew.length > 0;
  const shouldInjure = !combat.success
    && !combat.preventsInjury
    && (combat.forcesFailureInjury || defaultFailureInjury);
  if (shouldInjure) {
    const index = Math.min(crew.length - 1, Math.max(0, Math.floor(rng() * crew.length)));
    injuredCrewId = crew[index]?.instanceId || null;
    if (injuredCrewId) {
      const injuredUntil = Date.now() + injuryMinutesFor(nextPlayer, 20) * 60000;
      nextPlayer = {
        ...nextPlayer,
        crew: nextPlayer.crew.map((member) => member.instanceId === injuredCrewId
          ? { ...member, status: 'injured', injuredUntil }
          : member),
      };
    }
  }

  return {
    player: nextPlayer,
    result: {
      success: Boolean(combat.success),
      rewards,
      hullLoss,
      injuredCrewId,
      storyFlag: null,
      summary: combat.log,
    },
  };
}

export function commitContractAction(player, preview, { rng = Math.random } = {}) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'no_active_contract', player };
  if (
    !preview
    || preview.acceptanceId !== contract.acceptanceId
    || preview.revision !== contract.revision
    || preview.stage !== contract.stage
  ) {
    return { ok: false, reason: 'stale_contract_action', player };
  }

  const current = previewContractAction(player, preview.action);
  if (!current.ok) return { ok: false, reason: current.reason, player };
  if (
    preview.decisionKey !== current.decisionKey
    || JSON.stringify(preview.cost) !== JSON.stringify(current.cost)
    || JSON.stringify(preview.consequence) !== JSON.stringify(current.consequence)
  ) {
    return { ok: false, reason: 'stale_contract_action', player };
  }
  const fuelCost = current.cost?.fuel || 0;
  const spent = spendFuel(player, fuelCost);
  if (!spent.ok) return { ok: false, reason: 'not_enough_fuel', player };
  let nextPlayer = spent.player;
  let nextContract = {
    ...contract,
    revision: contract.revision + 1,
    fuelSpent: (contract.fuelSpent || 0) + fuelCost,
  };

  if (contract.stage === 'briefing') {
    nextContract.stage = 'choice';
  } else if (contract.stage === 'choice') {
    nextContract.choiceId = preview.action.id;
    nextContract.stage = current.consequence.nextStage;
    if (nextContract.stage === 'return') {
      const outcome = preview.action.id === 'secure' ? nextContract.secureOutcome : nextContract.routeOutcome;
      nextContract.result = routeReward(nextPlayer, nextContract, outcome);
    }
  } else if (contract.stage === 'confrontation') {
    const resolved = resolveContractCombat(nextPlayer, nextContract, preview.action.orderId, rng);
    nextPlayer = resolved.player;
    nextContract.stage = 'return';
    nextContract.orderId = preview.action.orderId;
    nextContract.result = resolved.result;
  }

  nextPlayer = { ...nextPlayer, activeContract: nextContract };
  return {
    ok: true,
    player: nextPlayer,
    result: nextContract.result,
    analytics: analyticsEvent('contract_action', {
      contractId: nextContract.id,
      stage: contract.stage,
      actionId: preview.action.id,
      fuel: fuelCost,
      revision: nextContract.revision,
    }),
  };
}

export function claimContractReward(player) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'already_claimed', player };
  if (contract.stage !== 'return' || !contract.result) {
    return { ok: false, reason: 'contract_not_resolved', player };
  }
  if (!validContractResult(contract.result)) {
    return { ok: false, reason: 'invalid_contract_state', player: normalizeContractState(player) };
  }
  if ((player?.contractBoard?.completedOfferIds || []).includes(contract.offerId)) {
    return { ok: false, reason: 'already_claimed', player };
  }

  let nextPlayer = player;
  if (contract.result.storyFlag) nextPlayer = applyStoryFlag(nextPlayer, contract.result.storyFlag).player;
  const wallet = grant(player.wallet, contract.result.rewards);
  const visits = { ...(player?.stats?.visits || {}) };
  visits[contract.destinationId] = (visits[contract.destinationId] || 0) + 1;
  const contractsByProfile = { ...(player?.stats?.contractsByProfile || {}) };
  contractsByProfile[contract.profile] = (contractsByProfile[contract.profile] || 0) + 1;
  const completedOfferIds = [...(player.contractBoard?.completedOfferIds || []), contract.offerId];
  const today = contractDayKey();
  const dailyLoop = player?.dailyLoop?.dayKey === today
    ? { ...player.dailyLoop, contract: true }
    : { dayKey: today, contract: true, improve: false, away: false };
  nextPlayer = {
    ...nextPlayer,
    wallet,
    location: contract.destinationId,
    stats: {
      ...player.stats,
      visits,
      contractsCompleted: (player?.stats?.contractsCompleted || 0) + 1,
      contractsByProfile,
    },
    dailyLoop,
    contractBoard: { ...player.contractBoard, completedOfferIds },
    activeContract: null,
  };
  return {
    ok: true,
    player: nextPlayer,
    result: contract.result,
    analytics: analyticsEvent('contract_reward_claimed', {
      profile: contract.profile,
      ...contract.result.rewards,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - (contract.acceptedAt || Date.now())) / 1000)),
    }),
  };
}

export function abandonContract(player, expectedRevision, expectedAcceptanceId = null) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'no_active_contract', player };
  const token = typeof expectedRevision === 'object' && expectedRevision
    ? expectedRevision
    : { revision: expectedRevision, acceptanceId: expectedAcceptanceId };
  if (contract.revision !== token.revision || contract.acceptanceId !== token.acceptanceId) {
    return { ok: false, reason: 'stale_contract_action', player };
  }
  return {
    ok: true,
    player: { ...player, activeContract: null },
    analytics: analyticsEvent('contract_abandoned', {
      profile: contract.profile,
      stage: contract.stage,
      fuelSpent: contract.fuelSpent || 0,
    }),
  };
}

function validContractResult(result) {
  const rewards = result?.rewards;
  return Boolean(
    result
    && typeof result.success === 'boolean'
    && rewards
    && ['credits', 'medals', 'reputation', 'gems', 'fuel'].every((key) => (
      typeof rewards[key] === 'number' && Number.isFinite(rewards[key])
    ))
    && typeof result.hullLoss === 'number'
    && Number.isFinite(result.hullLoss)
    && (result.injuredCrewId == null || typeof result.injuredCrewId === 'string')
    && (result.storyFlag == null || typeof result.storyFlag === 'string')
    && typeof result.summary === 'string'
  );
}

export function normalizeContractState(player) {
  const contract = player?.activeContract;
  if (!contract) return player;
  const encounterValid = contract.encounterId == null || encounterById(contract.encounterId).id === contract.encounterId;
  const favoredTraitValid = Boolean(
    contract.favoredTrait
    && ['role', 'system'].includes(contract.favoredTrait.kind)
    && typeof contract.favoredTrait.id === 'string'
    && typeof contract.favoredTrait.label === 'string'
  );
  const routeOutcomeValid = Boolean(contract.routeOutcome && typeof contract.routeOutcome.kind === 'string');
  const secureOutcomeValid = Boolean(contract.secureOutcome && typeof contract.secureOutcome.kind === 'string');
  const valid = Boolean(
    typeof contract.id === 'string'
    && typeof contract.acceptanceId === 'string'
    && contract.acceptanceId.length > 0
    && typeof contract.offerId === 'string'
    && typeof contract.boardDay === 'string'
    && CONTRACT_PROFILES_IDS.has(contract.profile)
    && typeof contract.title === 'string'
    && NODES[contract.destinationId]
    && favoredTraitValid
    && routeOutcomeValid
    && secureOutcomeValid
    && CONTRACT_STAGES.has(contract.stage)
    && Number.isInteger(contract.revision)
    && contract.revision >= 0
    && Number.isInteger(contract.routeSeed)
    && encounterValid
    && (contract.choiceId == null || typeof contract.choiceId === 'string')
    && (contract.storyFlag == null || typeof contract.storyFlag === 'string')
    && (contract.orderId == null || ['brace', 'burn', 'board'].includes(contract.orderId))
    && (contract.stage !== 'confrontation' || contract.encounterId)
    && (contract.stage !== 'return' || validContractResult(contract.result))
  );
  if (!valid) {
    return {
      ...player,
      activeContract: null,
      recoveryEvents: [
        ...(player?.recoveryEvents || []),
        { event: 'contract_recovered', reason: 'invalid_contract_state' },
      ],
    };
  }
  return {
    ...player,
    activeContract: {
      ...contract,
      choiceId: contract.choiceId || null,
      encounterId: contract.encounterId || null,
      orderId: contract.orderId || null,
      result: contract.result || null,
      fuelSpent: Number(contract.fuelSpent) || 0,
    },
  };
}
