// Saved bridge between a contract and the deterministic crew-run fight.
import { startEncounter, advanceEncounter } from './autoCombat.js';
import { normalizeAssignments, stationOutputs } from './stations.js';
import { resolveSimulatedCombatPayout } from './contractRewards.js';

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
    || (contract.profile === 'reliable' && contract.choiceId === 'push' && contract.encounterId === 'pirate_scout')
  );
}

/** Called only by the action that freshly enters confrontation. */
export function beginContractEncounter(player, now = Date.now()) {
  const contract = player?.activeContract;
  if (player?.activeEncounter || !eligibleContract(player, contract)) return player;
  const kind = contract.profile === 'distress' ? 'guided' : 'normal';
  const encounter = startEncounter({
    acceptanceId: contract.acceptanceId,
    encounterId: contract.encounterId,
    kind,
    ruleset: contract.profile === 'distress' && player.tutorial?.script === 4
      ? 'v1' : contract.encounterId === 'pirate_scout' ? 'v2' : 'v1',
    seed: contract.routeSeed,
    assignments: normalizeAssignments(player),
    outputs: stationOutputs(player, now),
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

function validSnapshot(encounter, contract, tutorial) {
  // The only new-mode entry paths are distress Launch (one route action) and
  // reliable Push (Launch plus choice). Every later contract revision is a beat.
  const entryRevision = contract.profile === 'distress' ? 1
    : contract.profile === 'reliable' && contract.choiceId === 'push' ? 2 : null;
  if (!encounter || contract.encounterMode !== 'crew' || ![1, 2].includes(encounter.version) || encounter.acceptanceId !== contract.acceptanceId
    || entryRevision === null
    || (contract.profile === 'distress'
      && (tutorial?.script === 4 ? encounter.version !== 1
        : tutorial?.script === 5 ? encounter.version !== 2 : true))
    || encounter.encounterId !== contract.encounterId || !['guided', 'normal'].includes(encounter.kind)
    || (contract.profile === 'distress' ? encounter.kind !== 'guided' : encounter.kind !== 'normal')
    || !Number.isInteger(encounter.seed) || encounter.seed !== contract.routeSeed
    || !Number.isInteger(encounter.beat) || encounter.beat < 0
    || !Number.isInteger(encounter.revision) || encounter.revision !== encounter.beat
    || contract.revision !== entryRevision + encounter.beat
    || !Number.isInteger(encounter.eventIndex) || encounter.eventIndex < encounter.beat
    || encounter.phase !== (encounter.result === null ? 'combat' : 'complete')
    || !numberIn(encounter.hull, 1, 30) || !numberIn(encounter.shield, 0, 12)
    || !record(encounter.enemy) || !numberIn(encounter.enemy.hull, 0, 42)
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
    || !record(encounter.assignments)
    || !validOrders(encounter)
    || !validOrderWindow(encounter.orderWindow, encounter)
    || (encounter.result !== null && !['win', 'loss'].includes(encounter.result))) return false;
  if (encounter.result === 'win' && (encounter.beat === 0 || encounter.enemy.hull !== 0 || encounter.orderWindow !== null)) return false;
  if (encounter.result === 'loss' && (encounter.beat === 0 || encounter.hull !== 1 || encounter.enemy.hull <= 0 || encounter.orderWindow !== null)) return false;
  if (contract.stage === 'return') return encounter.result === 'win' && contract.result?.success === true
    && contract.result.hullLoss === 30 - encounter.hull;
  return contract.stage === 'confrontation' && encounter.result !== 'win';
}

/** Invalid new fights cannot become legacy fights or produce a claim. */
export function normalizeEncounterState(player) {
  const contract = player?.activeContract;
  const encounter = player?.activeEncounter;
  if (!contract) return encounter ? { ...player, activeEncounter: null } : player;
  if (!encounter && contract.encounterMode !== 'crew') return player;
  if (validSnapshot(encounter, contract, player.tutorial)) return player;
  const tutorial = player.tutorial;
  const recoveringGuidedDistress = contract.profile === 'distress'
    && [4, 5].includes(tutorial?.script) && tutorial.phase === 'fight' && !tutorial.completed;
  const paidFuel = Number.isFinite(contract.fuelSpent) ? Math.max(0, contract.fuelSpent) : 0;
  return {
    ...player,
    activeContract: null,
    activeEncounter: null,
    ...(recoveringGuidedDistress ? {
      tutorial: {
        ...tutorial,
        // Carry paid launch fuel into the next acceptance without refunding it.
        contractRecoveryFuelSpent: Math.max(tutorial.contractRecoveryFuelSpent || 0, paidFuel),
      },
    } : {}),
    recoveryEvents: [...(player.recoveryEvents || []), { event: 'contract_recovered', reason: 'invalid_encounter_state' }],
  };
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
  if (encounter.result) return { ok: false, reason: 'encounter_finished', player };

  const outputs = stationOutputs(player, now);
  const input = {
    ...encounter,
    assignments: normalizeAssignments(player),
    outputs: Object.fromEntries(STATIONS.map(station => [station, outputs[station].total])),
  };
  const advanced = advanceEncounter(input, order);
  if (advanced.ok === false) return { ok: false, reason: advanced.reason, player };
  let nextContract = { ...contract, revision: contract.revision + 1 };
  let nextPlayer = { ...player, activeEncounter: advanced.state, activeContract: nextContract };
  if (advanced.state.result === 'win') {
    const payout = resolveSimulatedCombatPayout(nextPlayer, nextContract, advanced.state);
    nextPlayer = payout.player;
    nextContract = { ...nextContract, stage: 'return', result: payout.result };
    nextPlayer = { ...nextPlayer, activeContract: nextContract };
  }
  return { ok: true, player: nextPlayer, events: advanced.events,
    analytics: { event: 'encounter_beat', acceptanceId, beat: advanced.state.beat, order, result: advanced.state.result } };
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
      ship: { ...player.ship, hull: Math.max(1, Math.min(player.ship?.hull ?? 100, encounter.hull)) },
    },
    analytics: { event: 'encounter_recovered', acceptanceId, reason: encounter.lossReason },
  };
}
