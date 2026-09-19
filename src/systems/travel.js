import { NODES, pickOutcome } from '../data/sectors.js';
import { spendFuel } from './fuel.js';
import { grant } from './economy.js';
import { resolveCombat, ENCOUNTERS_V1, crewPower } from './combat.js';
import { readyCrew } from './player.js';

/**
 * Preview a jump without mutating player (except we need fuel check).
 * Returns pending combat or immediately resolvable non-combat outcome.
 */
export function previewTravel(player, nodeId, { rng = Math.random } = {}) {
  const node = NODES[nodeId];
  if (!node) return { ok: false, reason: 'unknown_node' };
  const fuelCost = node.fuelCost ?? 1;
  if ((player.wallet?.fuel ?? 0) < fuelCost) {
    return { ok: false, reason: 'not_enough_fuel' };
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

  const outcome = pickOutcome(node.outcomes, rng);
  if (outcome.kind === 'combat') {
    const enc = ENCOUNTERS_V1.find((e) => e.id === outcome.encounter) || ENCOUNTERS_V1[0];
    const power = crewPower(readyCrew(player));
    return {
      ok: true,
      needsAssists: true,
      node,
      fuelCost,
      outcome,
      encounter: enc,
      playerPower: power,
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
    const reward = {
      credits: outcome.credits || 0,
      medals: outcome.medals || 0,
      reputation: outcome.reputation || 0,
    };
    player = { ...player, wallet: grant(player.wallet, reward) };
    result.rewards = reward;
  } else if (outcome.kind === 'combat') {
    const enc = preview.encounter;
    const power = preview.playerPower ?? crewPower(readyCrew(player));
    const combat = resolveCombat({
      playerPower: power,
      enemyPower: enc.power,
      assistsUsed,
      rng,
    });
    player = { ...player, wallet: grant(player.wallet, combat.rewards) };
    if (combat.success) {
      player = {
        ...player,
        stats: { ...player.stats, combatsWon: (player.stats.combatsWon || 0) + 1 },
      };
    }
    result.combat = { ...combat, encounter: enc, assistsUsed: [...assistsUsed] };
    result.rewards = combat.rewards;
  } else if (outcome.kind === 'story') {
    player = {
      ...player,
      flags: { ...player.flags, [outcome.flag]: true },
      story: {
        ...player.story,
        eclipseIntro:
          player.story.eclipseIntro ||
          outcome.flag === 'rumor_swarm' ||
          outcome.flag === 'colony_help',
      },
    };
    result.flag = outcome.flag;
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
