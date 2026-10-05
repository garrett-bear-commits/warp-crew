// Saved bridge between a contract and the deterministic crew-run fight.
import { startEncounter, advanceEncounter, enemyVolleyDamage, TACTICS, BURN, BOARDERS, BOARDING_ENEMIES } from './autoCombat.js';
import { normalizeAssignments, stationOutputs } from './stations.js';
import { resolveSimulatedCombatPayout, readyContractCrew } from './contractRewards.js';
import { crewPower, encounterById, rubberBandPower } from './combat.js';
import { combatBonuses } from './passives.js';
import { wallEncounterSetup } from './walls.js';
import { RALLY } from './gemSinks.js';
import { isCanonicalGuidedContract } from './contractState.js';
import { startFtlEncounter, advanceFtlEncounter, applyFtlCommand, validFtlBody, FTL_VERSION, OVERCHARGE } from './ftlCombat.js';

const STATIONS = ['helm', 'shields', 'weapons', 'engineering'];
const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const targets = ['hull', 'shields', 'weapons', 'engineering'];

function validOrders(encounter) {
  const { orders, cooldowns } = encounter;
  return record(orders) && record(orders.brace) && record(orders.repair)
    && typeof orders.brace.used === 'boolean'
    && Number.isInteger(orders.brace.uses) && numberIn(orders.brace.uses, 0, encounter.beat)
    && Number.isInteger(orders.repair.uses) && numberIn(orders.repair.uses, 0, encounter.beat)
    && orders.brace.used === (orders.brace.uses > 0)
    && (encounter.version === 1 ? !Object.hasOwn(orders, 'targetWeapons') : (record(orders.targetWeapons)
      && typeof orders.targetWeapons.used === 'boolean'
      && Number.isInteger(orders.targetWeapons.uses) && numberIn(orders.targetWeapons.uses, 0, 1)
      && orders.targetWeapons.uses <= encounter.beat
      && orders.targetWeapons.used === (orders.targetWeapons.uses === 1)))
    && Number.isInteger(encounter.braceThroughBeat) && numberIn(encounter.braceThroughBeat, 0, encounter.beat + 2)
    && record(cooldowns) && Object.keys(cooldowns).every(name => ['brace', 'repair'].includes(name))
    && ['brace', 'repair'].every(name => Number.isInteger(cooldowns[name]) && numberIn(cooldowns[name], 0, 4));
}

function validTactics(encounter) {
  if (!Object.hasOwn(encounter, 'tactics')) return true;
  const tactics = encounter.tactics;
  if (encounter.kind !== 'normal' || !record(tactics) || !Object.keys(tactics).every(name => TACTICS.includes(name))) return false;
  const burn = tactics.burn;
  const board = tactics.board;
  return (!burn || (record(burn) && [0, 1].includes(burn.uses) && Number.isInteger(burn.throughBeat)
      && (burn.uses === 0 ? burn.throughBeat === 0 : numberIn(burn.throughBeat, BURN.beats - 1, encounter.beat + BURN.beats - 1))))
    && (!board || (record(board) && [0, 1].includes(board.uses)
      && (board.uses === 0 ? board.success === null : typeof board.success === 'boolean')
      && (!board.success || (encounter.result === 'win' && encounter.enemy.hull === 0))));
}

function validBoarders(encounter) {
  if (!Object.hasOwn(encounter, 'boarders')) return true;
  const b = encounter.boarders;
  if (encounter.kind !== 'normal' || !BOARDING_ENEMIES.includes(encounter.encounterId) || !record(b)) return false;
  if (!['none', 'incoming', 'aboard', 'repelled'].includes(b.phase)) return false;
  if (b.phase === 'none') return b.target === null && b.strength === 0 && b.defenderId === null && encounter.beat < BOARDERS.warnBeat + 1;
  return ['weapons', 'shields', 'engineering', 'helm'].includes(b.target)
    && Number.isInteger(b.strength) && numberIn(b.strength, 0, BOARDERS.strength)
    && Number.isInteger(b.landsBeat) && b.landsBeat === BOARDERS.warnBeat + 1
    && (b.phase !== 'repelled' || (b.strength === 0 && typeof b.defenderId === 'string'
      && Number.isInteger(b.repelledBeat) && numberIn(b.repelledBeat, BOARDERS.warnBeat + 1, encounter.beat)))
    && (b.defenderId === null || (typeof b.defenderId === 'string' && typeof b.defenderRole === 'string'))
    && (b.defenderStation === null || ['helm', 'shields', 'weapons', 'engineering'].includes(b.defenderStation));
}

