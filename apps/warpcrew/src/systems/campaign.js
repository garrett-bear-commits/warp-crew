// @ts-nocheck
/**
 * Campaign rules (Phase 3 design §2, docs/superpowers/specs/2026-10-10-world-design.md). Content is in
 * src/data/campaign.js.
 *
 * - The next story mission opens once the previous one is won and one ordinary contract has been claimed since.
 * - Each chapter's first mission is open as soon as the chapter is.
 * - A chapter's boss is its Siege wall, which appears only once the chapter's five missions are won.
 * - When the boss falls (or, for captains without walls, when the next gate opens), the chapter is complete: the
 *   gate opens and a named merc joins.
 *
 * Saved state: `campaign = { done: [missionIds], since, chapters: [completed chapter numbers] }`. The transmissions
 * a captain has been shown are in `almanac.seen`.
 */
import { CHAPTERS, MISSIONS, TRANSMISSIONS } from '../data/campaign.js';
import { NODES } from '../data/sectors.js';
import { createCrewInstance, catalogById } from '../data/crewRoster.js';
import { trustedNow } from '../shared/time.js';
import { grant } from './economy.js';
import { applyStoryFlag, storyProgress } from './story.js';
import { applyPullToRoster, recordPull, defaultGacha, hireSeed, hireRng } from './gacha.js';
import { wallsApply, wallBeaten } from './walls.js';
import { isTransmissionId } from './transmissions.js';

const MISSION_IDS = Object.keys(MISSIONS);
const SINCE_MAX = 999;
const SEEN_MAX = 400;

/** Which role each set piece favours on the card (the story twist, else the enemy). */
const FAVORED = Object.freeze({
  escort: { kind: 'role', id: 'engineer', label: 'Engineer', why: 'An engineer keeps two ships flying.' },
  bounty: { kind: 'role', id: 'gunner', label: 'Gunner', why: 'A gunner finishes an elite before it settles in.' },
  waves: { kind: 'role', id: 'engineer', label: 'Engineer', why: 'Repairs between waves win the second one.' },
  holdout: { kind: 'role', id: 'security', label: 'Security', why: 'Security keeps the ship whole until the clock runs out.' },
  rush: { kind: 'role', id: 'gunner', label: 'Gunner', why: 'A gunner beats the clock.' },
  cloak: { kind: 'role', id: 'scout', label: 'Scout', why: 'A scout reads a cloaked wake.' },
  plain: { kind: 'role', id: 'gunner', label: 'Gunner', why: 'A gunner keeps pressure on the target.' },
});

export function defaultCampaign() {
  return { done: [], since: 0, chapters: [] };
}

/** A clean saved campaign: known missions once each, in campaign order; a bounded counter; known chapters. */
export function normalizeCampaign(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultCampaign();
  const done = Array.isArray(saved.done) ? MISSION_IDS.filter(id => saved.done.includes(id)) : [];
  const since = Number.isInteger(saved.since) ? Math.max(0, Math.min(SINCE_MAX, saved.since)) : 0;
  const chapters = Array.isArray(saved.chapters) ? CHAPTERS.map(ch => ch.n).filter(n => saved.chapters.includes(n)) : [];
  return { done, since, chapters };
}

/** The validator's rule (client and server mirror this). */
export function validCampaign(saved) {
  if (saved === undefined) return true;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  return Array.isArray(saved.done) && saved.done.length <= MISSION_IDS.length && saved.done.every(id => MISSION_IDS.includes(id))
    && new Set(saved.done).size === saved.done.length
    && Number.isInteger(saved.since) && saved.since >= 0 && saved.since <= SINCE_MAX
    && (saved.chapters === undefined || (Array.isArray(saved.chapters) && saved.chapters.every(n => CHAPTERS.some(ch => ch.n === n))
      && new Set(saved.chapters).size === saved.chapters.length));
}

/** Transmission ids the captain has been shown (played or queued). */
export function seenTransmissions(player) {
  const seen = player?.almanac?.seen;
  return Array.isArray(seen) ? seen.filter(isTransmissionId) : [];
}

/** Record transmissions as shown, once each (the Almanac replays them). */
export function markSeen(player, ids) {
  const fresh = ids.filter(isTransmissionId);
  if (!fresh.length) return player;
  const seen = [...new Set([...seenTransmissions(player), ...fresh])].slice(-SEEN_MAX);
  return { ...player, almanac: { ...(player.almanac || {}), seen } };
}

