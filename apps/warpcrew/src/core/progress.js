// Progress ordinal and summary of a Warp Crew player, exactly as the server reads them
// (apps/server/games/warpcrew/policy.ts `progressOf` and `summaryOf`). The client sends these
// with every save; the server refuses a claim deeper than the blob shows and keeps the deepest
// save when two devices disagree, so the two sides must agree to the integer.
// apps/server/test/unit/warpcrew-client-parity.test.ts compares them on fixtures and random
// players; change both or neither.

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A non-negative safe-integer reading of a counter; anything else counts as 0. */
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 2 ** 40) : 0);

/**
 * Monotone depth: jumps + fights won + expeditions + contracts claimed. The game only ever
 * increments these four lifetime counters; a restart is a new player in a new generation.
 * @param {{ stats?: unknown }} player
 * @returns {number}
 */
export function progressOf(player) {
  const s = record(player?.stats) ? player.stats : {};
  return count(s.jumps) + count(s.combatsWon) + count(s.expeditions) + count(s.contractsCompleted);
}

/**
 * The numeric summary the server may read (claims, never authority).
 * @param {{ wallet?: Record<string, unknown>, stats?: unknown, story?: unknown }} player
 * @returns {Record<string, number>}
 */
export function summaryOf(player) {
  const s = record(player?.stats) ? player.stats : {};
  const wallet = record(player?.wallet) ? player.wallet : {};
  return {
    progress: progressOf(player),
    gems: count(wallet.gems),
    credits: count(wallet.credits),
    medals: count(wallet.medals),
    fuel: count(wallet.fuel),
    jumps: count(s.jumps),
    combatsWon: count(s.combatsWon),
    contractsCompleted: count(s.contractsCompleted),
    chapter: count(record(player?.story) ? player.story.chapter : 0),
  };
}

/** policy.ts MAX_LIFETIME_COUNTER: a save with any of the four counters above it is refused. */
export const MAX_LIFETIME_COUNTER = 1_000_000;
const COUNTERS = ['jumps', 'combatsWon', 'expeditions', 'contractsCompleted'];
const crewMember = (c) => record(c) && typeof c.templateId === 'string' && typeof c.instanceId === 'string';

/**
 * The shape the server policy accepts (policy.ts isWarpcrewPlayer): an integer `version >= 1`, a
 * `wallet` object with numeric balances, an object `stats` with no counter above
 * MAX_LIFETIME_COUNTER, crew and reserve lists of at most 64 members naming a template and an
 * instance, and an object `ship`. A player that fails it would be refused as `shape`, so the
 * engine never adopts one.
 * @param {unknown} v
 */
export function isWarpcrewPlayer(v) {
  if (!record(v)) return false;
  if (!Number.isSafeInteger(v.version) || v.version < 1) return false;
  if (!record(v.wallet)) return false;
  for (const key of ['credits', 'gems', 'medals', 'fuel']) {
    const n = v.wallet[key];
    if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n))) return false;
  }
  if (v.stats !== undefined && !record(v.stats)) return false;
  if (record(v.stats) && COUNTERS.some((key) => typeof v.stats[key] === 'number' && v.stats[key] > MAX_LIFETIME_COUNTER)) return false;
  for (const key of ['crew', 'reserve']) {
    const list = v[key];
    if (list !== undefined && !(Array.isArray(list) && list.length <= 64 && list.every(crewMember))) return false;
  }
  if (v.ship !== undefined && !record(v.ship)) return false;
  return true;
}
