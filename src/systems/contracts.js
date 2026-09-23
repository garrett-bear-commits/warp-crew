// @ts-nocheck
/** Deterministic, saved daily Contract Board. Route mutations belong elsewhere. */

import { visibleNodes, NODES } from '../data/sectors.js';
import { CONTRACT_PROFILES, combatWeight, qualifiesForProfile, storySalvageWeight } from '../data/contracts.js';
import { encounterById, previewCombatOrder, crewPower, rubberBandPower } from './combat.js';
import { grant, scaleSitePayout } from './economy.js';
import { spendFuel } from './fuel.js';
import { fuelCostFor, combatBonuses } from './passives.js';
import { applyStoryFlag } from './story.js';
import { normalizeContractState as normalizeSavedContractState, validContractResult } from './contractState.js';
import { CURRENCIES, readyContractCrew, normalizeCurrencyReward as normalizeRewards, resolveRoutePayout, resolveContractCombatPayout, formatRewardBand } from './contractRewards.js';

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
  // Preserve the existing board seed stream; length now follows route content.
  rng();
  const normalFuel = 2;
  const offer = {
    id: `offer_${boardDay}_${profile.id}`,
    profile: profile.id,
    icon: profile.icon,
    title: pick(profile.titles, rng),
    brief: pick(profile.briefs, rng),
    destinationId: node.id,
    destinationName: node.name,
    normalFuel,
    rewardFamily: profile.rewardFamily,
    danger: dangerFor(profile, node),
    favoredTrait: { ...profile.favoredTrait },
  };
  return withRouteSnapshot(offer);
}

