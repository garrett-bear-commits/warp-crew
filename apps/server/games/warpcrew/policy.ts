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

/**
 * The most any lifetime counter can honestly reach (years of daily play are in the low thousands).
 * A save above it is refused outright, so no first save (which has no head to jump from) can
 * plant an impossible depth that every honest save after it would regress from.
 */
export const MAX_LIFETIME_COUNTER = 1_000_000;
const COUNTERS = ['jumps', 'combatsWon', 'expeditions', 'contractsCompleted'] as const;

/** A crew member the client can load: an object naming its template and instance. */
const crewMember = (c: unknown): boolean =>
  record(c) && typeof c.templateId === 'string' && typeof c.instanceId === 'string';

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
  if (record(v.stats)) {
    const stats = v.stats;
    if (
      COUNTERS.some(
        (key) => typeof stats[key] === 'number' && (stats[key] as number) > MAX_LIFETIME_COUNTER,
      )
    )
      return false;
  }
  // The client dereferences every crew and reserve entry on load (crewRoster.recomputeCrew).
  for (const key of ['crew', 'reserve'] as const) {
    const list = v[key];
    if (list !== undefined && !(Array.isArray(list) && list.length <= 64 && list.every(crewMember)))
      return false;
  }
  if (v.ship !== undefined && !record(v.ship)) return false;
  // Phase 2 fields, the same rules as the client (apps/warpcrew/src/core/progress.js).
  // Achievement tiers claimed: small whole counts only.
  if (
    v.achievements !== undefined &&
    !(
      record(v.achievements) &&
      Object.values(v.achievements).every(
        (n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 5,
      )
    )
  )
    return false;
  // Login calendar: whole counts, at most 28 squares, a day key or nothing.
  if (v.calendar !== undefined) {
    const c = v.calendar;
    if (!(
      record(c) &&
      Number.isSafeInteger(c.cycle) &&
      (c.cycle as number) >= 1 &&
      Number.isInteger(c.claimed) &&
      (c.claimed as number) >= 0 &&
      (c.claimed as number) <= 28 &&
      (c.lastDay === null ||
        (typeof c.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.lastDay)))
    ))
      return false;
  }
  // Income while away: the clock start is a time; anything banked is bounded.
  if (v.idle !== undefined) {
    const idle = v.idle;
    if (!(
      record(idle) &&
      typeof idle.since === 'number' &&
      Number.isFinite(idle.since) &&
      idle.since > 0
    ))
      return false;
    const banked = idle.banked;
    if (
      banked !== undefined &&
      !(
        record(banked) &&
        (
          [
            ['credits', 100000],
            ['medals', 10000],
            ['hours', 16],
          ] as const
        ).every(
          ([key, max]) =>
            typeof banked[key] === 'number' &&
            (banked[key] as number) >= 0 &&
            (banked[key] as number) <= max,
        )
      )
    )
      return false;
  }
  // Phase 3 (campaign, Almanac, loyalty): short id lists without repeats, bounded counts.
  if (v.campaign !== undefined) {
    const c = v.campaign;
    if (!(
      record(c) &&
      idList(c.done, 40) &&
      Number.isInteger(c.since) &&
      (c.since as number) >= 0 &&
      (c.since as number) <= 999 &&
      (c.chapters === undefined ||
        (Array.isArray(c.chapters) &&
          c.chapters.length <= 10 &&
          c.chapters.every((n) => Number.isInteger(n) && n >= 1 && n <= 10) &&
          new Set(c.chapters).size === c.chapters.length))
    ))
      return false;
  }
  if (v.almanac !== undefined) {
    const a = v.almanac;
    if (!(
      record(a) &&
      (a.seen === undefined || idList(a.seen, 400)) &&
      (a.crew === undefined || idList(a.crew, 100)) &&
      (a.enemies === undefined ||
        (record(a.enemies) &&
          Object.keys(a.enemies).length <= 64 &&
          Object.entries(a.enemies).every(
            ([id, wl]) =>
              ID.test(id) &&
              Array.isArray(wl) &&
              wl.length === 2 &&
              wl.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_LIFETIME_COUNTER),
          )))
    ))
      return false;
  }
  if (v.loyalty !== undefined) {
    const l = v.loyalty;
    if (!(
      record(l) &&
      (l.loyal === undefined || idList(l.loyal, 100)) &&
      record(l.points) &&
      Object.keys(l.points).length <= 100 &&
      Object.entries(l.points).every(
        ([id, n]) =>
          ID.test(id) && Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 60,
      )
    ))
      return false;
  }
  return true;
}

const ID = /^[a-z0-9_]{1,40}$/;
/** A list of at most `max` distinct short ids. */
function idList(list: unknown, max: number): boolean {
  return (
    Array.isArray(list) &&
    list.length <= max &&
    list.every((id) => typeof id === 'string' && ID.test(id)) &&
    new Set(list).size === list.length
  );
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

/**
 * The top-level player fields a QA copy keeps. An allowlist, so a field added to the save later
 * (an email, a device id, a provider token) stays out of QA exports until someone adds it here on
 * purpose; the parity test fails when the game's fresh player grows a field this list does not name.
 */
export const QA_FIELDS = [
  'achievements',
  'activeContract',
  'activeEncounter',
  'activeEvent',
  'activeExpedition',
  'activeTravelFight',
  'almanac',
  'calendar',
  'campaign',
  'captainInstanceId',
  'chests',
  'contractBoard',
  'createdAt',
  'crew',
  'crewSlots',
  'dailyLoop',
  'dailyPullAvailable',
  'drydockFinishes',
  'flags',
  'fuelClaimAt',
  'fuelMax',
  'fuelRatePerHour',
  'gacha',
  'hullRepairAt',
  'idle',
  'lastLoginDay',
  'location',
  'loginStreak',
  'loyalty',
  'reserve',
  'ship',
  'shipBuild',
  'stationAssignments',
  'stats',
  'story',
  'tutorial',
  'version',
  'wallet',
] as const;

/** A crew member with any player-typed name replaced by the template's own. */
function sanitizeCrew(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((c) => {
    if (!record(c)) return c;
    const { customName: _custom, ...rest } = c;
    return { ...rest, ...(c.isCaptain ? { name: 'Captain' } : {}) };
  });
}

/** Identifiers, player-typed names and provider evidence a QA copy must not carry. */
function sanitizePlayer(player: WarpcrewPlayer): WarpcrewPlayer {
  const kept: Record<string, unknown> = {};
  for (const key of QA_FIELDS) if (key in player) kept[key] = player[key];
  const ship = record(kept.ship) ? kept.ship : undefined;
  return {
    ...(kept as WarpcrewPlayer),
    // Player-typed names: the captain, renamed crew and the ship.
    captainName: 'Captain',
    crew: sanitizeCrew(kept.crew),
    reserve: sanitizeCrew(kept.reserve),
    ...(ship ? { ship: { ...ship, name: 'Sparrow', nickname: undefined } } : {}),
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
