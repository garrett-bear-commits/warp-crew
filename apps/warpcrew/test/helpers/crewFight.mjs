import { applyEncounterAction } from '../../src/systems/encounterState.js';
import { repelStatus } from '../../src/systems/autoCombat.js';

/** Plays a contract crew fight to its result with a simple defensive order policy. */
export function finishCrewFight(player, now = Date.now()) {
  let current = player;
  for (let i = 0; i < 200 && current.activeEncounter && !current.activeEncounter.result; i++) {
    const encounter = current.activeEncounter;
    const open = encounter.orderWindow?.availableOrders || [];
    // FTL-lite (v3) fights run on their own; only a downed crew needs an answer.
    const order = encounter.phase === 'downed' ? 'concede' : encounter.version === 3 ? null
      : repelStatus(encounter).available ? 'repel'
      : open.includes('target_weapons') ? 'target_weapons'
      : open.includes('brace') ? 'brace'
        : open.includes('repair') && encounter.hull <= 18 ? 'repair' : null;
    const step = applyEncounterAction(current, { acceptanceId: encounter.acceptanceId, revision: encounter.revision, order }, now);
    if (!step.ok) throw new Error(`crew fight beat failed: ${step.reason}`);
    current = step.player;
  }
  return current;
}