const campaignOf = player => normalizeCampaign(player?.campaign);
const chapterByN = n => CHAPTERS.find(ch => ch.n === n) || null;
export const chapterOfMission = id => chapterByN(MISSIONS[id]?.chapter);
export const chapterOfWall = wallId => CHAPTERS.find(ch => ch.wall === wallId) || null;

/** The campaign is for captains past the tutorial. */
function campaignOpen(player) {
  return Boolean(player?.tutorial?.completed || player?.tutorial?.dismissed);
}

function sectorOpen(player, sector) {
  if (!sector) return true;
  const story = storyProgress(player);
  return Boolean({ veil: story.veilUnlocked, ember: story.emberUnlocked, hollow: story.hollowUnlocked, crown: story.crownUnlocked }[sector]);
}

/** Are all of this chapter's missions won? */
export function chapterMissionsDone(player, chapter) {
  const { done } = campaignOf(player);
  return chapter.missions.every(id => done.includes(id));
}

/** Missions won and boss down (for captains without walls: the next gate open). */
export function chapterComplete(player, chapter) {
  if (!chapterMissionsDone(player, chapter)) return false;
  return wallsApply(player) ? wallBeaten(player, chapter.wall) : Boolean(player?.flags?.[chapter.gateFlag]);
}

/** A Siege wall that is a chapter boss waits for the chapter's missions; later walls are unchanged. */
export function campaignAllowsWall(player, wall) {
  const chapter = chapterOfWall(wall?.id);
  return !chapter || chapterMissionsDone(player, chapter);
}

/**
 * Where the captain is in the campaign: the current chapter, the next mission and why it waits.
 * `waiting`: 'contract' (one ordinary contract first), 'sector' (the chapter's sector is shut), 'boss' (missions
 * done, the wall stands) or null.
 */
export function campaignState(player) {
  const camp = campaignOf(player);
  const total = MISSION_IDS.length;
  if (!campaignOpen(player)) return { open: false, chapter: CHAPTERS[0], missionId: null, waiting: null, done: 0, total, complete: false };
  const chapter = CHAPTERS.find(ch => !chapterComplete(player, ch)) || null;
  if (!chapter) return { open: true, chapter: null, missionId: null, waiting: null, done: camp.done.length, total, complete: true };
  const next = chapter.missions.find(id => !camp.done.includes(id)) || null;
  let waiting = null;
  if (!next) waiting = 'boss';
  else if (!sectorOpen(player, chapter.needs)) waiting = 'sector';
  else if (chapter.missions.indexOf(next) > 0 && camp.since < 1) waiting = 'contract';
  return { open: true, chapter, missionId: waiting ? null : next, upcoming: next, waiting, done: camp.done.length, total, complete: false };
}

const attemptsAt = (player, missionId) => (player?.contractBoard?.completedOfferIds || [])
  .filter(id => String(id).startsWith(`offer_story_${missionId}_`)).length;

