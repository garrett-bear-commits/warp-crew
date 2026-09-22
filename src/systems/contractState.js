// @ts-nocheck
/** Dependency-free persistence schema. Catalog checks are supplied by callers. */
const CONTRACT_STAGES = new Set(['briefing', 'choice', 'confrontation', 'return', 'claimed']);
const CONTRACT_PROFILES_IDS = new Set(['reliable', 'risky', 'strange', 'distress']);

export function validContractResult(result) {
  const rewards = result?.rewards;
  return Boolean(
    result
    && typeof result.success === 'boolean'
    && rewards
    && ['credits', 'medals', 'reputation', 'gems', 'fuel'].every((key) => (
      typeof rewards[key] === 'number' && Number.isFinite(rewards[key])
    ))
    && typeof result.hullLoss === 'number'
    && Number.isFinite(result.hullLoss)
    && (result.injuredCrewId == null || typeof result.injuredCrewId === 'string')
    && (result.storyFlag == null || typeof result.storyFlag === 'string')
    && typeof result.summary === 'string'
  );
}

export function normalizeContractState(player, { nodes, encounterById }) {
  const contract = player?.activeContract;
  if (!contract) return player;
  const encounterValid = contract.encounterId == null || encounterById(contract.encounterId).id === contract.encounterId;
  const favoredTraitValid = Boolean(
    contract.favoredTrait
    && ['role', 'system'].includes(contract.favoredTrait.kind)
    && typeof contract.favoredTrait.id === 'string'
    && typeof contract.favoredTrait.label === 'string'
  );
  const routeOutcomeValid = Boolean(contract.routeOutcome && typeof contract.routeOutcome.kind === 'string');
  const secureOutcomeValid = Boolean(contract.secureOutcome && typeof contract.secureOutcome.kind === 'string');
  const valid = Boolean(
    typeof contract.id === 'string'
    && typeof contract.acceptanceId === 'string'
    && contract.acceptanceId.length > 0
    && typeof contract.offerId === 'string'
    && typeof contract.boardDay === 'string'
    && CONTRACT_PROFILES_IDS.has(contract.profile)
    && typeof contract.title === 'string'
    && nodes[contract.destinationId]
    && favoredTraitValid
    && routeOutcomeValid
    && secureOutcomeValid
    && CONTRACT_STAGES.has(contract.stage)
    && Number.isInteger(contract.revision)
    && contract.revision >= 0
    && Number.isInteger(contract.routeSeed)
    && encounterValid
    && (contract.choiceId == null || typeof contract.choiceId === 'string')
    && (contract.storyFlag == null || typeof contract.storyFlag === 'string')
    && (contract.orderId == null || ['brace', 'burn', 'board'].includes(contract.orderId))
    && (contract.stage !== 'confrontation' || contract.encounterId)
    && (contract.stage !== 'return' || validContractResult(contract.result))
  );
  if (!valid) {
    return {
      ...player,
      activeContract: null,
      recoveryEvents: [
        ...(player?.recoveryEvents || []),
        { event: 'contract_recovered', reason: 'invalid_contract_state' },
      ],
    };
  }
  return {
    ...player,
    activeContract: {
      ...contract,
      choiceId: contract.choiceId || null,
      encounterId: contract.encounterId || null,
      orderId: contract.orderId || null,
      result: contract.result || null,
      fuelSpent: Number(contract.fuelSpent) || 0,
    },
  };
}