function validOrderWindow(window, encounter) {
  if (window == null) return true;
  const names = encounter.kind === 'guided' ? ['brace'] : ['brace', 'repair'];
  if (encounter.version === 2 && encounter.encounterId === 'pirate_scout') names.push('target_weapons');
  return Boolean(
    record(window) && targets.includes(window.target)
    && (encounter.version !== 2 || encounter.enemy.pattern === 'charging_volley')
    && Number.isInteger(window.beatsToImpact) && numberIn(window.beatsToImpact, 1, 3)
    && Array.isArray(window.availableOrders)
    && window.availableOrders.every(name => names.includes(name))
    && new Set(window.availableOrders).size === window.availableOrders.length
    && record(window.orderOptions)
    && Object.keys(window.orderOptions).length === names.length
    && names.every(name => {
      const option = window.orderOptions?.[name];
      return record(option) && record(option.cost)
        && option.cost.shield === (name === 'brace' ? 2 : name === 'target_weapons' ? 0 : 3)
        && typeof option.available === 'boolean'
        && (option.available ? option.reason === null : ['insufficient_resource', 'cooldown', 'used', 'hull_full'].includes(option.reason))
        && Number.isInteger(option.cooldownBeats) && numberIn(option.cooldownBeats, 0, 4)
        && window.availableOrders.includes(name) === option.available;
    })
  );
}

function eligibleContract(player, contract) {
  return contract?.stage === 'confrontation' && (
    (contract.profile === 'distress' && [4, 5].includes(player.tutorial?.script) && contract.encounterId === 'pirate_scout')
    || (contract.profile !== 'distress' && ['secure', 'push'].includes(contract.choiceId) && Boolean(contract.encounterId))
  );
}

const THREAT_RANGE = [0.6, 1.6];

/** New captains meet Burn after three finished contracts and Board after five. */
export const TACTIC_UNLOCKS = Object.freeze({ burn: 3, board: 5 });
export const BOARDERS_UNLOCK = 8;

export function boardersUnlocked(player) {
  const guidedFlow = [4, 5].includes(player?.tutorial?.script) && player.tutorial.completed;
  return !guidedFlow || (player?.stats?.contractsCompleted || 0) >= BOARDERS_UNLOCK;
}

/** Security first, then gunners, then the strongest non-captain; the captain only as a last resort. */
export function pickDefender(player, now = Date.now()) {
  const ready = readyContractCrew(player, now);
  const rank = member => (member.role === 'security' ? 300 : member.role === 'gunner' ? 200 : 100)
    + (member.instanceId === player.captainInstanceId ? -150 : 0) + (member.power || 10);
  const best = [...ready].sort((a, b) => rank(b) - rank(a))[0];
  if (!best) return null;
  return { id: best.instanceId, name: best.name, role: best.role, station: normalizeAssignments(player)[best.instanceId] || null };
}

export function unlockedTactics(player) {
  const guidedFlow = [4, 5].includes(player?.tutorial?.script) && player.tutorial.completed;
  const done = player?.stats?.contractsCompleted || 0;
  return TACTICS.filter(name => !guidedFlow || done >= TACTIC_UNLOCKS[name]);
}

export function threatLabel(threat) {
  if (threat == null) return null;
  return threat >= 1.3 ? 'Deadly' : threat >= 1.05 ? 'Dangerous' : threat >= 0.9 ? 'Even' : 'Favorable';
}

