// @ts-nocheck
/** Shared production payout and combat mutations; preview callers use disposable players. */
import { encounterById, resolveCombatOrder, crewPower, rubberBandPower } from './combat.js';
import { scaleSitePayout } from './economy.js';
import { combatBonuses, hullAfterCombat, injuryMinutesFor, tradePayout } from './passives.js';
import { applyStoryFlag } from './story.js';
import { grantCrewXp } from './player.js';

export const CURRENCIES = ['credits', 'medals', 'reputation', 'gems', 'fuel'];

function currencyPresence(rewards) {
  return Object.fromEntries(CURRENCIES.map(key => [key, Object.hasOwn(rewards, key)]));
}

export function normalizeCurrencyReward(rewards = {}) {
  return {
    credits: Number(rewards.credits) || 0,
    medals: Number(rewards.medals) || 0,
    reputation: Number(rewards.reputation) || 0,
    gems: Number(rewards.gems) || 0,
    fuel: Number(rewards.fuel) || 0,
  };
}


export function readyContractCrew(player, now = Date.now()) {
  const ready = (player?.crew || []).filter((crew) => {
    if (crew.status === 'expedition') return false;
    return crew.status !== 'injured' || (crew.injuredUntil || 0) <= now;
  });
  const slots = Math.max(1, player?.crewSlots || 2);
  return [...ready].sort((a, b) => (b.power || 0) - (a.power || 0)).slice(0, slots);
}


export function resolveRoutePayout(player, contract, selectedOutcome = contract.routeOutcome, now = Date.now()) {
  const outcome = selectedOutcome || {};
  const visits = player?.stats?.visits?.[contract.destinationId] || 0;
  let rawRewards = outcome;
  let base = normalizeCurrencyReward(outcome);
  let kind = outcome.kind || 'salvage';
  let storyFlag = kind === 'story' ? outcome.flag || contract.storyFlag || null : null;
  if (kind === 'story') {
    const applied = applyStoryFlag(player, storyFlag);
    rawRewards = applied.rewards || { credits: 40, reputation: 3 };
    base = normalizeCurrencyReward(rawRewards);
  }
  let rewards = scaleSitePayout(base, player, { kind, visits });
  if (kind === 'trade' || kind === 'delivery') {
    rewards = { ...rewards, credits: tradePayout(rewards.credits, readyContractCrew(player, now)) };
  }
  return {
    success: true,
    rewards: normalizeCurrencyReward(rewards),
    rewardPresence: currencyPresence(rawRewards),
    hullLoss: 0,
    injuredCrewId: null,
    storyFlag,
    summary: kind === 'story' ? 'The signal resolves into a discovery.' : 'The contract closes cleanly.',
  };
}

export function resolveContractCombatPayout(player, contract, orderId, { rng = Math.random, now = Date.now() } = {}) {
  const encounter = encounterById(contract.encounterId);
  const crew = readyContractCrew(player, now);
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
    ? normalizeCurrencyReward(combat.rewards)
    : normalizeCurrencyReward(scaleSitePayout(combat.rewards, player, { kind: 'combat', visits }));

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
      const injuredUntil = now + injuryMinutesFor(nextPlayer, 20) * 60000;
      nextPlayer = {
        ...nextPlayer,
        crew: nextPlayer.crew.map((member) => member.instanceId === injuredCrewId
          ? { ...member, status: 'injured', injuredUntil }
          : member),
      };
    }
  }

  if (combat.success && contract.profile !== 'distress') {
    nextPlayer = grantCrewXp(nextPlayer, crew.map(member => member.instanceId), 10);
    nextPlayer = { ...nextPlayer, stats: { ...nextPlayer.stats, combatsWon: (nextPlayer.stats?.combatsWon || 0) + 1 } };
  }

  return {
    player: nextPlayer,
    result: {
      success: Boolean(combat.success),
      rewards,
      rewardPresence: currencyPresence(combat.rewards),
      hullLoss,
      injuredCrewId,
      storyFlag: null,
      summary: combat.log,
    },
  };
}

