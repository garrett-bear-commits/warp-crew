// @ts-nocheck
import { NODES, pickOutcome, visibleNodes } from '../data/sectors.js';
import { spendFuel } from './fuel.js';
import { grant } from './economy.js';
import { resolveCombat, ENCOUNTERS_V1, crewPower } from './combat.js';
import { readyCrew } from './player.js';
import { applyStoryFlag } from './story.js';
import { isTutorialActive, tutorialPhase } from './tutorial.js';
import { fuelCostFor, tradePayout, combatBonuses, hullAfterCombat } from './passives.js';

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
    const enc = ENCOUNTERS_V1.find((e) => e.id === outcome.encounter) || ENCOUNTERS_V1[0];
    const bonus = combatBonuses(player, enc);
    const power = crewPower(readyCrew(player)) + bonus.extraPower;
    return {
      ok: true,
      needsAssists: true,
      node,
      fuelCost,
      outcome,
      encounter: { ...enc, power: Math.max(6, Math.round(enc.power * bonus.enemyScale)) },
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

export function commitTravel(player, preview, { assistsUsed = [], rng = Math.random } = {}) {
  if (!preview?.ok) return { ok: false, reason: preview?.reason || 'bad_preview' };

  const fuelCost = preview.fuelCost ?? 0;
  if (fuelCost > 0) {
    const spent = spendFuel(player, fuelCost);
    if (!spent.ok) return { ok: false, reason: 'not_enough_fuel' };
    player = spent.player;
  }

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

  if (outcome.kind === 'trade' || outcome.kind === 'delivery' || outcome.kind === 'salvage') {
    const crew = readyCrew(player);
    const reward = {
      credits: tradePayout(outcome.credits || 0, crew),
      medals: outcome.medals || 0,
      reputation: outcome.reputation || 0,
    };
    player = { ...player, wallet: grant(player.wallet, reward) };
    result.rewards = reward;
  } else if (outcome.kind === 'combat') {
    const enc = preview.encounter;
    const power = preview.playerPower ?? crewPower(readyCrew(player));
    const tutorialGuaranteed = Boolean(preview.tutorialFight);
    const combat = resolveCombat({
      playerPower: power,
      enemyPower: enc.power,
      assistsUsed,
      rng,
      tutorialGuaranteed,
      assistMult: preview.assistMult || 1,
    });
    player = { ...player, wallet: grant(player.wallet, combat.rewards) };
    player = hullAfterCombat(player, {
      success: combat.success,
      tutorial: tutorialGuaranteed,
    });
    if (combat.success) {
      player = {
        ...player,
        stats: { ...player.stats, combatsWon: (player.stats.combatsWon || 0) + 1 },
      };
    }
    result.combat = { ...combat, encounter: enc, assistsUsed: [...assistsUsed] };
    result.rewards = combat.rewards;
  } else if (outcome.kind === 'story') {
    const applied = applyStoryFlag(player, outcome.flag);
    player = applied.player;
    result.flag = outcome.flag;
    result.beat = applied.beat;
    result.rewards = { credits: 40, reputation: 3 };
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
