// @ts-nocheck
/**
 * Hybrid auto-battler + player assists (mid-core).
 * Combat is short (30–90s conceptual); for v1 we resolve with power + assists used.
 */

export const ASSISTS = {
  shield_boost: { id: 'shield_boost', name: 'Shield Boost', power: 8, cost: {} },
  repair_bots: { id: 'repair_bots', name: 'Repair Bots', power: 6, cost: {} },
  overcharge: { id: 'overcharge', name: 'Overcharge', power: 12, cost: {} },
  decoy: { id: 'decoy', name: 'Decoy Flare', power: 5, cost: {} },
};

export function crewPower(crewList = []) {
  return crewList.reduce((s, c) => s + (c.power || 10), 0);
}

export function resolveCombat({
  playerPower,
  enemyPower,
  assistsUsed = [],
  rng = Math.random,
  tutorialGuaranteed = false,
}) {
  const assistPower = assistsUsed.reduce((s, id) => s + (ASSISTS[id]?.power || 0), 0);
  const total = playerPower + assistPower;
  if (tutorialGuaranteed) {
    return {
      success: true,
      playerPower: total,
      enemyPower,
      rewards: { credits: 120, medals: 8, reputation: 4 },
      log: 'First contact. The scout wing breaks off.',
      tutorial: true,
    };
  }
  const ratio = total / Math.max(1, enemyPower);
  const roll = 0.15 + ratio * 0.7 + (rng() - 0.5) * 0.1;
  const success = roll >= 0.5;
  const credits = success ? Math.floor(40 + enemyPower * 0.8) : Math.floor(10 + enemyPower * 0.1);
  const medals = success ? Math.floor(4 + enemyPower * 0.15) : 1;
  const reputation = success ? 3 : 0;
  return {
    success,
    playerPower: total,
    enemyPower,
    rewards: { credits, medals, reputation },
    log: success
      ? `Victory. Assists contributed +${assistPower} power.`
      : `Defeat. Hull holds; crew shaken. Scrap recovered.`,
  };
}

export const ENCOUNTERS_V1 = [
  { id: 'pirate_scout', name: 'Pirate Scout', power: 12, rewards: { credits: 40, medals: 2, reputation: 1 } },
  { id: 'pirate_wing', name: 'Pirate Wing', power: 22, rewards: { credits: 80, medals: 5, reputation: 2 } },
  { id: 'scrapper_gang', name: 'Scrapper Gang', power: 18, rewards: { credits: 70, medals: 6, reputation: 1 } },
  { id: 'swarm_probe', name: 'Eclipse Probe', power: 20, rewards: { credits: 60, medals: 6, reputation: 3 } },
  { id: 'swarm_skirmish', name: 'Swarm Skirmish', power: 32, rewards: { credits: 120, medals: 10, reputation: 5 } },
  { id: 'swarm_frigate', name: 'Swarm Frigate Echo', power: 48, rewards: { credits: 200, medals: 18, reputation: 8 } },
  { id: 'pirate_ace', name: 'Corsair Ace', power: 28, rewards: { credits: 110, medals: 9, reputation: 3 } },
];

export function listAssists({ tutorial = false } = {}) {
  const all = Object.values(ASSISTS);
  if (tutorial) return all.filter((a) => a.id === 'shield_boost');
  return all;
}
