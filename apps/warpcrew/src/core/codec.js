// Warp Crew save codec (core defineSave). The wire blob is `{"schemaVersion": 9, "state": player}`.
// The schema is the player's own `version` (SAVE_VERSION in src/systems/player.js), which is also
// what the server policy records, so the codec version is read from a fresh player rather than
// copied.
//
// migratePlayer already reads every older player (versions 1..8, and saves that predate the
// version field) in one step: it merges the saved player over a fresh one and normalises each
// part. The numbered migrations are therefore pass-throughs that let the codec accept those
// versions; decode runs migratePlayer, which stamps the current version. They must not stamp the
// version themselves: migratePlayer reads the original version (a pre-9 save with jumps or wins
// is a veteran whose splash is skipped).
import { defineSave } from '@foundation/client';
import { createNewPlayer, migratePlayer } from '../systems/player.js';
import { isWarpcrewPlayer } from './progress.js';

/** The current save schema (player.version). */
export const SAVE_VERSION = createNewPlayer({ now: 0, rng: () => 0 }).version;

/**
 * Fields the legacy save and its cloud client kept in the player. The core keeps sync metadata in
 * its own envelope and purchases arrive as server grants, so these are dropped on read.
 */
const LEGACY_FIELDS = ['cloudSeq', 'cloudDirty', 'lastSavedAt', 'pendingReceipts', 'purchaseSkus'];

/** A raw saved player at any schema → the current player. Throws on garbage. */
export function decodePlayer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('player must be an object');
  if (!raw.wallet || typeof raw.wallet !== 'object' || Array.isArray(raw.wallet)) throw new Error('player.wallet must be an object');
  const migrated = migratePlayer(raw);
  for (const key of LEGACY_FIELDS) delete migrated[key];
  return migrated;
}

const passThrough = (raw) => raw;
const MIGRATIONS = Object.fromEntries(Array.from({ length: SAVE_VERSION - 1 }, (_, i) => [i + 1, passThrough]));

/** @type {import('@foundation/client').SaveCodec<any>} */
export const warpcrewCodec = defineSave({
  schemaVersion: SAVE_VERSION,
  migrations: MIGRATIONS,
  decode: decodePlayer,
  validate: isWarpcrewPlayer,
});
