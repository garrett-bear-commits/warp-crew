import { NODES, pickOutcome } from '../data/sectors.js';
import { spendFuel } from './fuel.js';
import { grant } from './economy.js';
import { resolveCombat, ENCOUNTERS_V1, crewPower } from './combat.js';
import { readyCrew } from './player.js';

export function travelTo(player, nodeId, { rng = Math.random, assistsUsed = [] } = {}) {
  const node = NODES[nodeId];
  if (!node) return { ok: false, reason: 'unknown_node' };

  const fuelCost = node.fuelCost ?? 1;
  if (fuelCost > 0) {
    const spent = spendFuel(player, fuelCost);
    if (!spent.ok) return { ok: false, reason: 'not_enough_fuel' };
    player = spent.player;
  }

  player = {
    ...player,
    location: nodeId,
    stats: { ...player.stats, jumps: (player.stats?.jumps || 0) + 1 },
  };

  if (!node.outcomes?.length) {
    return { ok: true, player, result: { kind: 'arrive', node } };
  }

  const outcome = pickOutcome(node.outcomes, rng);
  let result = { kind: outcome.kind, node, outcome };

  if (outcome.kind === 'trade' || outcome.kind === 'delivery' || outcome.kind === 'salvage') {
    const reward = {
      credits: outcome.credits || 0,
      medals: outcome.medals || 0,
      reputation: outcome.reputation || 0,
    };
    player = { ...player, wallet: grant(player.wallet, reward) };
    result.rewards = reward;
  } else if (outcome.kind === 'combat') {
    const enc = ENCOUNTERS_V1.find((e) => e.id === outcome.encounter) || ENCOUNTERS_V1[0];
    const power = crewPower(readyCrew(player));
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
    result.combat = { ...combat, encounter: enc };
    result.rewards = combat.rewards;
  } else if (outcome.kind === 'story') {
    player = {
      ...player,
      flags: { ...player.flags, [outcome.flag]: true },
      story: {
        ...player.story,
        eclipseIntro: player.story.eclipseIntro || outcome.flag === 'rumor_swarm' || outcome.flag === 'colony_help',
      },
    };
    result.flag = outcome.flag;
  }

  return { ok: true, player, result };
}
