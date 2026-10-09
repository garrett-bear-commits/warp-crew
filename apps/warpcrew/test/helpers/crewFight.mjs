import { applyEncounterAction, applyEncounterCommand } from '../../src/systems/encounterState.js';
import { ftlPolicyStep } from '../../src/systems/ftlCombat.js';
import { repelStatus } from '../../src/systems/autoCombat.js';

/** Plays a contract crew fight to its result with a simple defensive order policy (smart targeting in FTL-lite fights). */
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
    // FTL-lite fights: a competent captain targets shields then guns and holds volleys (the 'smart' sim policy).
    if (encounter.version === 3 && encounter.phase === 'combat') {
      for (const command of ftlPolicyStep(encounter, 'smart').commands) {
        const applied = applyEncounterCommand(current, { acceptanceId: encounter.acceptanceId, revision: encounter.revision, command });
        if (applied.ok) current = applied.player;
      }
    }
    const step = applyEncounterAction(current, { acceptanceId: encounter.acceptanceId, revision: current.activeEncounter.revision, order }, now);
    if (!step.ok) throw new Error(`crew fight beat failed: ${step.reason}`);
    current = step.player;
  }
  return current;
}
