// Warp Crew game policy (§11): validateBlob, summary extraction, sanitizeForQa, plausibility.
//
// The blob holds the Warp Crew player (apps/warpcrew/src/systems/player.js createNewPlayer /
// migratePlayer) in one of three wrappers: the core client codec's `{schemaVersion, state}`
// (stage 3 onward), the legacy save's `{player, savedAt}` (apps/warpcrew/src/systems/save.js and
// the legacy server's PUT /v1/saves), or a bare player. The schema the server records is the
// player's own `version` (SAVE_VERSION), never the wire envelope's claim.
//
// progressOf: the monotone depth ordinal. It is the sum of four lifetime counters the game only
// ever increments: stats.jumps (travel.js, travelEvents.js, contracts.js), stats.combatsWon
// (travel.js), stats.expeditions (expedition.js) and stats.contractsCompleted (contracts.js, every
// claimed contract, won or lost). No code path lowers them; migratePlayer merges the saved stats
// over zero defaults, and the only reset (a QA or player restart) is a new player, which the core
// records as a new generation. Wallet balances, hull, crew and flags go up and down and are left
// out; ship system levels only rise today but are left out too, so a future refit or sale can
// never make a save look shallower.
import type { GamePolicy, BlobPolicyResult } from '@foundation/server';
import { grantProblem } from '../grant-vocabulary.ts';
import { warpcrewGrants } from './grants.ts';

/** The fields the server reads; everything else in the player is the client's. */
export interface WarpcrewPlayer {
  version: number;
  wallet: Record<string, unknown>;
  stats?: Record<string, unknown>;
  story?: Record<string, unknown>;
  [key: string]: unknown;
}

type Wrapper = 'codec' | 'legacy' | 'bare';

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A non-negative safe integer reading of a counter; anything else counts as 0. */
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 2 ** 40) : 0;

export function isWarpcrewPlayer(v: unknown): v is WarpcrewPlayer {
  if (!record(v)) return false;
  if (!Number.isSafeInteger(v.version) || (v.version as number) < 1) return false;
  if (!record(v.wallet)) return false;
  for (const key of ['credits', 'gems', 'medals', 'fuel'] as const) {
    const n = v.wallet[key];
    if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n))) return false;
  }
  if (v.stats !== undefined && !record(v.stats)) return false;
  return true;
}

/** The player inside any of the three wrappers. */
export function unwrapWarpcrew(value: unknown): { wrapper: Wrapper; player: unknown } {
  if (record(value)) {
    if (typeof value.schemaVersion === 'number' && 'state' in value)
      return { wrapper: 'codec', player: value.state };
    if ('player' in value && !('wallet' in value))
      return { wrapper: 'legacy', player: value.player };
  }
  return { wrapper: 'bare', player: value };
}

/** Monotone safe-integer depth of a Warp Crew player (see the header). */
export function progressOf(player: { stats?: unknown }): number {
  const s = record(player.stats) ? player.stats : {};
  return count(s.jumps) + count(s.combatsWon) + count(s.expeditions) + count(s.contractsCompleted);
}

/** The small numeric summary the server may read (claims, never authority). */
export function summaryOf(player: WarpcrewPlayer): Record<string, number> {
  const s = record(player.stats) ? player.stats : {};
  return {
    progress: progressOf(player),
    gems: count(player.wallet.gems),
    credits: count(player.wallet.credits),
    medals: count(player.wallet.medals),
    fuel: count(player.wallet.fuel),
    jumps: count(s.jumps),
    combatsWon: count(s.combatsWon),
    contractsCompleted: count(s.contractsCompleted),
    chapter: count(record(player.story) ? player.story.chapter : 0),
  };
}

/** Identifiers and provider evidence a QA copy must not carry. */
function sanitizePlayer(player: WarpcrewPlayer): WarpcrewPlayer {
  const {
    cloudSeq: _seq,
    cloudDirty: _dirty,
    ...rest
  } = player as WarpcrewPlayer & {
    cloudSeq?: unknown;
    cloudDirty?: unknown;
  };
  return {
    ...rest,
    // A player-typed name.
    captainName: 'Captain',
    // Signed Jest receipts name the player (`sub`); provider tokens are payment references.
    pendingReceipts: [],
    iapFulfilled: [],
    purchaseSkus: {},
  };
}

export const warpcrewPolicy: GamePolicy = {
  validateBlob(value): BlobPolicyResult {
    const { player } = unwrapWarpcrew(value);
    if (!isWarpcrewPlayer(player)) return { ok: false, reason: 'shape' };
    return { ok: true, summary: summaryOf(player), schemaVersion: player.version };
  },
  sanitizeForQa(value) {
    const { wrapper, player } = unwrapWarpcrew(value);
    if (!isWarpcrewPlayer(player)) return value;
    const clean = sanitizePlayer(player);
    if (wrapper === 'codec') return { ...(value as Record<string, unknown>), state: clean };
    if (wrapper === 'legacy') return { ...(value as Record<string, unknown>), player: clean };
    return clean;
  },
  // The claimed progress may never be deeper than the blob shows: an inflated claim would refuse
  // every honest save after it (progress_regression). Under-claiming only hurts the claimant.
  summaryPlausible(summary, progress) {
    return progress <= (summary.progress ?? 0);
  },
  // Wallet balances and lifetime counters are skewed by nature; only balances are z-scored.
  anomalyKeys: ['gems', 'credits', 'medals'],
  grantRewardProblem: (rewards) => grantProblem(warpcrewGrants, rewards),
};