/** Same power model the order-based fights used, expressed as enemy/crew threat. */
export function contractThreat(player, contract, now = Date.now(), { excludeIds = [] } = {}) {
  const encounter = encounterById(contract.encounterId);
  const crew = readyContractCrew(player, now).filter(member => !excludeIds.includes(member.instanceId));
  const bonus = combatBonuses(player, encounter);
  const playerPower = Math.max(1, crewPower(crew) + bonus.extraPower);
  const enemyPower = Math.max(6, Math.round(rubberBandPower(encounter.power, playerPower) * bonus.enemyScale));
  return Math.max(THREAT_RANGE[0], Math.min(THREAT_RANGE[1], Math.round((enemyPower / playerPower) * 100) / 100));
}

/** The crew who fight, at their stations (null station = free crew who go where needed). */
export function fightingCrew(player, now = Date.now()) {
  const assignments = normalizeAssignments(player);
  return readyContractCrew(player, now).map(member => ({ id: member.instanceId, role: member.role || '', station: assignments[member.instanceId] || null }));
}

/** Every new normal fight (contract, wall, Explore jump) is an FTL-lite v3 fight. */
export function startCrewFight(player, { acceptanceId, encounterId, seed, threat, enemyHull = null, remainingBefore = null, guided = false }, now = Date.now()) {
  return startFtlEncounter({
    acceptanceId,
    encounterId,
    seed,
    threat,
    crew: fightingCrew(player, now),
    hull: Math.max(1, Math.min(100, Math.round(player.ship?.hull ?? 100))),
    enemyHull,
    remainingBefore,
    tactics: guided ? [] : unlockedTactics(player),
    boarders: !guided && boardersUnlocked(player) && BOARDING_ENEMIES.includes(String(encounterId)),
    guided,
  });
}

/** The script-5 tutorial's first fight is an easy FTL-lite fight that teaches targeting. */
export const GUIDED_FIGHT = Object.freeze({ threat: 0.6, enemyHull: 25 });
const ftlGuided = (player, contract) => contract?.profile === 'distress' && player?.tutorial?.script === 5;
/** Did the captain do what the guided fight teaches? (v2: the Target Weapons order; v3: target their Weapons room.) */
export function guidedTargetDone(encounter) {
  return encounter?.version === FTL_VERSION ? encounter.guided === true && encounter.intent?.target === 'weapons'
    : encounter?.orders?.targetWeapons?.used === true;
}

export function fightCrewLaunched(encounter, participantIds) {
  return Array.isArray(participantIds) && encounter.crew.every(member => participantIds.includes(member.id));
}

/** Hull a settled fight took off the ship (v3 fights use the ship's own hull). */
export const fightHullLoss = encounter => (encounter.version === FTL_VERSION ? encounter.startHull - encounter.hull : 30 - encounter.hull);

/** Called only by the action that freshly enters confrontation. */
export function beginContractEncounter(player, now = Date.now()) {
  const contract = player?.activeContract;
  if (player?.activeEncounter || !eligibleContract(player, contract)) return player;
  const kind = contract.profile === 'distress' ? 'guided' : 'normal';
  const wall = contract.wall ? wallEncounterSetup(player, contract, contractThreat(player, contract, now), now) : null;
  const encounter = ftlGuided(player, contract) ? startCrewFight(player, {
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    seed: contract.routeSeed,
    threat: GUIDED_FIGHT.threat,
    enemyHull: GUIDED_FIGHT.enemyHull,
    guided: true,
  }, now) : kind === 'normal' ? startCrewFight(player, {
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    seed: contract.routeSeed,
    threat: wall ? wall.threat : contractThreat(player, contract, now),
    enemyHull: wall ? wall.enemyHull : null,
    remainingBefore: wall ? wall.remainingBefore : null,
  }, now) : startEncounter({
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    kind,
    ruleset: contract.profile === 'distress' && player.tutorial?.script === 4
      ? 'v1' : contract.encounterId === 'pirate_scout' ? 'v2' : 'v1',
    seed: contract.routeSeed,
    assignments: normalizeAssignments(player),
    outputs: stationOutputs(player, now),
    threat: kind === 'normal' ? (wall ? wall.threat : contractThreat(player, contract, now)) : null,
    enemyHull: wall ? wall.enemyHull : null,
    remainingBefore: wall ? wall.remainingBefore : null,
    tactics: kind === 'normal' ? unlockedTactics(player) : [],
    boarders: kind === 'normal' && boardersUnlocked(player),
  });
  return {
    ...player,
    activeContract: {
      ...contract,
      encounterMode: 'crew',
      participantIds: (player.crew || []).filter(member => member.status === 'ready' && (member.injuredUntil || 0) <= now).map(member => member.instanceId),
    },
    activeEncounter: encounter,
  };
}

