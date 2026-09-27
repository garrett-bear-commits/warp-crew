// @ts-nocheck
import { NODES, pickOutcome, visibleNodes } from '../data/sectors.js';
import { spendFuel } from './fuel.js';
import { grant, scaleSitePayout } from './economy.js';
import { resolveCombat, resolveCombatOrder, previewCombatOrder, crewPower, encounterById, rubberBandPower } from './combat.js';
import { applyCrewInjury, grantCrewXp, fightingCrew } from './player.js';
import { applyStoryFlag } from './story.js';
import { isTutorialActive, tutorialPhase } from './tutorial.js';
import { fuelCostFor, tradePayout, combatBonuses, hullAfterCombat, injuryMinutesFor } from './passives.js';

/**
 * Preview a jump without mutating player (except we need fuel check).
 * Returns pending combat or immediately resolvable non-combat outcome.
 */
export function previewTravel(player, nodeId, { rng = Math.random } = {}) {
  const node = NODES[nodeId];
  if (!node) return { ok: false, reason: 'unknown_node' };
  const visible = visibleNodes(player);
  if (!visible.find((n) => n.id === nodeId)) {
    return { ok: false, reason: 'locked_node' };
  }
  const fuelCost = fuelCostFor(player, node.fuelCost ?? 1);
  if ((player.wallet?.fuel ?? 0) < fuelCost) {
    return { ok: false, reason: 'not_enough_fuel' };
  }
  if ((player.ship?.hull ?? 100) <= 8 && nodeId !== 'station_home') {
    return { ok: false, reason: 'hull_critical' };
  }

  if (!node.outcomes?.length) {
    return {
      ok: true,
      needsAssists: false,
      node,
      fuelCost,
      outcome: { kind: 'arrive' },
    };
  }

  let outcome = pickOutcome(node.outcomes, rng);
  // First session: Dust Lane is always the pirate scout fight.
  if (isTutorialActive(player) && !player.tutorial?.firstCombat && nodeId === 'lane_a') {
    outcome = { w: 100, kind: 'combat', encounter: 'pirate_scout' };
  }

  if (outcome.kind === 'combat') {
    const enc = encounterById(outcome.encounter);
    const bonus = combatBonuses(player, enc);
    const squad = fightingCrew(player);
    const power = crewPower(squad) + bonus.extraPower;
    const threat = rubberBandPower(enc.power, power);
    return {
      ok: true,
      needsAssists: true,
      node,
      fuelCost,
      outcome,
      encounter: { ...enc, power: Math.max(6, Math.round(threat * bonus.enemyScale)) },
      playerPower: power,
      assistMult: 1 + (bonus.pass?.assistCharge || 0),
      tutorialFight: tutorialPhase(player) !== 'done' && !player.tutorial?.firstCombat,
    };
  }

  return {
    ok: true,
    needsAssists: false,
    node,
    fuelCost,
    outcome,
  };
}

function noteVisit(player, nodeId) {
  const visits = { ...(player.stats?.visits || {}) };
  const prior = visits[nodeId] || 0;
  visits[nodeId] = prior + 1;
  return {
    player: { ...player, stats: { ...player.stats, visits } },
    prior,
  };
}

