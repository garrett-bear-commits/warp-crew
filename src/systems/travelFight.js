// @ts-nocheck
/**
 * Explore-map fights as real-time crew fights.
 *
 * A jump that rolls a combat outcome spends its fuel and opens `player.activeTravelFight`,
 * a small saved binding with its own identity (fightId) and revision, and a normal
 * `player.activeEncounter` snapshot built exactly like a contract confrontation
 * (threat from the contract power model, unlocked tactics, boarders, Rally).
 * Beats advance through the shared `stepEncounter`. The final beat settles the prize
 * with the contract crew-fight payout (salvage share on loss); claiming it performs the
 * arrival the old one-shot travel resolution did: visit, location, jump count, wallet.
 */
import { NODES } from '../data/sectors.js';
import { ENCOUNTERS_V1, encounterById } from './combat.js';
import { spendFuel } from './fuel.js';
import { grant } from './economy.js';
import { resolveSimulatedCombatPayout, CURRENCIES } from './contractRewards.js';
import { contractThreat, validEncounterBody, stepEncounter, startCrewFight, fightHullLoss } from './encounterState.js';
import { applyFtlCommand, FTL_VERSION } from './ftlCombat.js';

export const TRAVEL_FIGHT_VERSION = 1;
// Older fights ran on a 30-point hull; v3 fights on the ship's 100-point hull.
const MAX_HULL = 100;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function fightSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) % 2147483647;
}

const rulesetFor = encounterId => (encounterId === 'pirate_scout' ? 'v2' : 'v1');

/** The pseudo-contract the shared crew-fight payout reads (visits, participants, catalog). */
const payoutBinding = fight => ({
  encounterId: fight.encounterId,
  profile: 'travel',
  destinationId: fight.nodeId,
  participantIds: fight.participantIds,
});

function validResult(result) {
  return record(result) && typeof result.success === 'boolean'
    && record(result.rewards) && CURRENCIES.every(key => Number.isFinite(result.rewards[key]) && result.rewards[key] >= 0)
    && Number.isInteger(result.hullLoss) && result.hullLoss >= 0 && result.hullLoss <= MAX_HULL
    && typeof result.summary === 'string';
}

/** Binding identity plus the shared snapshot rules. Returns false for any tampered or torn state. */
export function validTravelFight(player) {
  const fight = player?.activeTravelFight;
  const encounter = player?.activeEncounter;
  if (!record(fight) || fight.version !== TRAVEL_FIGHT_VERSION
    || typeof fight.fightId !== 'string' || !fight.fightId.startsWith('travel:')
    || !NODES[fight.nodeId] || typeof fight.fromNodeId !== 'string'
    || !ENCOUNTERS_V1.some(entry => entry.id === fight.encounterId)
    || !Number.isInteger(fight.seed) || !Number.isInteger(fight.revision)
    || !Array.isArray(fight.participantIds) || !fight.participantIds.every(id => typeof id === 'string')
    || !Number.isFinite(fight.fuelSpent) || fight.fuelSpent < 0
    || !record(encounter) || encounter.acceptanceId !== fight.fightId
    || encounter.encounterId !== fight.encounterId || encounter.kind !== 'normal'
    || ![FTL_VERSION, rulesetFor(fight.encounterId) === 'v2' ? 2 : 1].includes(encounter.version)
    || encounter.seed !== fight.seed || fight.revision !== encounter.beat
    || !Number.isFinite(encounter.enemy?.threat) || Object.hasOwn(encounter.enemy, 'startHull')
    || !validEncounterBody(encounter)) return false;
  if (fight.stage === 'return') {
    return validResult(fight.result)
      && ((encounter.result === 'win' && fight.result.success === true) || (encounter.result === 'loss' && fight.result.success === false))
      && fight.result.hullLoss === fightHullLoss(encounter);
  }
  return fight.stage === 'fight' && fight.result === null && encounter.result === null;
}

/** Load-time guard: a travel fight must be whole and must never coexist with a contract. */
export function normalizeTravelFightState(player) {
  const fight = player?.activeTravelFight;
  if (fight == null) return player;
  const recovered = reason => [...(player.recoveryEvents || []), { event: 'travel_fight_recovered', reason }];
  // The contract owns activeEncounter here; normalizeEncounterState already validated it.
  if (player.activeContract) return { ...player, activeTravelFight: null, recoveryEvents: recovered('contract_active') };
  if (validTravelFight(player)) return player;
  return { ...player, activeTravelFight: null, activeEncounter: null, recoveryEvents: recovered('invalid_travel_fight_state') };
}