/** Shape and rule checks for any saved crew-fight snapshot, independent of what it is bound to. */
export function validEncounterBody(encounter) {
  if (encounter?.version === FTL_VERSION) return validFtlBody(encounter);
  if (!encounter || ![1, 2].includes(encounter.version) || !['guided', 'normal'].includes(encounter.kind)
    || !Number.isInteger(encounter.seed)
    || !Number.isInteger(encounter.beat) || encounter.beat < 0
    || !Number.isInteger(encounter.revision) || encounter.revision !== encounter.beat
    || !Number.isInteger(encounter.eventIndex) || encounter.eventIndex < encounter.beat
    || !(encounter.result === null ? ['combat', 'downed'].includes(encounter.phase) : encounter.phase === 'complete')
    || (encounter.phase === 'downed' && (encounter.hull !== 1 || encounter.kind !== 'normal'))
    || (Object.hasOwn(encounter, 'rally') && (encounter.kind !== 'normal' || !record(encounter.rally) || encounter.rally.used !== true))
    || !numberIn(encounter.hull, 1, 30) || !numberIn(encounter.shield, 0, 12)
    || !record(encounter.enemy) || !numberIn(encounter.enemy.hull, 0, 42)
    // A live fight always has an enemy standing: zero hull resolves as a win on the same beat.
    || (encounter.result === null && encounter.enemy.hull === 0)
    || (Object.hasOwn(encounter.enemy, 'damage') && (encounter.kind !== 'normal' || !Number.isInteger(encounter.enemy.damage)
      || !numberIn(encounter.enemy.damage, 12, 45) || !numberIn(encounter.enemy.threat, THREAT_RANGE[0], THREAT_RANGE[1])
      || encounter.enemy.damage !== enemyVolleyDamage(encounter.enemy.threat)))
    || (encounter.version === 1 && Object.hasOwn(encounter.enemy, 'weaponDisabledThroughBeat'))
    || (encounter.version === 2 && (encounter.encounterId !== 'pirate_scout'
      || !Number.isInteger(encounter.enemy.weaponDisabledThroughBeat)
      || !numberIn(encounter.enemy.weaponDisabledThroughBeat, 0, encounter.beat + 2)
      || (encounter.enemy.weaponDisabledThroughBeat > 0 && (encounter.enemy.weaponDisabledThroughBeat < encounter.beat
        || encounter.orders?.targetWeapons?.used !== true))))
    || !targets.includes(encounter.enemy.target)
    || !['charging_volley', 'reloading', 'broken_contact'].includes(encounter.enemy.pattern)
    || !STATIONS.every(station => numberIn(encounter.outputs?.[station], 0, 10000)
      && numberIn(encounter.systems?.[station], 0, 100))
    || !validTactics(encounter)
    || !validBoarders(encounter)
    || !record(encounter.assignments)
    || !validOrders(encounter)
    || !validOrderWindow(encounter.orderWindow, encounter)
    || (encounter.result !== null && !['win', 'loss'].includes(encounter.result))) return false;
  if (encounter.result === 'win' && (encounter.beat === 0 || encounter.enemy.hull !== 0 || encounter.orderWindow !== null)) return false;
  if (encounter.result === 'loss' && (encounter.beat === 0 || encounter.hull !== 1 || encounter.enemy.hull <= 0 || encounter.orderWindow !== null)) return false;
  return true;
}

