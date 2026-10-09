// @ts-nocheck
/**
 * Crew families (crew-matter design §6; universe proposal docs/design/22-universe-proposal.md).
 * The roster's 23 faction tags fold into eight families. Two of a family in the fighting crew give
 * a small bonus, four give a big one. Captains are freelance and belong to none.
 */
import { catalogById } from './crewRoster.js';

export const FAMILIES = Object.freeze({
  haulers: Object.freeze({ id: 'haulers', name: "Haulers' Union", tags: ['haulers', 'convoy', 'market'],
    bonus: ['+10% fight salvage', '+25% fight salvage'] }),
  yards: Object.freeze({ id: 'yards', name: 'The Yards', tags: ['yard', 'forge'],
    bonus: ['+15% repair speed', '+30% repair speed, moves start 75% charged'] }),
  wings: Object.freeze({ id: 'wings', name: 'Free Wings', tags: ['privateers', 'cartel'],
    bonus: ['+3% crit', '+6% crit, crits start fires'] }),
  navy: Object.freeze({ id: 'navy', name: 'Remnant Navy', tags: ['navy', 'station'],
    bonus: ['+10% shield recharge', '+25% shield recharge'] }),
  haven: Object.freeze({ id: 'haven', name: 'Haven', tags: ['clinic', 'colony', 'haven'],
    bonus: ['moves charge 10% faster', 'moves charge 20% faster'] }),
  survey: Object.freeze({ id: 'survey', name: 'The Survey', tags: ['survey'],
    bonus: ['enemy dodge -5', 'enemy dodge -10'] }),
  choirs: Object.freeze({ id: 'choirs', name: 'The Choirs', tags: ['crystal', 'tidefall', 'cloud', 'rings', 'gas-giant', 'storm-kin'],
    bonus: ['enemy shields recharge 10% slower', 'enemy shields recharge 25% slower'] }),
  unbound: Object.freeze({ id: 'unbound', name: 'The Unbound', tags: ['defector', 'void', 'prototype', 'silicate', 'hollow', 'void-knights'],
    bonus: ['moves start 65% charged', 'moves start fully charged'] }),
});

const BY_TAG = Object.fromEntries(Object.values(FAMILIES).flatMap(f => f.tags.map(tag => [tag, f.id])));

/** A merc's family id from their template's faction tag (null for freelancers and unknown tags). */
export const familyOf = templateId => BY_TAG[catalogById(templateId)?.faction] || null;

/** Family counts among template ids, e.g. { yards: 2, wings: 1 }. */
export function familyCounts(templateIds = []) {
  const counts = {};
  for (const id of templateIds) {
    const family = familyOf(id);
    if (family) counts[family] = (counts[family] || 0) + 1;
  }
  return counts;
}

/** Bonus tier per family: 1 with two aboard, 2 with four. */
export function familyTiers(templateIds = []) {
  return Object.fromEntries(Object.entries(familyCounts(templateIds))
    .map(([id, n]) => [id, n >= 4 ? 2 : n >= 2 ? 1 : 0]).filter(([, tier]) => tier > 0));
}
