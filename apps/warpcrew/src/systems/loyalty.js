// @ts-nocheck
/**
 * Loyalty (Phase 3 design §5, docs/superpowers/specs/2026-10-10-world-design.md). Each merc earns loyalty by flying:
 * +1 for each contract claimed aboard (won or lost) and +1 for each away team, at most 2 a game day, so a merc who
 * flies every day reaches Trusted in about five days, Close in two weeks and their loyalty job in about three. At Trusted and Close a bond scene opens
 * (the notice strip plays it); at the mission threshold their personal loyalty mission joins the board; winning it
 * makes them Loyal: their role passive counts a quarter more and they fight a little sharper. Captains have none.
 *
 * Saved: `loyalty = { points: { [templateId]: 0..60 }, loyal: [templateIds], day, today: { [templateId]: gained } }`, by
 * template so it survives the reserve; `today` is what each merc has earned on game day `day`.
 * Scenes seen are in `almanac.seen` (ids bond_<templateId>_1 / _2, loyal_<templateId>_brief / _debrief).
 */
import { BONDS } from '../data/bonds.js';
import { NODES } from '../data/sectors.js';
import { catalogById } from '../data/crewRoster.js';
import { encounterById } from './combat.js';
import { grant } from './economy.js';
import { storyProgress } from './story.js';
import { referencePower } from './encounterState.js';
import { ELITE_NAMES } from '../data/factions.js';
import { dayKey } from './daily.js';
export { bondTransmission } from './transmissions.js';

export const LOYALTY = Object.freeze({ trusted: 10, close: 25, mission: 40, max: 60, contract: 1, away: 1, dailyCap: 2 });
/** What a loyalty mission pays on a win, on top of the fight. */
export const LOYAL_REWARD = Object.freeze({ medals: 15, gems: 10 });
/** A Loyal merc's role passive counts this much more in fights, and their fight grade rises by LOYAL_GRADE. */
export const LOYAL_PASSIVE = 1.25;
export const LOYAL_GRADE = 0.05;

const ID = /^merc_[a-z0-9_]{1,34}$/;
/** The twist each role's personal job runs (the writing fits it). */
export const ROLE_TWIST = Object.freeze({ gunner: 'bounty', security: 'holdout', pilot: 'rush', scout: 'rush', engineer: 'waves', medic: 'escort', trader: 'escort' });
/** Encounters by enemy faction, weakest first (the fight engine's faction table has the same split). */
const FACTION_FIGHTS = Object.freeze({
  corsairs: ['pirate_scout', 'pirate_wing', 'pirate_ace', 'corsair_king'],
  scrappers: ['scrapper_gang', 'ember_raider'],
  swarm: ['swarm_probe', 'swarm_skirmish', 'swarm_brood', 'swarm_frigate'],
  ice: ['ice_raiders'],
  shades: ['veil_wraith', 'hollow_shade'],
  wardens: ['crown_warden'],
  eclipse: ['eclipse_echo'],
});
const ELITE_MODIFIER = { corsairs: 'veteran', scrappers: 'heavy', swarm: 'heavy', ice: 'armored', shades: 'overclocked', wardens: 'armored', eclipse: 'overclocked' };

export const hasBond = templateId => Object.hasOwn(BONDS, templateId);

export function defaultLoyalty() {
  return { points: {}, loyal: [] };
}

/** A clean saved record: known mercs, whole points 0-60, loyal mercs once each. */
export function normalizeLoyalty(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultLoyalty();
  const raw = saved.points && typeof saved.points === 'object' && !Array.isArray(saved.points) ? saved.points : {};
  const points = Object.fromEntries(Object.entries(raw).filter(([id, n]) => ID.test(id) && hasBond(id) && Number.isFinite(n))
    .map(([id, n]) => [id, Math.max(0, Math.min(LOYALTY.max, Math.trunc(n)))]));
  const loyal = Array.isArray(saved.loyal) ? [...new Set(saved.loyal.filter(id => typeof id === 'string' && hasBond(id)))] : [];
  const day = typeof saved.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.day) ? saved.day : null;
  const rawToday = day && saved.today && typeof saved.today === 'object' && !Array.isArray(saved.today) ? saved.today : {};
  const today = Object.fromEntries(Object.entries(rawToday).filter(([id, n]) => hasBond(id) && Number.isInteger(n) && n > 0)
    .map(([id, n]) => [id, Math.min(LOYALTY.dailyCap, n)]));
  return { points, loyal, ...(day ? { day, today } : {}) };
}

const recordOf = player => normalizeLoyalty(player?.loyalty);
export const loyaltyPoints = (player, templateId) => recordOf(player).points[templateId] || 0;
export const isLoyal = (player, templateId) => recordOf(player).loyal.includes(templateId);