function withRouteSnapshot(offer) {
  const routeSeed = hashSeed(`${offer.id}:${offer.destinationId}:${offer.profile}`);
  const content = snapshotRouteContent(offer, routeSeed);
  const secureBeats = offer.profile === 'risky' ? 3 : 2;
  const pushBeats = content.encounterId ? 3 : 2;
  return {
    ...offer,
    routeContent: { ...content, destinationId: offer.destinationId, routeSeed },
    beats: Math.max(secureBeats, pushBeats),
    beatLabel: secureBeats === pushBeats ? `${secureBeats} beats` : '2–3 beats',
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
  // This is a durable claim ledger, including previous local dates. Clock or
  // timezone recovery may revisit a day, but cannot reopen its claimed offers.
  return { dayKey: boardDay, offers, completedOfferIds: [...new Set(player?.contractBoard?.completedOfferIds || [])] };
}

export function ensureContractBoard(player, now = Date.now()) {
  const boardDay = contractDayKey(now);
  const saved = player?.contractBoard;
  if (saved && (saved.dayKey === boardDay || player?.activeContract)) {
    if (!player.activeContract && saved.offers.some(offer => offer.profile !== 'distress' && !offer.routeContent)) {
      const board = { ...saved, offers: saved.offers.map(offer => offer.profile !== 'distress' && !offer.routeContent ? withRouteSnapshot(offer) : offer) };
      return { player: { ...player, contractBoard: board }, board, refreshed: false };
    }
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
    normalFuel: 1,
    danger: 'Guarded',
    rewardFamily: 'credits, medals, and reputation',
    favoredTrait: { kind: 'role', id: 'engineer', label: 'Engineer', why: 'An engineer keeps a rescue run together.' },
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
  if (offer.profile === 'risky') {
    const combats = (node?.outcomes || []).filter(outcome => outcome.kind === 'combat')
      .sort((a, b) => encounterById(a.encounter).power - encounterById(b.encounter).power
        || a.encounter.localeCompare(b.encounter));
    if (combats.length) return {
      routeOutcome: { ...combats.at(-1) },
      secureOutcome: { ...combats[0] },
      encounterId: combats.at(-1).encounter,
      storyFlag: null,
    };
  }
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

function contractFuelCost(player) {
  return fuelCostFor(player, 1);
}

function analyticsEvent(event, fields) {
  return { event, ...fields };
}

function contractDecisionKey(player, contract, action, now = Date.now()) {
  const crew = readyContractCrew(player, now).map((member) => ({
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

function validRewardContent(content, destinationId) {
  const validEncounter = id => id == null || encounterById(id).id === id;
  const validOutcome = outcome => Boolean(outcome && ['combat', 'trade', 'delivery', 'salvage', 'story', 'arrive'].includes(outcome.kind)
    && CURRENCIES.every(key => !Object.hasOwn(outcome, key) || (typeof outcome[key] === 'number' && Number.isFinite(outcome[key]) && outcome[key] >= 0))
    && (outcome.kind !== 'combat' || (typeof outcome.encounter === 'string' && validEncounter(outcome.encounter)))
    && (outcome.kind !== 'story' || typeof outcome.flag === 'string'));
  return Boolean(content && NODES[destinationId] && validOutcome(content.routeOutcome) && validOutcome(content.secureOutcome)
    && validEncounter(content.encounterId) && (content.storyFlag == null || typeof content.storyFlag === 'string'));
}

function validOfferContent(offer) {
  return offer?.profile === 'distress' || Boolean(offer?.routeContent
    && offer.routeContent.destinationId === offer.destinationId
    && Number.isInteger(offer.routeContent.routeSeed)
    && (offer.routeContent.routeOutcome?.kind !== 'combat' || offer.routeContent.encounterId === offer.routeContent.routeOutcome.encounter)
    && validRewardContent(offer.routeContent, offer.destinationId));
}

export function acceptContract(player, offerId, now = Date.now()) {
  if (player?.activeContract) return { ok: false, reason: 'contract_already_active', player };
  const board = player?.contractBoard;
  const offer = (board?.offers || []).find((candidate) => candidate.id === offerId);
  if (!offer) return { ok: false, reason: 'unknown_offer', player };
  if ((board.completedOfferIds || []).includes(offerId)) {
    return { ok: false, reason: 'offer_completed', player };
  }
  const node = NODES[offer.destinationId];
  if (!node) return { ok: false, reason: 'unknown_destination', player };
  if (!validOfferContent(offer)) return { ok: false, reason: 'invalid_contract_content', player };
  if (offer.profile === 'distress' && (player.tutorial?.firstCombat || player.tutorial?.hiredThird || player.tutorial?.completed || player.tutorial?.dismissed)) {
    return { ok: false, reason: 'tutorial_already_resolved', player };
  }

  const routeSeed = hashSeed(`${offer.id}:${offer.destinationId}:${offer.profile}`);
  const content = offer.profile === 'distress'
    ? { routeOutcome: { kind: 'combat', encounter: 'pirate_scout' }, secureOutcome: { kind: 'combat', encounter: 'pirate_scout' }, encounterId: 'pirate_scout', storyFlag: null }
    : offer.routeContent;
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
    routeSeed: offer.profile === 'distress' ? routeSeed : content.routeSeed,
    choiceId: null,
    encounterId: content.encounterId,
    orderId: null,
    result: null,
    routeOutcome: content.routeOutcome,
    secureOutcome: content.secureOutcome,
    storyFlag: content.storyFlag,
    beats: offer.beats,
    fuelSpent: offer.profile === 'distress' ? player.tutorial?.contractRecoveryFuelSpent || 0 : 0,
    acceptedAt: now,
  };
  return {
    ok: true,
    player: {
      ...player, contractAcceptanceSequence: acceptanceSequence, activeContract,
      tutorial: offer.profile === 'distress' && player.tutorial?.contractRecoveryFuelSpent
        ? { ...player.tutorial, contractRecoveryFuelSpent: 0 } : player.tutorial,
    },
    analytics: analyticsEvent('contract_accepted', {
      offerId: offer.id,
      profile: offer.profile,
      destination: offer.destinationId,
      traitMatch: false,
    }),
  };
}

function actionPreview(player, contract, action, now = Date.now()) {
  if (contract.stage === 'briefing' && action?.id === 'launch') {
    if ((player?.ship?.hull ?? 100) <= 8) return { ok: false, reason: 'hull_critical' };
    if (!readyContractCrew(player, now).length) return { ok: false, reason: 'no_ready_crew' };
    return {
      ok: true,
      cost: { fuel: contract.profile === 'distress' ? Math.max(0, contractFuelCost(player) - contract.fuelSpent) : contractFuelCost(player) },
      consequence: { nextStage: contract.profile === 'distress' ? 'confrontation' : 'choice' },
    };
  }
  if (contract.stage === 'choice' && (action?.id === 'secure' || action?.id === 'push')) {
    let nextStage = 'return';
    if (contract.profile === 'risky' || (action.id === 'push' && contract.encounterId)) nextStage = 'confrontation';
    const selected = action.id === 'secure' ? contract.secureOutcome : contract.routeOutcome;
    const encounterId = contract.profile === 'risky'
      ? (selected.kind === 'combat' ? selected.encounter : contract.encounterId)
      : nextStage === 'confrontation' ? contract.encounterId : null;
    const encounter = encounterId ? encounterById(encounterId) : null;
    const sameEncounter = contract.profile === 'risky'
      && (contract.secureOutcome.kind !== 'combat' || contract.secureOutcome.encounter === contract.routeOutcome.encounter);
    return {
      ok: true,
      cost: { fuel: contractFuelCost(player) },
      consequence: {
        nextStage, encounterId, encounterName: encounter?.name || null,
        encounterPower: encounter?.power || null,
        encounterRewards: encounter ? normalizeRewards(scaleSitePayout(encounter.rewards, player, { kind: 'combat', visits: player.stats?.visits?.[contract.destinationId] || 0 })) : null,
        sameEncounter,
        strongerReward: contract.profile === 'risky' && action.id === 'push' && !sameEncounter,
      },
    };
  }
  if (contract.stage === 'confrontation' && action?.id === 'order') {
    const encounter = encounterById(contract.encounterId);
    if (!contract.encounterId || encounter.id !== contract.encounterId) {
      return { ok: false, reason: 'unknown_encounter' };
    }
    const crew = readyContractCrew(player, now);
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

export function previewContractAction(player, action, now = Date.now()) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'no_active_contract' };
  const preview = actionPreview(player, contract, action, now);
  const base = {
    stage: contract.stage,
    revision: contract.revision,
    acceptanceId: contract.acceptanceId,
    decisionKey: contractDecisionKey(player, contract, action, now),
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

export function commitContractAction(player, preview, { rng = Math.random, now = Date.now() } = {}) {
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

  const current = previewContractAction(player, preview.action, now);
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
    nextContract.stage = current.consequence.nextStage;
  } else if (contract.stage === 'choice') {
    nextContract.choiceId = preview.action.id;
    nextContract.stage = current.consequence.nextStage;
    if (nextContract.stage === 'confrontation') nextContract.encounterId = current.consequence.encounterId;
    if (nextContract.stage === 'return') {
      const outcome = preview.action.id === 'secure' ? nextContract.secureOutcome : nextContract.routeOutcome;
      nextContract.result = resolveRoutePayout(nextPlayer, nextContract, outcome, now);
    }
  } else if (contract.stage === 'confrontation') {
    nextContract.participantIds = readyContractCrew(nextPlayer, now).map(member => member.instanceId);
    const resolved = resolveContractCombatPayout(nextPlayer, nextContract, preview.action.orderId, { rng, now });
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

/** Only production-approved actions on ephemeral players contribute a terminal path. */
function enumerateRewardPaths(player, offer, now) {
  let copy = JSON.parse(JSON.stringify(player));
  const active = copy.activeContract;
  if (active) {
    if (offer?.id !== active.id && offer?.id !== active.offerId && offer?.offerId !== active.offerId) return [];
    if (active.stage === 'return') return [];
    if (!validRewardContent(active, active.destinationId)) return [];
  } else {
    if (!validOfferContent(offer)) return [];
    copy.contractBoard = { ...copy.contractBoard, offers: [JSON.parse(JSON.stringify(offer))] };
    const accepted = acceptContract(copy, offer.id, now);
    if (!accepted.ok) return [];
    copy = accepted.player;
  }
  const terminals = [];
  function advance(current) {
    const contract = current.activeContract;
    if (contract.stage === 'return') {
      if (validContractResult(contract.result)) terminals.push(contract.result);
      return;
    }
    const actions = contract.stage === 'briefing' ? [{ id: 'launch' }]
      : contract.stage === 'choice' ? [{ id: 'secure' }, { id: 'push' }]
      : contract.stage === 'confrontation' ? ['brace', 'burn', 'board'].map(orderId => ({ id: 'order', orderId })) : [];
    for (const action of actions) {
      const preview = previewContractAction(current, action, now);
      if (!preview.ok) continue;
      for (const roll of contract.stage === 'confrontation' ? [0, 1] : [0]) {
        const branch = JSON.parse(JSON.stringify(current));
        const committed = commitContractAction(branch, preview, { rng: () => roll, now });
        if (committed.ok) advance(committed.player);
      }
    }
  }
  advance(copy);
  return terminals;
}

export function contractRewardBand(player, offer, { now = Date.now() } = {}) {
  const terminals = enumerateRewardPaths(player, offer, now);
  if (!terminals.length) return { available: false, label: 'Reward unavailable', currencies: {}, paths: [] };
  const paths = [...new Map(terminals.map(result => [JSON.stringify(result.rewards), result.rewards])).values()];
  const currencies = {};
  for (const key of CURRENCIES) {
    const amounts = paths.map(path => path[key]);
    const max = Math.max(...amounts);
    if (max > 0) currencies[key] = { min: Math.min(...amounts), max, presentOnAllPaths: terminals.every(result => result.rewardPresence?.[key] === true) };
  }
  const band = { available: true, currencies, paths };
  return { ...band, label: formatRewardBand(band) };
}

export function claimContractReward(player, now = Date.now()) {
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
  const today = contractDayKey(now);
  const dailyLoop = player?.dailyLoop?.dayKey === today
    ? { ...player.dailyLoop, contract: true }
    : { dayKey: today, contract: true, improve: false, away: false };
  nextPlayer = {
    ...nextPlayer,
    wallet,
    flags: contract.profile === 'distress' ? { ...nextPlayer.flags, sparrowFirstRepair: true } : nextPlayer.flags,
    location: contract.destinationId,
    stats: {
      ...player.stats,
      visits,
      jumps: (player.stats?.jumps || 0) + 1,
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
      elapsedSeconds: Math.max(0, Math.floor((now - (contract.acceptedAt || now)) / 1000)),
    }),
  };
}

export function abandonContract(player, expectedRevision, expectedAcceptanceId = null) {
  const contract = player?.activeContract;
  if (!contract) return { ok: false, reason: 'no_active_contract', player };
  if (contract.profile === 'distress') return { ok: false, reason: 'tutorial_contract_required', player };
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

export function normalizeContractState(player) {
  return normalizeSavedContractState(player, { nodes: NODES, encounterById });
}