/** Construct a prize from a saved crew-run victory without rolling combat again. */
export function resolveSimulatedCombatPayout(player, contract, encounter, now = Date.now()) {
  const catalog = encounterById(contract.encounterId);
  const lost = encounter.result === 'loss' && contract.profile !== 'distress';
  // Wall attempts: the flagship falls only when this attempt spends its last hull.
  const wallSegment = contract.wall && Number.isInteger(encounter.enemy?.startHull) ? encounter.enemy.startHull : null;
  const wallOutcome = wallSegment != null ? {
    id: contract.wall.id,
    dealt: wallSegment - Math.max(0, encounter.enemy.hull),
    defeated: !lost && encounter.enemy.remainingBefore != null && encounter.enemy.remainingBefore <= wallSegment,
  } : null;
  const flagshipDown = wallOutcome?.defeated === true;
  const winRewards = contract.profile === 'distress'
    ? { credits: 120, medals: 8, reputation: 4 }
    : flagshipDown
      ? { ...catalog.rewards, credits: (catalog.rewards.credits || 0) * 2, medals: (catalog.rewards.medals || 0) * 2, reputation: (catalog.rewards.reputation || 0) * 2, gems: 20 }
      : catalog.rewards;
  // A lost crew fight pays the same salvage share the order-based fights paid on failure.
  const rawRewards = lost
    ? {
        credits: Math.max(8, Math.floor((winRewards.credits || 0) * 0.22)),
        medals: Math.max(1, Math.floor((winRewards.medals || 0) * 0.25)),
        reputation: 0,
      }
    : encounter.tactics?.board?.success === true
      // A successful boarding strips the prize ship, as Board did before.
      ? { ...winRewards, credits: Math.floor((winRewards.credits || 0) * 1.25), medals: Math.floor((winRewards.medals || 0) * 1.25) }
      : winRewards;
  const visits = player?.stats?.visits?.[contract.destinationId] || 0;
  const rewards = contract.profile === 'distress'
    ? normalizeCurrencyReward(rawRewards)
    : normalizeCurrencyReward(scaleSitePayout(rawRewards, player, { kind: 'combat', visits }));
  const hullLoss = Math.max(0, 30 - encounter.hull);
  let nextPlayer = {
    ...player,
    ship: { ...player.ship, hull: Math.max(1, (player.ship?.hull ?? 100) - hullLoss) },
  };
  let injuredCrewId = null;
  // A failed boarding party always comes home hurt; otherwise only unbraced losses injure.
  if (encounter.tactics?.board?.success === false || (lost && !encounter.orders?.brace?.uses)) {
    // Bracing during the fight keeps the crew safe, as Brace did before.
    const participants = (contract.participantIds || []).filter(id => nextPlayer.crew?.some(member => member.instanceId === id));
    injuredCrewId = participants.length ? participants[Math.abs(encounter.seed) % participants.length] : null;
    if (injuredCrewId) {
      const injuredUntil = now + injuryMinutesFor(nextPlayer, 20) * 60000;
      nextPlayer = {
        ...nextPlayer,
        crew: nextPlayer.crew.map(member => member.instanceId === injuredCrewId ? { ...member, status: 'injured', injuredUntil } : member),
      };
    }
  }
  if (contract.profile !== 'distress' && !lost) {
    nextPlayer = grantCrewXp(nextPlayer, contract.participantIds || [], 10);
    nextPlayer = { ...nextPlayer, stats: { ...nextPlayer.stats, combatsWon: (nextPlayer.stats?.combatsWon || 0) + 1 } };
  }
  return {
    player: nextPlayer,
    result: {
      success: !lost,
      rewards,
      rewardPresence: currencyPresence(winRewards),
      hullLoss,
      injuredCrewId,
      storyFlag: null,
      summary: flagshipDown ? `${catalog.name} is broken. The way ahead is open.`
        : wallOutcome && !lost ? `${catalog.name} limps away. Its damage holds until the daily reset.`
          : lost ? (catalog.fail || 'The crew breaks off. Salvage recovered.') : (catalog.win || 'The enemy ship breaks off. Cargo aboard.'),
      ...(wallOutcome ? { wall: wallOutcome } : {}),
    },
  };
}


export function formatRewardBand(band) {
  if (!band?.available) return 'Reward unavailable';
  return CURRENCIES.filter(key => band.currencies?.[key]?.max > 0).map(key => {
    const { min, max, presentOnAllPaths } = band.currencies[key];
    const amount = min === max ? String(max) : !presentOnAllPaths ? `up to ${max}` : `${min}–${max}`;
    return `${amount} ${key}`;
  }).join(' · ') || '0 credits';
}
