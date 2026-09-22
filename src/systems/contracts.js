// @ts-nocheck
/** Deterministic, saved daily Contract Board. Route mutations belong elsewhere. */

import { visibleNodes, NODES } from '../data/sectors.js';
import { CONTRACT_PROFILES, combatWeight, qualifiesForProfile, storySalvageWeight } from '../data/contracts.js';
import { fuelCostFor } from './passives.js';

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
