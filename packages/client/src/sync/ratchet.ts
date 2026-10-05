// Depth ratchet (§1 "A save may only get deeper", §5.2 Generations, §5.2 Multi-tab). Pure.
// Keyed by playerId + generation: within a generation the local slot never accepts a shallower
// state; a newer generation resets the floor; an older generation is refused outright. The
// ratchet — not the tab lock — is the safety mechanism. The only bypass is the restore gate
// (`ratchetForce`), which restore/index.ts uses after a trial-deserialise + confirmation.
import type { RatchetFloor } from '../storage/envelope.ts';

export type { RatchetFloor };

export interface RatchetCandidate {
  playerId: string;
  generation: number;
  progress: number;
}

export interface RatchetDecision {
  accept: boolean;
  /** The floor after this decision (unchanged when refused). */
  floor: RatchetFloor;
  reason:
    | 'first'
    | 'other_player'
    | 'newer_generation'
    | 'older_generation'
    | 'deeper_or_equal'
    | 'shallower';
}

export function ratchet(floor: RatchetFloor | null, candidate: RatchetCandidate): RatchetDecision {
  const asFloor = (): RatchetFloor => ({
    playerId: candidate.playerId,
    generation: candidate.generation,
    progress: candidate.progress,
  });
  if (!floor) return { accept: true, floor: asFloor(), reason: 'first' };
  if (floor.playerId !== candidate.playerId)
    return { accept: true, floor: asFloor(), reason: 'other_player' };
  if (candidate.generation > floor.generation)
    return { accept: true, floor: asFloor(), reason: 'newer_generation' };
  if (candidate.generation < floor.generation)
    return { accept: false, floor, reason: 'older_generation' };
  if (candidate.progress >= floor.progress)
    return { accept: true, floor: asFloor(), reason: 'deeper_or_equal' };
  return { accept: false, floor, reason: 'shallower' };
}

/** Restore-gate bypass: sets the floor to the restored snapshot. Human-initiated flows only. */
export function ratchetForce(candidate: RatchetCandidate): RatchetFloor {
  return {
    playerId: candidate.playerId,
    generation: candidate.generation,
    progress: candidate.progress,
  };
}