function validSnapshot(encounter, contract, tutorial) {
  // New-mode entry paths are distress Launch (one route action) and any
  // route choice into a confrontation (Launch plus choice). Every later contract revision is a beat.
  const entryRevision = contract.profile === 'distress' ? 1
    : ['secure', 'push'].includes(contract.choiceId) ? 2 : null;
  if (!encounter || contract.encounterMode !== 'crew' || encounter.acceptanceId !== contract.acceptanceId
    || (tutorial?.script === 5 && !tutorial.completed && ['fight', 'claim'].includes(tutorial.phase)
      && !isCanonicalGuidedContract(contract))
    || entryRevision === null
    || (contract.profile === 'distress'
      && (tutorial?.script === 4 ? encounter.version !== 1
        // Script 5: new saves are a guided v3 fight; saves from before keep their v2 fight.
        : tutorial?.script === 5 ? !(encounter.version === 2 || (encounter.version === FTL_VERSION && encounter.guided === true)) : true))
    || encounter.encounterId !== contract.encounterId
    || (contract.profile === 'distress' ? !(encounter.kind === 'guided' || encounter.guided === true) : encounter.kind !== 'normal' || encounter.guided === true)
    || encounter.seed !== contract.routeSeed
    || contract.revision !== entryRevision + encounter.beat
    || !validEncounterBody(encounter)
    // v3 fights carry their crew: only crew who launched with the contract can be in it.
    || (encounter.version === FTL_VERSION && !fightCrewLaunched(encounter, contract.participantIds))) return false;
  if (contract.stage === 'return') {
    const settled = (encounter.result === 'win' && contract.result?.success === true)
      || (encounter.result === 'loss' && contract.profile !== 'distress' && contract.result?.success === false);
    return settled && contract.result.hullLoss === fightHullLoss(encounter);
  }
  return contract.stage === 'confrontation' && encounter.result !== 'win';
}

/** Invalid new fights cannot become legacy fights or produce a claim. */
export function normalizeEncounterState(player) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  // A travel fight owns the encounter when no contract is active; travelFight.js validates that binding.
  if (!contract && player?.activeTravelFight) return player;
  if (!contract) return encounter ? { ...player, activeEncounter: null } : player;
  if (!encounter && contract.encounterMode !== 'crew') return player;
  if (validSnapshot(encounter, contract, player.tutorial)) return player;
  const tutorial = player.tutorial;
  const recoveringGuidedDistress = ((contract.profile === 'distress' && tutorial?.script === 4)
    || tutorial?.script === 5) && tutorial.phase === 'fight' && !tutorial.completed;
  const recoveringGuidedClaim = tutorial?.script === 5 && tutorial.phase === 'claim'
    && !tutorial.completed && !(player.contractBoard?.completedOfferIds || []).includes('offer_tutorial_distress')
    && !player.flags?.sparrowFirstRepair;
  const paidFuel = Math.min(1, Number.isFinite(contract.fuelSpent) ? Math.max(0, contract.fuelSpent) : 0);
  return {
    ...player,
    activeContract: null,
    activeEncounter: null,
    ...(recoveringGuidedDistress || recoveringGuidedClaim ? {
      tutorial: {
        ...tutorial,
        ...(recoveringGuidedClaim ? { phase: 'fight', firstWin: false, firstClaim: false } : {}),
        // Carry paid launch fuel into the next acceptance without refunding it.
        contractRecoveryFuelSpent: Math.max(tutorial.contractRecoveryFuelSpent || 0, paidFuel),
      },
    } : {}),
    recoveryEvents: [...(player.recoveryEvents || []), { event: 'contract_recovered', reason: 'invalid_encounter_state' }],
  };
}

