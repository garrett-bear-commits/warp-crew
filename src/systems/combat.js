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

/** Free assists, but you only get two per fight so they stay a choice. */
export const ASSIST_CAP = 2;

/**
 * The single consequential command offered by contract combat.  Keep these
 * values in one place so previews and resolution cannot drift apart.
 */
export const COMBAT_ORDERS = {
  brace: {
    id: 'brace',
    name: 'Brace',
    extraFuel: 0,
    powerBonus: 0,
    powerScale: 1,
    preventsInjury: true,
    failureHullScale: 0.5,
  },
  burn: {
    id: 'burn',
    name: 'Burn',
    extraFuel: 1,
    powerBonus: 12,
    powerScale: 1,
  },
  board: {
    id: 'board',
    name: 'Board',
    extraFuel: 0,
    powerBonus: 0,
    powerScale: 0.9,
    rewardScale: 1.25,
    forcesFailureInjury: true,
  },
};

export function listCombatOrders({ tutorial = false } = {}) {
  const orders = Object.values(COMBAT_ORDERS);
  return tutorial ? orders.filter((order) => order.id === 'brace') : orders;
}

export function previewCombatOrder({
  playerPower,
  enemyPower,
  orderId,
  fuel = 0,
  tutorial = false,
} = {}) {
  const order = COMBAT_ORDERS[orderId];
  if (!order) return { orderId, enabled: false, reason: 'unknown_order' };
  const effectivePower = Math.floor((Number(playerPower) || 0) * order.powerScale) + order.powerBonus;
  const enabled = fuel >= order.extraFuel && (!tutorial || order.id === 'brace');
  return {
    ...order,
    orderId: order.id,
    effectivePower,
    chance: tutorial ? 1 : combatWinChance(effectivePower, enemyPower),
    enabled,
    fuel: order.extraFuel,
    rewardScale: order.rewardScale || 1,
  };
}

export function resolveCombatOrder({
  playerPower,
  enemyPower,
  orderId,
  encounter = null,
  rng = Math.random,
  fuel = 0,
  tutorialGuaranteed = false,
} = {}) {
  const preview = previewCombatOrder({
    playerPower,
    enemyPower,
    orderId,
    fuel,
    tutorial: tutorialGuaranteed,
  });
  if (!preview.enabled) return { ...preview, success: false, rewards: { credits: 0, medals: 0, reputation: 0 } };

  const result = resolveCombat({
    playerPower: preview.effectivePower,
    enemyPower,
    encounter,
    rng,
    tutorialGuaranteed,
  });
  if (result.success && preview.rewardScale !== 1) {
    result.rewards = {
      ...result.rewards,
      credits: Math.floor((result.rewards.credits || 0) * preview.rewardScale),
      medals: Math.floor((result.rewards.medals || 0) * preview.rewardScale),
    };
  }
  return {
    ...result,
    orderId,
    extraFuel: preview.extraFuel,
    effectivePower: preview.effectivePower,
    preventsInjury: Boolean(preview.preventsInjury),
    failureHullScale: preview.failureHullScale,
    forcesFailureInjury: Boolean(preview.forcesFailureInjury),
    rewardScale: preview.rewardScale,
  };
}

export function crewPower(crewList = []) {
  return (crewList || []).reduce((s, c) => s + (c.power || 10), 0);
}