/** Trusted, Close, Ready (mission open) or Loyal, with the next threshold. */
export function loyaltyLevel(player, templateId) {
  const points = loyaltyPoints(player, templateId);
  if (isLoyal(player, templateId)) return { id: 'loyal', label: 'Loyal', points, next: null };
  if (points >= LOYALTY.mission) return { id: 'ready', label: 'Ready to ask', points, next: null };
  if (points >= LOYALTY.close) return { id: 'close', label: 'Close', points, next: LOYALTY.mission };
  if (points >= LOYALTY.trusted) return { id: 'trusted', label: 'Trusted', points, next: LOYALTY.close };
  return { id: 'new', label: 'New aboard', points, next: LOYALTY.trusted };
}

/** The scenes a merc's loyalty has opened so far. */
export function openedScenes(player, templateId) {
  if (!hasBond(templateId)) return [];
  const points = loyaltyPoints(player, templateId);
  const ids = [];
  if (points >= LOYALTY.trusted) ids.push(`bond_${templateId}_1`);
  if (points >= LOYALTY.close) ids.push(`bond_${templateId}_2`);
  if (points >= LOYALTY.mission) ids.push(`loyal_${templateId}_brief`);
  if (isLoyal(player, templateId)) ids.push(`loyal_${templateId}_debrief`);
  return ids;
}

/** Bond scenes opened but not yet played, for crew still aboard or in reserve (the notice strip plays them). */
export function pendingScenes(player) {
  const seen = new Set(Array.isArray(player?.almanac?.seen) ? player.almanac.seen : []);
  const owned = new Set([...(player?.crew || []), ...(player?.reserve || [])].filter(m => !m.isCaptain).map(m => m.templateId));
  return [...owned].flatMap(id => openedScenes(player, id).filter(tx => tx.startsWith('bond_') && !seen.has(tx)));
}

/**
 * Add loyalty to these mercs (captains and unknown templates are skipped). With `now`, the daily cap applies (what
 * play earns); without it, the amount is granted whole. Returns the player and the scenes opened.
 */
export function addLoyalty(player, templateIds, amount, { now = null } = {}) {
  const record = recordOf(player);
  const points = { ...record.points };
  const day = now == null ? record.day : dayKey(now);
  const today = now != null && record.day === day ? { ...(record.today || {}) } : {};
  const opened = [];
  for (const id of new Set(templateIds)) {
    if (!hasBond(id)) continue;
    const gain = now == null ? amount : Math.max(0, Math.min(amount, LOYALTY.dailyCap - (today[id] || 0)));
    const before = points[id] || 0;
    const after = Math.min(LOYALTY.max, before + gain);
    if (after === before) continue;
    points[id] = after;
    if (now != null) today[id] = (today[id] || 0) + (after - before);
    for (const [mark, tx] of [[LOYALTY.trusted, `bond_${id}_1`], [LOYALTY.close, `bond_${id}_2`]]) if (before < mark && after >= mark) opened.push(tx);
  }
  const daily = now != null ? { day, today } : record.day ? { day: record.day, today: record.today || {} } : {};
  return { player: { ...player, loyalty: { points, loyal: record.loyal, ...daily } }, opened };
}

/** The mercs who flew a contract: crew aboard (not away, not the captain). */
export const contractFlyers = player => (player?.crew || [])
  .filter(member => !member.isCaptain && member.instanceId !== player.captainInstanceId && member.status !== 'expedition')
  .map(member => member.templateId);

/** The merc whose loyalty card is on offer: the most loyal merc aboard who is ready and not yet Loyal. */
export function loyaltyCandidate(player) {
  const record = recordOf(player);
  const aboard = [...(player?.crew || []), ...(player?.reserve || [])].filter(m => !m.isCaptain).map(m => m.templateId);
  return [...new Set(aboard)].filter(id => hasBond(id) && (record.points[id] || 0) >= LOYALTY.mission && !record.loyal.includes(id))
    .sort((a, b) => (record.points[b] || 0) - (record.points[a] || 0) || a.localeCompare(b))[0] || null;
}

function sectorOpen(player, sector) {
  if (sector === 'spur') return true;
  const story = storyProgress(player);
  return Boolean({ veil: story.veilUnlocked, ember: story.emberUnlocked, hollow: story.hollowUnlocked, crown: story.crownUnlocked }[sector]);
}

