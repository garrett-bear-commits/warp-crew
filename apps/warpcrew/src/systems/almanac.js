// @ts-nocheck
/**
 * The Captain's Almanac (Phase 3 design §6): five sections that fill in as you play.
 * - Story: the campaign's transmissions, by chapter (replayable once seen).
 * - Crew files: every hireable merc (hired once: their file; never: a silhouette).
 * - Enemies: the seven factions and sixteen ships (met once: their trick, the counter and your record).
 * - Places: every beacon (visited: its notes).
 * - Discoveries: the strange signals found on the star map.
 *
 * Saved: `almanac = { seen: [transmission ids], crew: [templateIds ever aboard], enemies: { encounterId: [won, lost] } }`.
 * Places and discoveries are read from what the save already holds (stats.visits, flags).
 */
import { isTransmissionId, transmissionById } from './transmissions.js';
import { CHAPTERS, MISSIONS } from '../data/campaign.js';
import { CREW_CATALOG, STARTER_CAPTAINS } from '../data/crewRoster.js';
import { NODES, STORY_BEATS } from '../data/sectors.js';
import { FACTIONS, ENCOUNTER_FACTION } from '../data/factions.js';
import { ENCOUNTERS_V1 } from './combat.js';

export const ALMANAC_SEEN_MAX = 400;
const ID = /^[a-z0-9_]{1,40}$/;
const MERCS = CREW_CATALOG.filter(c => !STARTER_CAPTAINS.includes(c.id));
const MERC_IDS = new Set(MERCS.map(c => c.id));
const ENCOUNTER_IDS = new Set(ENCOUNTERS_V1.map(e => e.id));
const COUNT_MAX = 1_000_000;

/** A clean saved Almanac: known ids once each, whole records. */
export function normalizeAlmanac(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { seen: [] };
  const seen = Array.isArray(saved.seen) ? [...new Set(saved.seen.filter(isTransmissionId))].slice(-ALMANAC_SEEN_MAX) : [];
  const crew = Array.isArray(saved.crew) ? [...new Set(saved.crew.filter(id => MERC_IDS.has(id)))] : undefined;
  const raw = saved.enemies && typeof saved.enemies === 'object' && !Array.isArray(saved.enemies) ? saved.enemies : null;
  const enemies = raw ? Object.fromEntries(Object.entries(raw).filter(([id, wl]) => ENCOUNTER_IDS.has(id) && Array.isArray(wl) && wl.length === 2)
    .map(([id, wl]) => [id, wl.map(n => (Number.isInteger(n) ? Math.max(0, Math.min(COUNT_MAX, n)) : 0))])) : undefined;
  return { seen, ...(crew ? { crew } : {}), ...(enemies ? { enemies } : {}) };
}

/** The validator's rule (the server mirrors the shape, not the ids). */
export function validAlmanac(saved) {
  if (saved === undefined) return true;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  const idList = (list, max) => Array.isArray(list) && list.length <= max && list.every(id => typeof id === 'string' && ID.test(id)) && new Set(list).size === list.length;
  return (saved.seen === undefined || idList(saved.seen, ALMANAC_SEEN_MAX)) && (saved.crew === undefined || idList(saved.crew, 100));
}

const almanacOf = player => normalizeAlmanac(player?.almanac);

/** Remember every merc who has been aboard (crew or reserve), so a file stays open after they leave. */
export function noteCrew(player) {
  const book = almanacOf(player);
  const known = new Set(book.crew || []);
  const aboard = [...(player?.crew || []), ...(player?.reserve || [])].map(m => m?.templateId).filter(id => MERC_IDS.has(id) && !known.has(id));
  if (!aboard.length) return player;
  return { ...player, almanac: { ...(player.almanac || {}), seen: book.seen, crew: [...known, ...new Set(aboard)], ...(book.enemies ? { enemies: book.enemies } : {}) } };
}

/** Record a fight's end against an enemy ship. */
export function noteFight(player, encounterId, won) {
  if (!ENCOUNTER_IDS.has(encounterId)) return player;
  const book = almanacOf(player);
  const [w, l] = book.enemies?.[encounterId] || [0, 0];
  const enemies = { ...(book.enemies || {}), [encounterId]: won ? [Math.min(COUNT_MAX, w + 1), l] : [w, Math.min(COUNT_MAX, l + 1)] };
  return { ...player, almanac: { ...(player.almanac || {}), seen: book.seen, ...(book.crew ? { crew: book.crew } : {}), enemies } };
}

/** The campaign's transmissions in the order they play, with a title for each. */
export function storyEntries() {
  const out = [];
  for (const chapter of CHAPTERS) {
    out.push({ id: chapter.open, chapter: chapter.n, title: `Chapter ${chapter.n}: ${chapter.title}` });
    for (const missionId of chapter.missions) {
      const mission = MISSIONS[missionId];
      out.push({ id: mission.briefing, chapter: chapter.n, title: `${mission.title} · briefing` });
      out.push({ id: mission.debrief, chapter: chapter.n, title: `${mission.title} · debrief` });
    }
    out.push({ id: chapter.bossIntro, chapter: chapter.n, title: transmissionById(chapter.bossIntro).title });
    out.push({ id: chapter.bossFall, chapter: chapter.n, title: transmissionById(chapter.bossFall).title });
    if (chapter.next) out.push({ id: chapter.next, chapter: chapter.n, title: `Next: ${transmissionById(chapter.next).title}` });
  }
  return out;
}

/** Everything in the Almanac for this save: each section's entries and what is open. */
export function almanacModel(player) {
  const book = almanacOf(player);
  const seen = new Set(book.seen);
  const met = new Set([...(book.crew || []), ...[...(player?.crew || []), ...(player?.reserve || [])].map(m => m?.templateId)]);
  const visits = player?.stats?.visits || {};
  const flags = player?.flags || {};
  const story = storyEntries().map(entry => ({ ...entry, open: seen.has(entry.id) }));
  const crew = MERCS.map(merc => ({ id: merc.id, merc, open: met.has(merc.id) }));
  const ships = ENCOUNTERS_V1.map(encounter => {
    const record = book.enemies?.[encounter.id];
    return { id: encounter.id, encounter, faction: ENCOUNTER_FACTION[encounter.id], record: record || [0, 0], open: Boolean(record) };
  });
  const factions = Object.values(FACTIONS).map(faction => ({ id: faction.id, faction, open: ships.some(s => s.faction === faction.id && s.open),
    ships: ships.filter(s => s.faction === faction.id) }));
  const places = Object.values(NODES).map(node => ({ id: node.id, node, open: node.id === 'station_home' || (visits[node.id] || 0) > 0 || player?.location === node.id }));
  const discoveries = Object.entries(STORY_BEATS).map(([id, beat]) => ({ id, beat, open: flags[id] === true }));
  const sections = [
    { id: 'story', label: 'Story', entries: story },
    { id: 'crew', label: 'Crew files', entries: crew },
    { id: 'enemies', label: 'Enemies', entries: [...factions, ...ships], factions },
    { id: 'places', label: 'Places', entries: places },
    { id: 'discoveries', label: 'Discoveries', entries: discoveries },
  ].map(section => ({ ...section, open: section.entries.filter(e => e.open).length, total: section.entries.length }));
  const open = sections.reduce((n, s) => n + s.open, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return { sections, open, total, percent: Math.floor((open / total) * 100) };
}

/** How complete the Almanac is, in whole percent (the Archivist achievement reads it). */
export const almanacPercent = player => almanacModel(player).percent;