export function resolveCombat({
  playerPower,
  enemyPower,
  assistsUsed = [],
  rng = Math.random,
  tutorialGuaranteed = false,
  assistMult = 1,
  encounter = null,
}) {
  const rawAssist = assistsUsed.reduce((s, id) => s + (ASSISTS[id]?.power || 0), 0);
  const assistPower = Math.round(rawAssist * (assistMult || 1));
  const total = playerPower + assistPower;
  if (tutorialGuaranteed) {
    return {
      success: true,
      playerPower: total,
      enemyPower,
      chance: 1,
      rewards: { credits: 120, medals: 8, reputation: 4 },
      log: encounter?.win || 'First contact. The scout wing breaks off.',
      tutorial: true,
    };
  }
  const chance = combatWinChance(total, enemyPower);
  const success = rng() < chance;
  const base = encounter?.rewards || {
    credits: Math.floor(40 + enemyPower * 0.8),
    medals: Math.floor(4 + enemyPower * 0.15),
    reputation: 3,
  };
  const rewards = success
    ? { ...base }
    : {
        credits: Math.max(8, Math.floor((base.credits || 0) * 0.22)),
        medals: Math.max(1, Math.floor((base.medals || 0) * 0.25)),
        reputation: 0,
      };
  return {
    success,
    playerPower: total,
    enemyPower,
    chance,
    rewards,
    log: success
      ? (encounter?.win || `Victory. Assists contributed +${assistPower} power.`)
      : (encounter?.fail || 'Defeat. Hull holds; crew shaken. Scrap recovered.'),
  };
}