/** One committed beat for any saved crew fight: order costs, current station outputs, deterministic advance. */
export function stepEncounter(player, encounter, order = null, now = Date.now()) {
  if (encounter.result) return { ok: false, reason: 'encounter_finished' };
  if (order === 'burn' && (player.wallet?.fuel ?? 0) < BURN.fuel) return { ok: false, reason: 'not_enough_fuel' };
  const rallyCost = order === 'rally' ? (player.flags?.rallyFreeUsed ? RALLY.gems : 0) : 0;
  if ((player.wallet?.gems ?? 0) < rallyCost) return { ok: false, reason: 'not_enough_gems' };

  if (encounter.version === FTL_VERSION) {
    if (order === 'burn' && (player.wallet?.fuel ?? 0) < OVERCHARGE.fuel) return { ok: false, reason: 'not_enough_fuel' };
    const advanced = advanceFtlEncounter(encounter, order);
    if (advanced.ok === false) return { ok: false, reason: advanced.reason };
    let nextPlayer = { ...player, activeEncounter: advanced.state };
    if (order === 'burn') nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, fuel: nextPlayer.wallet.fuel - OVERCHARGE.fuel } };
    if (order === 'rally') {
      nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, gems: nextPlayer.wallet.gems - rallyCost },
        flags: { ...(nextPlayer.flags || {}), rallyFreeUsed: true } };
    }
    return { ok: true, player: nextPlayer, state: advanced.state, events: advanced.events };
  }
  const outputs = stationOutputs(player, now);
  const input = {
    ...encounter,
    assignments: normalizeAssignments(player),
    outputs: Object.fromEntries(STATIONS.map(station => [station, outputs[station].total])),
  };
  const defender = order === 'repel' ? pickDefender(player, now) : null;
  const advanced = advanceEncounter(input, order, { defender });
  if (advanced.ok === false) return { ok: false, reason: advanced.reason };
  let nextPlayer = { ...player, activeEncounter: advanced.state };
  if (order === 'burn') nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, fuel: nextPlayer.wallet.fuel - BURN.fuel } };
  if (order === 'rally') {
    // The first Rally is free, to teach it; later ones cost gems.
    nextPlayer = { ...nextPlayer, wallet: { ...nextPlayer.wallet, gems: nextPlayer.wallet.gems - rallyCost },
      flags: { ...(nextPlayer.flags || {}), rallyFreeUsed: true } };
  }
  return { ok: true, player: nextPlayer, state: advanced.state, events: advanced.events };
}

export function applyEncounterAction(player, { acceptanceId, revision, order = null } = {}, now = Date.now()) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  const step = stepEncounter(player, encounter, order, now);
  if (!step.ok) return { ok: false, reason: step.reason, player };
  let nextContract = { ...contract, revision: contract.revision + 1 };
  let nextPlayer = { ...step.player, activeContract: nextContract };
  if (step.state.result === 'win' || (step.state.result === 'loss' && contract.profile !== 'distress')) {
    const payout = resolveSimulatedCombatPayout(nextPlayer, nextContract, step.state, now);
    nextPlayer = payout.player;
    nextContract = { ...nextContract, stage: 'return', result: payout.result };
    nextPlayer = { ...nextPlayer, activeContract: nextContract };
  }
  return { ok: true, player: nextPlayer, events: step.events,
    analytics: { event: 'encounter_beat', acceptanceId, beat: step.state.beat, order, result: step.state.result } };
}

/** Retarget, hold, or move crew in a contract fight. No time passes, so the revision does not change. */
export function applyEncounterCommand(player, { acceptanceId, revision, command } = {}) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  const applied = applyFtlCommand(encounter, command || {});
  if (!applied.ok) return { ok: false, reason: applied.reason, player };
  return { ok: true, player: { ...player, activeEncounter: applied.state } };
}

export function recoverEncounter(player, { acceptanceId, revision } = {}) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract || contract.encounterMode !== 'crew' || !encounter || !validSnapshot(encounter, contract, player.tutorial)) {
    return { ok: false, reason: 'invalid_encounter_state', player };
  }
  if (contract.acceptanceId !== acceptanceId || encounter.acceptanceId !== acceptanceId || encounter.revision !== Number(revision)) {
    return { ok: false, reason: 'stale_encounter_action', player };
  }
  if (encounter.result !== 'loss') return { ok: false, reason: 'encounter_not_lost', player };
  return {
    ok: true,
    player: {
      ...player,
      activeContract: null,
      activeEncounter: null,
      ship: { ...player.ship, hull: encounter.version === FTL_VERSION ? Math.max(1, encounter.hull)
        : Math.max(1, Math.min(player.ship?.hull ?? 100, encounter.hull)) },
    },
    analytics: { event: 'encounter_recovered', acceptanceId, reason: encounter.lossReason },
  };
}
