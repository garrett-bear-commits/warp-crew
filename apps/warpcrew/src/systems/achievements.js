// @ts-nocheck
/**
 * Achievements (Phase 2 design §5, docs/superpowers/specs/2026-10-10-reward-feel-retention-design.md).
 *
 * Eleven lines in six tracks, three tiers each (33 to earn). Progress is read from the save as it is (stats, crew,
 * ship, walls), never from a separate counter, so a reload or a second device cannot double it; the save only keeps
 * how many tiers of each line were claimed. Rewards are medals and credits, with gems on tiers 2 and 3 (credits kept
 * small so Phase 2 stays under a third of a free captain's credits in the 30-day sim). All gems
 * together stay under ACHIEVEMENT_GEM_BUDGET: the core's rule for client-claimed rewards
 * (packages/contracts/src/achievements.ts), so these can move server-side at the cut-over.
 */
import { grant } from './economy.js';
import { listOwnedHulls } from './hangar.js';
import { WALLS } from './walls.js';
import { catalogById, RARITY, STARTER_CAPTAINS, CREW_CATALOG } from '../data/crewRoster.js';

export const ACHIEVEMENT_GEM_BUDGET = 1500;
export const ACHIEVEMENT_TRACKS = [
  { id: 'combat', label: 'Combat' }, { id: 'crew', label: 'Crew' }, { id: 'ship', label: 'Ship' },
  { id: 'explore', label: 'Explore' }, { id: 'walls', label: 'Walls' }, { id: 'collection', label: 'Collection' },
];

const allCrew = player => [...(player?.crew || []), ...(player?.reserve || [])].filter(member => member && typeof member === 'object');
const hires = player => new Set(allCrew(player).map(m => m.templateId).filter(id => id && !STARTER_CAPTAINS.includes(id)));
const rank = id => RARITY[catalogById(id)?.rarity]?.rank || 0;
const HIREABLE = CREW_CATALOG.filter(c => !STARTER_CAPTAINS.includes(c.id)).length;

/** Each line: what it counts (from the save), and three goals with their rewards. */
export const ACHIEVEMENTS = [
  { id: 'victor', track: 'combat', title: 'Victor', unit: 'fights won', read: p => p.stats?.combatsWon || 0,
    tiers: [[10, { credits: 20, medals: 10 }], [50, { credits: 90, medals: 30, gems: 25 }], [200, { credits: 300, medals: 80, gems: 75 }]] },
  { id: 'contractor', track: 'combat', title: 'Contractor', unit: 'contracts done', read: p => p.stats?.contractsCompleted || 0,
    tiers: [[20, { credits: 30, medals: 10 }], [100, { credits: 110, medals: 30, gems: 25 }], [300, { credits: 380, medals: 80, gems: 75 }]] },
  { id: 'recruiter', track: 'crew', title: 'Recruiter', unit: 'hires', read: p => p.gacha?.pulls || 0,
    tiers: [[10, { credits: 20, medals: 15 }], [50, { credits: 80, medals: 40, gems: 25 }], [150, { credits: 220, medals: 100, gems: 75 }]] },
  { id: 'mentor', track: 'crew', title: 'Mentor', unit: 'top crew level', read: p => Math.max(0, ...allCrew(p).map(m => m.level || 1)),
    tiers: [[10, { credits: 30, medals: 20 }], [20, { credits: 110, medals: 50, gems: 25 }], [30, { credits: 300, medals: 120, gems: 75 }]] },
  { id: 'shipwright', track: 'ship', title: 'Shipwright', unit: 'system levels',
    read: p => Object.values(p.ship?.systems || {}).reduce((sum, level) => sum + (Number(level) || 0), 0),
    tiers: [[10, { credits: 40, medals: 10 }], [25, { credits: 110, medals: 30, gems: 25 }], [50, { credits: 380, medals: 80, gems: 75 }]] },
  { id: 'fleet', track: 'ship', title: 'Fleet', unit: 'hulls owned', read: p => listOwnedHulls(p).length,
    tiers: [[2, { credits: 40, medals: 15 }], [4, { credits: 150, medals: 40, gems: 25 }], [6, { credits: 450, medals: 100, gems: 75 }]] },
  { id: 'wayfarer', track: 'explore', title: 'Wayfarer', unit: 'jumps', read: p => p.stats?.jumps || 0,
    tiers: [[25, { credits: 20, medals: 10 }], [100, { credits: 90, medals: 30, gems: 25 }], [300, { credits: 300, medals: 80, gems: 75 }]] },
  { id: 'away_teams', track: 'explore', title: 'Away teams', unit: 'expeditions', read: p => p.stats?.expeditions || 0,
    tiers: [[5, { credits: 20, medals: 10 }], [25, { credits: 90, medals: 30, gems: 25 }], [100, { credits: 300, medals: 80, gems: 75 }]] },
  { id: 'siege_breaker', track: 'walls', title: 'Siege breaker', unit: 'walls broken', read: p => WALLS.filter(w => p.flags?.[`wall_${w.id}`] === true).length,
    tiers: [[1, { credits: 60, medals: 30 }], [3, { credits: 220, medals: 80, gems: 50 }], [5, { credits: 600, medals: 150, gems: 100 }]] },
  { id: 'roster', track: 'collection', title: 'Roster', unit: 'mercs met', read: p => hires(p).size,
    tiers: [[10, { credits: 30, medals: 15 }], [25, { credits: 110, medals: 40, gems: 25 }], [HIREABLE, { credits: 450, medals: 120, gems: 100 }]] },
  { id: 'rare_finds', track: 'collection', title: 'Rare finds', unit: 'Epic or better', read: p => [...hires(p)].filter(id => rank(id) >= RARITY.epic.rank).length,
    tiers: [[1, { credits: 40, medals: 20 }], [5, { credits: 150, medals: 50, gems: 25 }], [15, { credits: 450, medals: 120, gems: 75 }]] },
].map(line => ({ ...line, tiers: line.tiers.map(([goal, reward]) => ({ goal, reward })) }));

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(line => [line.id, line]));

