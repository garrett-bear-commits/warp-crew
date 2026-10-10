// @ts-nocheck
/**
 * The Captain's Almanac's saved part (Phase 3 design §6): `almanac = { seen: [transmission ids] }`, growing in step 6
 * with the crew and enemy records. Places and discoveries are read from what the save already holds.
 */
import { isTransmissionId } from './transmissions.js';

export const ALMANAC_SEEN_MAX = 400;

/** A clean saved Almanac: known transmission ids once each. */
export function normalizeAlmanac(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { seen: [] };
  const seen = Array.isArray(saved.seen) ? [...new Set(saved.seen.filter(isTransmissionId))] : [];
  return { ...saved, seen: seen.slice(-ALMANAC_SEEN_MAX) };
}

/** The validator's rule for the saved Almanac (the server mirrors the shape, not the ids). */
export function validAlmanac(saved) {
  if (saved === undefined) return true;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  return saved.seen === undefined || (Array.isArray(saved.seen) && saved.seen.length <= ALMANAC_SEEN_MAX
    && saved.seen.every(id => typeof id === 'string' && /^[a-z0-9_]{1,40}$/.test(id)) && new Set(saved.seen).size === saved.seen.length);
}
