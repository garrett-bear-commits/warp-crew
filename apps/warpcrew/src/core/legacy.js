// Local save keys from before the core port, and the one-time import of the legacy save.
//
// Until stage 3 the game kept one save at localStorage `warpcrew.save.v2` ({player, savedAt}, see
// git history for src/systems/save.js). The core keeps saves in its own envelope at
// `foundation:<gameId>:slot:<playerId>`. On the first boot after the port the legacy player is
// read once, migrated, and handed to the engine (a deeper or equal player is adopted; a shallower
// one never replaces deeper core progress), then the legacy key is moved aside to
// `warpcrew.save.v2.imported` so it is never imported twice but stays recoverable by hand.
import { decodePlayer } from './codec.js';
import { progressOf } from './progress.js';

export const LEGACY_SAVE_KEY = 'warpcrew.save.v2';
export const LEGACY_IMPORTED_KEY = 'warpcrew.save.v2.imported';
const OLDER_KEYS = ['warpcrew.save.v1'];

/**
 * Read the legacy save if one is waiting. Returns the migrated player, or null.
 * @param {{ getItem(k: string): string | null }} storage
 */
export function readLegacySave(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(LEGACY_SAVE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return decodePlayer(parsed?.player ?? parsed);
  } catch {
    return null;
  }
}

/** Move the legacy save aside once it has been imported (or found unusable). */
export function retireLegacySave(storage) {
  try {
    const raw = storage.getItem(LEGACY_SAVE_KEY);
    if (raw !== null) storage.setItem(LEGACY_IMPORTED_KEY, raw);
    storage.removeItem(LEGACY_SAVE_KEY);
  } catch {
    /* storage blocked: nothing to retire */
  }
}

/**
 * Decide whether the legacy player should replace the core's current one: only when it is at
 * least as deep (a QA player who already played on the core keeps that progress).
 */
export function shouldImportLegacy(current, legacy) {
  return Boolean(legacy) && progressOf(legacy) >= progressOf(current);
}

/**
 * QA `?fresh=1` and an offline restart: remove every local Warp Crew save on this device (core
 * slots, the last-known player marker, damaged-slot backups and the legacy keys). Online, a fresh
 * start is a new generation on the server instead (GameClient.restartJourney), so the server copy
 * is not adopted straight back.
 * @param {Storage} storage
 * @param {string} gameId
 */
export function clearLocalSaves(storage, gameId) {
  try {
    const prefix = `foundation:${gameId}:`;
    const doomed = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith(prefix) || key === LEGACY_SAVE_KEY || OLDER_KEYS.includes(key))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}