/** The fight for a loyalty job: the faction's toughest ship below this point in the game's reference crew. */
function loyaltyEncounter(player, faction) {
  const list = FACTION_FIGHTS[faction] || FACTION_FIGHTS.corsairs;
  const cap = referencePower(player) * 0.8;
  return [...list].reverse().find(id => encounterById(id).power <= cap) || list[0];
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The loyalty card for a merc: a fight at their place, the twist their role fits. */
export function loyaltyOffer(player, templateId) {
  const bond = BONDS[templateId];
  const merc = catalogById(templateId);
  if (!bond || !merc) return null;
  const node = NODES[bond.mission.destinationId] && sectorOpen(player, NODES[bond.mission.destinationId].sector)
    ? NODES[bond.mission.destinationId] : NODES.danger_belt;
  const attempt = (player?.contractBoard?.completedOfferIds || []).filter(id => String(id).startsWith(`offer_loyal_${templateId}_`)).length + 1;
  const id = `offer_loyal_${templateId}_${attempt}`;
  const encounterId = loyaltyEncounter(player, bond.mission.enemy);
  const twistId = ROLE_TWIST[merc.role] || 'rush';
  const names = ELITE_NAMES[bond.mission.enemy] || ELITE_NAMES.corsairs;
  const twist = twistId === 'bounty' ? { id: 'bounty', elite: { name: names[hashSeed(templateId) % names.length], modifier: ELITE_MODIFIER[bond.mission.enemy] || 'veteran' } } : { id: twistId };
  const outcome = { kind: 'combat', encounter: encounterId };
  return {
    id,
    profile: 'risky',
    loyalty: { templateId },
    icon: 'contract_loyalty',
    title: bond.mission.title,
    brief: bond.mission.brief,
    client: templateId,
    destinationId: node.id,
    destinationName: node.name,
    normalFuel: 2,
    rewardFamily: 'credits, medals and gems',
    danger: 'Guarded',
    favoredTrait: { kind: 'role', id: merc.role, label: merc.name, why: `${merc.name} asked for this one. Bring them.` },
    twist,
    storyRewards: { ...LOYAL_REWARD },
    routeContent: { routeOutcome: { ...outcome }, secureOutcome: { ...outcome }, encounterId, storyFlag: null,
      destinationId: node.id, routeSeed: hashSeed(`${id}:${node.id}:loyal`) },
    beats: 3,
    beatLabel: '3 beats',
  };
}

/** Keep the ready merc's loyalty card on the board, below the story card. */
export function ensureLoyaltyOffer(player) {
  const board = player?.contractBoard;
  if (!board || player.activeContract || !(player.tutorial?.completed || player.tutorial?.dismissed)) return player;
  const candidate = loyaltyCandidate(player);
  const completed = new Set(board.completedOfferIds || []);
  const want = candidate ? loyaltyOffer(player, candidate) : null;
  const kept = board.offers.filter(offer => !offer.loyalty || (want && offer.id === want.id && !completed.has(offer.id)));
  if (want && !kept.some(offer => offer.id === want.id)) {
    const at = kept.findIndex(offer => !offer.story);
    kept.splice(at < 0 ? kept.length : at, 0, want);
  }
  if (kept.length === board.offers.length && kept.every((offer, i) => offer === board.offers[i])) return player;
  return { ...player, contractBoard: { ...board, offers: kept } };
}

/**
 * After a contract claim: everyone aboard earns loyalty; a won loyalty mission makes its merc Loyal, pays its bonus
 * and plays the debrief. Returns the player, scenes opened, the bonus and the transmissions to play now.
 */
export function settleLoyaltyClaim(player, contract, flyers, now = null) {
  let next = addLoyalty(player, flyers, LOYALTY.contract, { now });
  const templateId = contract?.loyalty?.templateId;
  const real = templateId && hasBond(templateId) && String(contract.offerId || '').startsWith(`offer_loyal_${templateId}_`);
  if (!real || contract.result?.success === false || isLoyal(next.player, templateId) || loyaltyPoints(next.player, templateId) < LOYALTY.mission) {
    return { player: next.player, opened: next.opened, bonus: null, transmissions: [] };
  }
  const record = recordOf(next.player);
  const loyal = { ...next.player, wallet: grant(next.player.wallet, LOYAL_REWARD), loyalty: { ...record, loyal: [...record.loyal, templateId] } };
  return { player: loyal, opened: next.opened, bonus: { ...LOYAL_REWARD }, transmissions: [`loyal_${templateId}_debrief`], loyalId: templateId };
}

/** A loyal merc's fight edge (encounterState fightingCrew reads it). */
export function loyalEdge(player, templateId) {
  return isLoyal(player, templateId) ? { passive: LOYAL_PASSIVE, grade: LOYAL_GRADE } : { passive: 1, grade: 0 };
}