/** Spend the jump fuel and open the crew fight. Location, visits and prize wait for the claim. */
export function beginTravelFight(player, preview, now = Date.now()) {
  if (!preview?.ok || preview.outcome?.kind !== 'combat' || !preview.node) return { ok: false, reason: 'bad_preview', player };
  if (player.activeContract) return { ok: false, reason: 'active_contract', player };
  if (player.activeTravelFight || player.activeEncounter) return { ok: false, reason: 'combat_pending', player };
  const encounterId = preview.outcome.encounter;
  if (!ENCOUNTERS_V1.some(entry => entry.id === encounterId)) return { ok: false, reason: 'unknown_encounter', player };
  const fuelSpent = preview.fuelCost ?? 0;
  const spent = spendFuel(player, fuelSpent);
  if (!spent.ok) return { ok: false, reason: 'not_enough_fuel', player };
  const paid = spent.player;
  const jump = (paid.stats?.jumps || 0) + 1;
  const seed = fightSeed(`${paid.createdAt || 0}:${jump}:${preview.node.id}:${encounterId}`);
  const fightId = `travel:${preview.node.id}:${jump}:${seed}`;
  const threat = contractThreat(paid, { encounterId }, now);
  const encounter = startCrewFight(paid, { acceptanceId: fightId, encounterId, seed, threat }, now);
  const fight = {
    version: TRAVEL_FIGHT_VERSION,
    fightId,
    nodeId: preview.node.id,
    fromNodeId: String(paid.location || 'station_home'),
    encounterId,
    seed,
    revision: 0,
    stage: 'fight',
    participantIds: (paid.crew || []).filter(member => member.status === 'ready' && (member.injuredUntil || 0) <= now).map(member => member.instanceId),
    fuelSpent,
    startedAt: now,
    result: null,
  };
  return {
    ok: true,
    player: { ...paid, activeTravelFight: fight, activeEncounter: encounter },
    analytics: { event: 'travel_fight_started', node: fight.nodeId, encounter: encounterId, threat, fuel: fuelSpent },
  };
}

export function applyTravelFightAction(player, { acceptanceId, revision, order = null } = {}, now = Date.now()) {
  const fight = player?.activeTravelFight;
  const encounter = player?.activeEncounter;
  if (player?.activeContract || !validTravelFight(player)) return { ok: false, reason: 'invalid_encounter_state', player };
  if (fight.fightId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  const step = stepEncounter(player, encounter, order, now);
  if (!step.ok) return { ok: false, reason: step.reason, player };
  let nextFight = { ...fight, revision: fight.revision + 1 };
  let nextPlayer = step.player;
  if (step.state.result === 'win' || step.state.result === 'loss') {
    // Same prize, salvage share, hull, injury and XP rules as a contract crew fight.
    const payout = resolveSimulatedCombatPayout(nextPlayer, payoutBinding(nextFight), step.state, now);
    nextPlayer = payout.player;
    nextFight = { ...nextFight, stage: 'return', result: payout.result };
  }
  nextPlayer = { ...nextPlayer, activeTravelFight: nextFight };
  return { ok: true, player: nextPlayer, events: step.events,
    analytics: { event: 'encounter_beat', acceptanceId, beat: step.state.beat, order, result: step.state.result, source: 'travel' } };
}

/** Retarget, hold, or move crew in an Explore fight. No time passes. */
export function applyTravelFightCommand(player, { acceptanceId, revision, command } = {}) {
  const fight = player?.activeTravelFight;
  const encounter = player?.activeEncounter;
  if (player?.activeContract || !validTravelFight(player)) return { ok: false, reason: 'invalid_encounter_state', player };
  if (fight.fightId !== acceptanceId || encounter.revision !== Number(revision)) return { ok: false, reason: 'stale_encounter_action', player };
  const applied = applyFtlCommand(encounter, command || {});
  if (!applied.ok) return { ok: false, reason: applied.reason, player };
  return { ok: true, player: { ...player, activeEncounter: applied.state } };
}

/** Bring the prize (or salvage) aboard and finish the jump. */
export function claimTravelFight(player, { acceptanceId, revision } = {}) {
  const fight = player?.activeTravelFight;
  if (!fight) return { ok: false, reason: 'already_claimed', player };
  if (player.activeContract || !validTravelFight(player)) return { ok: false, reason: 'invalid_encounter_state', player };
  if (fight.fightId !== acceptanceId || fight.revision !== Number(revision)) return { ok: false, reason: 'stale_encounter_action', player };
  if (fight.stage !== 'return') return { ok: false, reason: 'encounter_not_finished', player };
  const node = NODES[fight.nodeId];
  const visits = { ...(player.stats?.visits || {}) };
  visits[fight.nodeId] = (visits[fight.nodeId] || 0) + 1;
  const catalog = encounterById(fight.encounterId);
  const injured = fight.result.injuredCrewId ? player.crew?.find(member => member.instanceId === fight.result.injuredCrewId)?.name || null : null;
  const nextPlayer = {
    ...player,
    wallet: grant(player.wallet, fight.result.rewards),
    location: fight.nodeId,
    stats: { ...player.stats, visits, jumps: (player.stats?.jumps || 0) + 1 },
    activeTravelFight: null,
    activeEncounter: null,
  };
  return {
    ok: true,
    player: nextPlayer,
    // Same shape the travel log already reads for combat jumps.
    result: {
      kind: 'combat',
      node,
      outcome: { kind: 'combat', encounter: fight.encounterId },
      rewards: fight.result.rewards,
      injured,
      combat: { success: fight.result.success, log: fight.result.summary, encounter: catalog, crewFight: true,
        beats: player.activeEncounter.beat, rewards: fight.result.rewards },
    },
    analytics: { event: 'travel_fight_claimed', node: fight.nodeId, encounter: fight.encounterId, success: fight.result.success,
      beats: player.activeEncounter.beat, ...fight.result.rewards, hullLoss: fight.result.hullLoss },
  };
}