/** The story card for a mission (a risky-profile contract: every story mission fights). */
export function storyOffer(player, missionId) {
  const mission = MISSIONS[missionId];
  const node = NODES[mission?.destinationId];
  if (!mission || !node) return null;
  const id = `offer_story_${missionId}_${attemptsAt(player, missionId) + 1}`;
  const outcome = { kind: 'combat', encounter: mission.encounterId };
  const favored = FAVORED[mission.twist?.id] || (['veil_wraith', 'hollow_shade', 'eclipse_echo'].includes(mission.encounterId) ? FAVORED.cloak : FAVORED.plain);
  return {
    id,
    profile: 'risky',
    story: { id: missionId, chapter: mission.chapter },
    icon: 'contract_story',
    title: mission.title,
    brief: mission.brief,
    client: mission.client,
    destinationId: node.id,
    destinationName: node.name,
    normalFuel: 2,
    rewardFamily: 'credits, medals and gems',
    danger: mission.danger,
    favoredTrait: { ...favored },
    ...(mission.twist ? { twist: JSON.parse(JSON.stringify(mission.twist)) } : {}),
    storyRewards: { ...mission.rewards },
    routeContent: { routeOutcome: { ...outcome }, secureOutcome: { ...outcome }, encounterId: mission.encounterId, storyFlag: null,
      destinationId: node.id, routeSeed: hashSeed(`${id}:${node.id}:story`) },
    beats: 3,
    beatLabel: '3 beats',
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Keep the open story mission's card at the top of the board (and only that one). */
export function ensureStoryOffer(player, now = trustedNow()) {
  const board = player?.contractBoard;
  if (!board || player.activeContract) return player;
  const { missionId } = campaignState(player, now);
  const completed = new Set(board.completedOfferIds || []);
  const want = missionId ? storyOffer(player, missionId) : null;
  const kept = board.offers.filter(offer => !offer.story || (want && offer.id === want.id && !completed.has(offer.id)));
  const offers = want && !kept.some(offer => offer.id === want.id) ? [want, ...kept] : kept;
  if (offers.length === board.offers.length && offers.every((offer, i) => offer === board.offers[i])) return player;
  return { ...player, contractBoard: { ...board, offers } };
}

/** Transmissions to play when a story card (or a chapter boss's wall card) is first reviewed. */
export function reviewTransmissions(player, offer) {
  const seen = new Set(seenTransmissions(player));
  const ids = [];
  if (offer?.story) {
    const chapter = chapterOfMission(offer.story.id);
    if (chapter && chapter.missions[0] === offer.story.id && chapter.open) ids.push(chapter.open);
    ids.push(MISSIONS[offer.story.id]?.briefing);
  } else if (offer?.wall) {
    ids.push(chapterOfWall(offer.wall.id)?.bossIntro);
  }
  return ids.filter(id => id && !seen.has(id));
}

/**
 * After a contract claim: a won story mission pays its bonus, counts as done and plays its debrief; any other
 * claim counts towards the next mission. Returns the player, the bonus paid and the debrief to play.
 */
export function settleStoryClaim(player, contract) {
  const camp = campaignOf(player);
  const missionId = contract?.story?.id;
  // Only a story card's own contract counts as the mission (an edited contract cannot claim one).
  if (!missionId || !MISSIONS[missionId] || !String(contract.offerId || '').startsWith(`offer_story_${missionId}_`)) {
    return { player: { ...player, campaign: { ...camp, since: Math.min(SINCE_MAX, camp.since + 1) } }, bonus: null, transmissions: [] };
  }
  if (contract.result?.success === false || camp.done.includes(missionId)) return { player: { ...player, campaign: camp }, bonus: null, transmissions: [] };
  const mission = MISSIONS[missionId];
  const next = { ...player, wallet: grant(player.wallet, mission.rewards), campaign: { ...camp, done: MISSION_IDS.filter(id => [...camp.done, missionId].includes(id)), since: 0 } };
  return { player: next, bonus: { ...mission.rewards }, transmissions: [mission.debrief] };
}

/**
 * Chapters that are complete but not yet rewarded: open the next gate, the named merc joins, and the finale plays
 * (with the next chapter's opening or the teaser). Idempotent: `campaign.chapters` records each one.
 */
export function settleChapters(player, now = trustedNow()) {
  let next = player;
  const transmissions = [];
  const recruits = [];
  for (const chapter of CHAPTERS) {
    const camp = campaignOf(next);
    if (camp.chapters.includes(chapter.n) || !campaignOpen(next) || !chapterComplete(next, chapter)) continue;
    if (chapter.gateFlag && !next.flags?.[chapter.gateFlag]) next = applyStoryFlag(next, chapter.gateFlag).player;
    const template = catalogById(chapter.recruit);
    if (template) {
      // Seeded from the save, so a replay (or the sim) names the same crew member.
      const applied = applyPullToRoster(next, createCrewInstance(template.id, { rng: hireRng(hireSeed(next), `story:${chapter.n}`) }));
      next = { ...applied.player, gacha: recordPull({ ...defaultGacha(), ...(applied.player.gacha || {}) }, applied.instance, applied.kind, 'story') };
      recruits.push({ templateId: template.id, name: template.name, rarity: template.rarity, kind: applied.kind, instanceId: applied.instance.instanceId });
    }
    next = { ...next, campaign: { ...campaignOf(next), chapters: [...campaignOf(next).chapters, chapter.n] } };
    transmissions.push(chapter.bossFall);
    const following = chapterByN(chapter.n + 1);
    transmissions.push(following ? following.open : chapter.next);
  }
  if (!transmissions.length) return { player, transmissions, recruits };
  return { player: next, transmissions: transmissions.filter(Boolean), recruits, now };
}

/** A transmission ready to show: speakers resolved by the UI; this is the data. */
export { transmissionById } from './transmissions.js';

/** The Log and the Almanac: chapters with their missions and what is done. */
export function campaignLog(player) {
  const camp = campaignOf(player);
  const state = campaignState(player);
  return CHAPTERS.map(chapter => ({
    n: chapter.n, title: chapter.title,
    complete: camp.chapters.includes(chapter.n),
    current: state.chapter?.n === chapter.n,
    missions: chapter.missions.map(id => ({ id, title: MISSIONS[id].title, done: camp.done.includes(id) })),
  }));
}