/** Tiers claimed per line, cleaned: unknown lines dropped, counts clamped to 0..3. */
export function normalizeAchievements(saved) {
  const out = {};
  for (const line of ACHIEVEMENTS) {
    const n = Math.floor(Number(saved?.[line.id]) || 0);
    if (n > 0) out[line.id] = Math.min(line.tiers.length, n);
  }
  return out;
}

/** Every line's state: progress, the next tier, and whether it can be claimed now. */
export function achievementProgress(player) {
  const claimed = normalizeAchievements(player?.achievements);
  return ACHIEVEMENTS.map(line => {
    const value = Math.max(0, Number(line.read(player)) || 0);
    const done = claimed[line.id] || 0;
    const next = line.tiers[done] || null;
    return { id: line.id, track: line.track, title: line.title, unit: line.unit, value, claimed: done, tiers: line.tiers.length,
      next, ready: Boolean(next && value >= next.goal) };
  });
}

/** How many tiers wait to be claimed (the dot on the Log tab). */
export function claimableAchievements(player) {
  return achievementProgress(player).filter(line => line.ready).length;
}

/** Claim a line's next tier: its reward goes into the wallet. */
export function claimAchievement(player, id) {
  const line = ACHIEVEMENT_BY_ID[id];
  if (!line) return { ok: false, reason: 'unknown_achievement' };
  const state = achievementProgress(player).find(entry => entry.id === id);
  if (!state.next) return { ok: false, reason: 'achievement_complete' };
  if (!state.ready) return { ok: false, reason: 'achievement_not_ready' };
  const achievements = { ...normalizeAchievements(player.achievements), [id]: state.claimed + 1 };
  return { ok: true, reward: { ...state.next.reward }, tier: state.claimed + 1, line,
    player: { ...player, wallet: grant(player.wallet, state.next.reward), achievements } };
}

/** All gems every tier pays together (the lifetime budget check). */
export function achievementGemTotal() {
  return ACHIEVEMENTS.reduce((sum, line) => sum + line.tiers.reduce((s, tier) => s + (tier.reward.gems || 0), 0), 0);
}
