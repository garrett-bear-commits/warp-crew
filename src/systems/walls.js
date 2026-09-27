// @ts-nocheck
/**
 * Siege walls: one flagship per sector blocks the next sector's gate for
 * guided-flow captains. Each attempt fights up to 42 hull of the flagship;
 * damage holds until the local daily reset, so coming back wears the wall down.
 */
import { NODES, visibleNodes, careerDay } from '../data/sectors.js';
import { encounterById } from './combat.js';

export const WALLS = Object.freeze([
  { id: 'spur', encounterId: 'corsair_king', destinationId: 'pirate_nest', pool: 100, opens: 'veil_gate', minDay: 3 },
  { id: 'veil', encounterId: 'swarm_frigate', destinationId: 'swarm_scar', pool: 130, opens: 'ember_gate' },
  { id: 'ember', encounterId: 'ember_raider', destinationId: 'kiln_reach', pool: 160, opens: 'hollow_mouth' },
  { id: 'hollow', encounterId: 'hollow_shade', destinationId: 'dark_well', pool: 190, opens: 'halo_approach' },
  { id: 'crown', encounterId: 'eclipse_throne', destinationId: 'eclipse_crown', pool: 240, opens: null },
]);
export const WALL_BY_ID = Object.fromEntries(WALLS.map(wall => [wall.id, wall]));
/** A flagship is never easier than Dangerous when the captain first reaches it. */
export const WALL_THREAT_FLOOR = 1.2;
export const SIEGE_SEGMENT = 42;

const dayKey = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function wallsApply(player) {
  return [4, 5].includes(player?.tutorial?.script) && player.tutorial.completed === true;
}

export function wallBeaten(player, id) {
  return player?.flags?.[`wall_${id}`] === true;
}


export function currentWall(player, now = Date.now()) {
  if (!wallsApply(player)) return null;
  const visible = new Set(visibleNodes(player, now).map(node => node.id));
  for (const wall of WALLS) {
    if (wallBeaten(player, wall.id)) continue;
    if (wall.minDay && careerDay(player, now) < wall.minDay) return null;
    return visible.has(wall.destinationId) ? wall : null;
  }
  return null;
}

export function siegeState(player, wall, now = Date.now()) {
  const record = player?.siege?.[wall.id];
  const today = dayKey(now);
  const damage = record?.dayKey === today ? Math.min(wall.pool, record.damage || 0) : 0;
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return { pool: wall.pool, damage, remaining: wall.pool - damage, attempts: record?.attempts || 0, resetsInMs: tomorrow.getTime() - now };
}

export function wallOffer(player, wall, now = Date.now()) {
  const siege = siegeState(player, wall, now);
  const encounter = encounterById(wall.encounterId);
  const node = NODES[wall.destinationId];
  const id = `offer_wall_${wall.id}_${siege.attempts + 1}`;
  const combat = { w: 100, kind: 'combat', encounter: wall.encounterId };
  return {
    id,
    profile: 'risky',
    icon: 'contract_risky',
    title: `Wall · ${encounter.name}`,
    brief: `${encounter.name} holds ${node.name}. Every hit sticks until the daily reset — break the flagship to open the next sector.`,
    destinationId: node.id,
    destinationName: node.name,
    normalFuel: 2,
    rewardFamily: 'credits, medals and the next sector',
    danger: 'Deadly',
    favoredTrait: { kind: 'role', id: 'gunner', label: 'Gunner', why: 'Flagships fall to sustained fire.' },
    wall: { id: wall.id, pool: siege.pool, remaining: siege.remaining, resetsInMs: siege.resetsInMs },
    routeContent: {
      routeOutcome: { ...combat },
      secureOutcome: { ...combat },
      encounterId: wall.encounterId,
      storyFlag: null,
      destinationId: node.id,
      routeSeed: hashSeed(`${id}:${node.id}:wall`),
    },
    beats: 3,
    beatLabel: '3 beats',
  };
}

/** Keep exactly the current wall's attempt on the board, alongside the daily offers. */
export function ensureWallOffer(player, now = Date.now()) {
  const board = player?.contractBoard;
  if (!board?.offers) return player;
  const wall = currentWall(player, now);
  const activeWall = player.activeContract?.wall?.id;
  const others = board.offers.filter(offer => !offer.wall);
  const offers = wall && activeWall !== wall.id ? [...others, wallOffer(player, wall, now)] : others;
  // Remember when the captain first met this wall (for the stuck-at-wall offer).
  const seen = wall && !player.siege?.[wall.id]?.firstSeenAt
    ? { siege: { ...(player.siege || {}), [wall.id]: { ...(player.siege?.[wall.id] || {}), firstSeenAt: now } } } : {};
  if (JSON.stringify(offers) === JSON.stringify(board.offers) && !seen.siege) return player;
  return { ...player, ...seen, contractBoard: { ...board, offers } };
}

/** Encounter setup for a wall attempt: this segment's hull and the threat floor. */
export function wallEncounterSetup(player, contract, threat, now = Date.now()) {
  const wall = WALL_BY_ID[contract?.wall?.id];
  if (!wall) return null;
  const siege = siegeState(player, wall, now);
  return {
    enemyHull: Math.max(1, Math.min(SIEGE_SEGMENT, siege.remaining)),
    threat: Math.max(WALL_THREAT_FLOOR, threat),
    remainingBefore: siege.remaining,
  };
}

/** Settle an attempt at claim: record damage for today and open the gate when the pool is spent. */
export function recordSiege(player, contract, now = Date.now()) {
  const wall = WALL_BY_ID[contract?.wall?.id];
  const outcome = contract?.result?.wall;
  if (!wall || !outcome) return player;
  const siege = siegeState(player, wall, now);
  const damage = Math.min(wall.pool, siege.damage + (outcome.dealt || 0));
  const beaten = outcome.defeated === true || damage >= wall.pool;
  return {
    ...player,
    siege: { ...(player.siege || {}), [wall.id]: { ...(player.siege?.[wall.id] || {}), dayKey: dayKey(now), damage, attempts: siege.attempts + 1,
      // A lost attempt that left the flagship's segment at 20% or less.
      nearMiss: contract.result.success === false && outcome.segment > 0 && (outcome.segment - outcome.dealt) <= outcome.segment * 0.2 } },
    flags: beaten ? { ...(player.flags || {}), [`wall_${wall.id}`]: true } : player.flags,
  };
}
