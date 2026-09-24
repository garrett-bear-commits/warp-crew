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
  // Profile is itself validated data, not tutorial identity. Keep recovery
  // available if it is lost, with a coherent acceptance fallback for a lost offer ID.
  const tutorialContractId = `contract_${contract.boardDay}_distress`;
  const tutorialIdentity = contract.offerId === 'offer_tutorial_distress'
    || (contract.id === tutorialContractId
      && typeof contract.acceptanceId === 'string'
      && contract.acceptanceId.startsWith(`${tutorialContractId}:`)
      && /^[1-9]\d*$/.test(contract.acceptanceId.slice(tutorialContractId.length + 1))
      && contract.destinationId === 'lane_a');
  // A resolved payout is self-contained. Catalog retirement must not destroy
  // the committed result merely because the battle can no longer be replayed.
  const encounterValid = contract.stage === 'return'
    || contract.encounterId == null || encounterById(contract.encounterId).id === contract.encounterId;
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
    && (!tutorialIdentity || contract.profile === 'distress')
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
    const tutorial = player.tutorial;
    const recoveringTutorial = tutorialIdentity && tutorial?.script === 3 && !tutorial.completed && !tutorial.dismissed;
    const alreadyRewarded = (player.contractBoard?.completedOfferIds || []).includes('offer_tutorial_distress') || player.flags?.sparrowFirstRepair;
    const recoveringGuidedFight = tutorialIdentity && [4, 5].includes(tutorial?.script)
      && tutorial?.phase === 'fight' && !tutorial.completed;
    const recoveringGuidedClaim = tutorialIdentity && tutorial?.script === 5 && tutorial?.phase === 'claim'
      && contract.stage === 'return' && !tutorial.completed && !alreadyRewarded;
    const recoveryPhase = tutorial?.hiredThird ? 'choose' : alreadyRewarded || tutorial?.firstCombat ? 'recruit' : 'distress';
    return {
      ...player,
      activeContract: null,
      ...(recoveringTutorial ? {
        tutorial: {
          ...tutorial,
          phase: recoveryPhase,
          // Retain paid launch credit without refunding currency. A new
          // acceptance consumes this marker, preserving its own fresh identity.
          contractRecoveryFuelSpent: recoveryPhase === 'distress'
            ? Math.max(tutorial.firstTravel ? 1 : 0, Number.isFinite(contract.fuelSpent) ? Math.max(0, contract.fuelSpent) : 0) : 0,
          slot3Unlocked: recoveryPhase === 'recruit' || recoveryPhase === 'choose' || tutorial.slot3Unlocked,
        },
        crewSlots: recoveryPhase === 'recruit' || recoveryPhase === 'choose' ? Math.max(3, player.crewSlots || 2) : player.crewSlots,
      } : {}),
      ...(recoveringGuidedFight || recoveringGuidedClaim ? {
        tutorial: { ...tutorial,
          ...(recoveringGuidedClaim ? { phase: 'fight', firstWin: false, firstClaim: false } : {}),
          contractRecoveryFuelSpent: Math.max(tutorial.contractRecoveryFuelSpent || 0,
            Math.min(1, Number.isFinite(contract.fuelSpent) ? Math.max(0, contract.fuelSpent) : 0)),
        },
        activeEncounter: null,
      } : {}),
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