export const ENCOUNTERS_V1 = [
  {
    id: 'pirate_scout',
    name: 'Pirate Scout',
    power: 12,
    rewards: { credits: 40, medals: 2, reputation: 1 },
    blurb: 'A light cutter tagging freighters.',
    win: 'The scout wing breaks off. You strip the pod.',
    fail: 'They rake the hull and vanish into dust.',
  },
  {
    id: 'pirate_wing',
    name: 'Pirate Wing',
    power: 22,
    rewards: { credits: 80, medals: 5, reputation: 2 },
    blurb: 'Three cutters flying a ragged V.',
    win: 'The wing scatters. You keep one engine and the pay chest.',
    fail: 'They punch a hole in cargo and run.',
  },
  {
    id: 'scrapper_gang',
    name: 'Scrapper Gang',
    power: 18,
    rewards: { credits: 70, medals: 6, reputation: 1 },
    blurb: 'Yard dogs with cutting torches.',
    win: 'You outbid them with guns. Their salvage is yours.',
    fail: 'They torch a panel and take the easy metal.',
  },
  {
    id: 'swarm_probe',
    name: 'Eclipse Probe',
    power: 20,
    rewards: { credits: 60, medals: 6, reputation: 3 },
    blurb: 'A black-shelled mapper. It already knows your name.',
    win: 'The probe cracks. A nav-crystal ticks in the husk.',
    fail: 'It tags your hull and slips into the dark.',
  },
  {
    id: 'swarm_skirmish',
    name: 'Swarm Skirmish',
    power: 32,
    rewards: { credits: 120, medals: 10, reputation: 5 },
    blurb: 'A hunting pack. Do not let them surround you.',
    win: 'The pack peels. Chitin and medals in the wake.',
    fail: 'They score the shields and leave a mark.',
  },
  {
    id: 'swarm_frigate',
    name: 'Swarm Frigate Echo',
    power: 48,
    rewards: { credits: 200, medals: 18, reputation: 8 },
    blurb: 'A silhouette larger than a station, half-remembered.',
    win: 'The echo breaks. You bag a core fragment.',
    fail: 'The shadow passes. Hull sings with stress.',
  },
  {
    id: 'pirate_ace',
    name: 'Corsair Ace',
    power: 28,
    rewards: { credits: 110, medals: 9, reputation: 3 },
    blurb: 'One pilot, one painted hull, no manners.',
    win: 'The ace ejects. You keep the painted fin.',
    fail: 'A perfect rake. You limp home with scrap.',
  },
  {
    id: 'ice_raiders',
    name: 'Ice Raiders',
    power: 26,
    rewards: { credits: 100, medals: 8, reputation: 3 },
    blurb: 'Glass-spur corsairs in white hulls.',
    win: 'You crack their ice-lock. Convoy pay inside.',
    fail: 'They steal a pallet and vanish into glare.',
  },
  {
    id: 'swarm_brood',
    name: 'Swarm Brood',
    power: 40,
    rewards: { credits: 160, medals: 14, reputation: 7 },
    blurb: 'A living cloud of half-grown probes.',
    win: 'The brood burns. Cores tick in the ash.',
    fail: 'They cling. You scrape them off with hull.',
  },
  {
    id: 'veil_wraith',
    name: 'Veil Wraith',
    power: 44,
    rewards: { credits: 180, medals: 16, reputation: 8 },
    blurb: 'Something that only moves when you look away.',
    win: 'The wraith unravels. Cold medals in the dust.',
    fail: 'It brands the hull and is gone.',
  },
  {
    id: 'corsair_king',
    name: 'Corsair King',
    power: 36,
    rewards: { credits: 150, medals: 12, reputation: 5 },
    blurb: 'The nest’s old captain, still armed.',
    win: 'The king yields a crate and a grudging salute.',
    fail: 'He rakes engineering and laughs on comms.',
  },
  {
    id: 'eclipse_echo',
    name: 'Eclipse Echo',
    power: 56,
    rewards: { credits: 240, medals: 22, reputation: 10 },
    blurb: 'A war-form the Spur was never meant to see.',
    win: 'The echo folds. A gem-bright core in the wrecklight.',
    fail: 'It does not chase. That is worse.',
  },
  {
    id: 'ember_raider',
    name: 'Ember Raider',
    power: 38,
    rewards: { credits: 170, medals: 14, reputation: 6 },
    blurb: 'Heat-shield paint. They board while the hull is still glowing.',
    win: 'The raider peels. Slag-scored plate and a pay chest.',
    fail: 'They weld a hole in cargo and laugh in the heat.',
  },
  {
    id: 'hollow_shade',
    name: 'Hollow Shade',
    power: 52,
    rewards: { credits: 220, medals: 20, reputation: 10 },
    blurb: 'It only exists in peripheral vision. Do not look away on purpose.',
    win: 'The shade unthreads. Cold medals where a body should be.',
    fail: 'It writes a name on the hull. Yours, misspelled.',
  },
  {
    id: 'crown_warden',
    name: 'Crown Warden',
    power: 64,
    rewards: { credits: 280, medals: 24, reputation: 12 },
    blurb: 'Gold customs with real guns. Reputation is a boarding pass.',
    win: 'The warden salutes and drops a gilt crate. You lived through manners.',
    fail: 'A verdict round kisses the engines. You limp, fined in hull.',
  },
  {
    id: 'eclipse_throne',
    name: 'Eclipse Throne',
    power: 84,
    rewards: { credits: 420, medals: 36, reputation: 18, gems: 8 },
    blurb: 'The Swarm wearing a halo. End of the mapped war.',
    win: 'The throne cracks. A core ticks like a second heart.',
    fail: 'It does not kill you. It files you. You leave marked.',
  },
];

export function combatWinChance(playerPower, enemyPower) {
  const ratio = (Number(playerPower) || 0) / Math.max(1, Number(enemyPower) || 1);
  // Even fight ~58%. 1.5× ~82%. 0.5× ~34%. Always a sliver of swing.
  return Math.max(0.1, Math.min(0.94, 0.58 + (ratio - 1) * 0.48));
}

export function rubberBandPower(base, playerPower) {
  const b = Math.max(1, Number(base) || 1);
  const p = Math.max(1, Number(playerPower) || 1);
  if (p <= b) return b;
  // Pull listed fights toward the squad so late jumps aren't free wins.
  return Math.round(b + (p - b) * 0.82);
}

export function encounterById(id) {
  return ENCOUNTERS_V1.find((e) => e.id === id) || ENCOUNTERS_V1[0];
}

export function listAssists({ tutorial = false } = {}) {
  const all = Object.values(ASSISTS);
  if (tutorial) return all.filter((a) => a.id === 'shield_boost');
  return all;
}