export function commitTravel(player, preview, { assistsUsed = [], orderId = null, rng = Math.random } = {}) {
  if (!preview?.ok) return { ok: false, reason: preview?.reason || 'bad_preview' };

  const order = orderId == null ? null : previewCombatOrder({
    playerPower: preview.playerPower, enemyPower: preview.encounter?.power,
    orderId, fuel: (player.wallet?.fuel || 0) - (preview.fuelCost || 0), tutorial: Boolean(preview.tutorialFight),
  });
  if (order && (!order.enabled || preview.outcome?.kind !== 'combat')) {
    return { ok: false, reason: order.reason || 'not_enough_fuel' };
  }
  const fuelCost = (preview.fuelCost ?? 0) + (order?.extraFuel || 0);
  if (fuelCost > 0) {
    const spent = spendFuel(player, fuelCost);
    if (!spent.ok) return { ok: false, reason: 'not_enough_fuel' };
    player = spent.player;
  }

  const marked = noteVisit(player, preview.node.id);
  player = marked.player;
  player = {
    ...player,
    location: preview.node.id,
    stats: { ...player.stats, jumps: (player.stats?.jumps || 0) + 1 },
  };

  const outcome = preview.outcome;
  let result = { kind: outcome.kind || 'arrive', node: preview.node, outcome };

  if (!preview.node.outcomes?.length || outcome.kind === 'arrive') {
    return { ok: true, player, result };
  }

  const crew = fightingCrew(player);
  const visits = marked.prior;

  if (outcome.kind === 'trade' || outcome.kind === 'delivery' || outcome.kind === 'salvage') {
    let reward = scaleSitePayout(
      {
        credits: outcome.credits || 0,
        medals: outcome.medals || 0,
        reputation: outcome.reputation || 0,
      },
      player,
      { kind: outcome.kind, visits }
    );
    if (outcome.kind === 'trade' || outcome.kind === 'delivery') {
      reward = { ...reward, credits: tradePayout(reward.credits, crew) };
    }
    player = { ...player, wallet: grant(player.wallet, reward) };
    result.rewards = reward;
    result.flavor =
      outcome.kind === 'trade'
        ? `The stalls at ${preview.node.name} pay out.`
        : outcome.kind === 'delivery'
          ? `Contract closed. Dockhands wave you off.`
          : `You cut salvage from the wrecklight.`;
  } else if (outcome.kind === 'combat') {
    const enc = preview.encounter;
    const power = preview.playerPower ?? crewPower(crew);
    const tutorialGuaranteed = Boolean(preview.tutorialFight);
    const combat = (order ? resolveCombatOrder : resolveCombat)({
      playerPower: power,
      enemyPower: enc.power,
      assistsUsed,
      rng,
      tutorialGuaranteed,
      assistMult: preview.assistMult || 1,
      encounter: enc,
      orderId,
      fuel: order?.extraFuel || 0,
    });
    let rewards = combat.rewards;
    if (!tutorialGuaranteed) {
      rewards = scaleSitePayout(rewards, player, { kind: 'combat', visits });
    }
    player = { ...player, wallet: grant(player.wallet, rewards) };
    const hullBefore = player.ship?.hull ?? 100;
    player = hullAfterCombat(player, {
      success: combat.success,
      tutorial: tutorialGuaranteed,
    });
    if (!combat.success && combat.failureHullScale != null) {
      const loss = Math.floor((hullBefore - player.ship.hull) * combat.failureHullScale);
      player = { ...player, ship: { ...player.ship, hull: hullBefore - loss } };
    }
    if (combat.success) {
      player = {
        ...player,
        stats: { ...player.stats, combatsWon: (player.stats.combatsWon || 0) + 1 },
      };
      if (!tutorialGuaranteed) {
        player = grantCrewXp(player, crew.map((c) => c.instanceId), 10);
      }
    } else if (!tutorialGuaranteed && crew.length && !combat.preventsInjury) {
      const pick = crew[Math.floor(rng() * crew.length)];
      player = applyCrewInjury(player, [pick.instanceId], injuryMinutesFor(player, 20));
      result.injured = pick.name;
    }
    result.combat = { ...combat, encounter: enc, assistsUsed: [...assistsUsed], rewards };
    result.rewards = rewards;
  } else if (outcome.kind === 'story') {
    const applied = applyStoryFlag(player, outcome.flag);
    player = applied.player;
    result.flag = outcome.flag;
    result.beat = applied.beat;
    result.already = Boolean(applied.already);
    result.rewards = applied.rewards || null;
    if (applied.already) {
      const consolation = scaleSitePayout(
        { credits: 18, medals: 1, reputation: 0 },
        player,
        { kind: 'salvage', visits }
      );
      player = { ...player, wallet: grant(player.wallet, consolation) };
      result.rewards = consolation;
      result.flavor = `You already logged this beat at ${preview.node.name}. Dock scrap.`;
    }
  }

  return { ok: true, player, result };
}

/** Legacy one-shot (auto assist shield) — kept for tests */
export function travelTo(player, nodeId, opts = {}) {
  const preview = previewTravel(player, nodeId, opts);
  if (!preview.ok) return preview;
  return commitTravel(player, preview, {
    assistsUsed: opts.assistsUsed || (preview.needsAssists ? ['shield_boost'] : []),
    rng: opts.rng,
  });
}
