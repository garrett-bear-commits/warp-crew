// @ts-nocheck
/**
 * "Between Jobs": the featured hire, rotating every 14 game days (crew-matter design, section 7).
 * Every hire goes through the current banner. When a hire lands on the featured merc's rarity it is
 * the featured merc half the time; a miss makes the next one at that rarity a sure thing. Hires at
 * Rare land on one of the two rate-up Rares half the time. Contract Marks (one per hire) buy the
 * featured merc outright; leftover marks carry to the next banner.
 *
 * The rotation reruns forever, so no merc is ever permanently out of reach (fairness rule).
 */
import { trustedNow, localDayKey } from '../shared/time.js';

/** Day 0 of the rotation, a local calendar date. */
export const BANNER_EPOCH = '2026-10-05';
export const BANNER_DAYS = 14;

/** Marks to hire the featured merc outright, by its rarity. */
export const MARK_COST = Object.freeze({ legendary: 200, epic: 80 });

export const FEATURED_ROTATION = Object.freeze([
  { id: 'onyx', featured: 'merc_onyx', rateUp: ['merc_hex', 'merc_vex'], pitch: 'The admiral is between wars. Briefly.' },
  { id: 'zephyr', featured: 'merc_zephyr', rateUp: ['merc_drift', 'merc_kal'], pitch: 'A storm-kin pilot is laughing at your fuel gauge.' },
  { id: 'skarn', featured: 'merc_skarn', rateUp: ['merc_vorn', 'merc_quill'], pitch: 'A living blade wants a ship with good grain.' },
  { id: 'solace', featured: 'merc_solace', rateUp: ['merc_isa', 'merc_moth'], pitch: "The medic other medics call is taking calls." },
  { id: 'prism', featured: 'merc_prism', rateUp: ['merc_reed', 'merc_hex'], pitch: 'A ship-soul prototype is looking for a hull.' },
  { id: 'wisp', featured: 'merc_wisp', rateUp: ['merc_quill', 'merc_drift'], pitch: 'Something nearly invisible already signed. Probably.' },
  { id: 'harrow', featured: 'merc_harrow', rateUp: ['merc_kal', 'merc_vorn'], pitch: 'The Scar ace is back in the Spur.' },
  { id: 'ada', featured: 'merc_ada', rateUp: ['merc_isa', 'merc_vex'], pitch: 'An empathy core with combat drugs is between clinics.' },
].map(b => Object.freeze({ ...b, rateUp: Object.freeze(b.rateUp) })));

const dayNumber = key => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** The banner live on this game day, its index in the rotation and days left (including today). */
export function currentBanner(now = trustedNow()) {
  const days = dayNumber(localDayKey(now)) - dayNumber(BANNER_EPOCH);
  const slot = Math.floor(days / BANNER_DAYS);
  const index = ((slot % FEATURED_ROTATION.length) + FEATURED_ROTATION.length) % FEATURED_ROTATION.length;
  const daysLeft = BANNER_DAYS - (((days % BANNER_DAYS) + BANNER_DAYS) % BANNER_DAYS);
  return { ...FEATURED_ROTATION[index], index, slot, daysLeft };
}
