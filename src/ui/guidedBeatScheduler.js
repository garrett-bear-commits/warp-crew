import { beatDelayMs, shouldAutoAdvanceFight } from '../systems/fightPacing.js';

/** Drives crew fight beats on a real-time tempo; each beat still commits through sessionAction. */
export function shouldAutoAdvanceGuided(player) {
  return player?.activeEncounter?.kind === 'guided' && shouldAutoAdvanceFight(player);
}

export function createGuidedBeatScheduler({ getPlayer, advance, isBattlePlaying, onSaveFailure, isPaused = () => false,
  setTimer = setTimeout, clearTimer = clearTimeout, delay = player => beatDelayMs(player?.activeEncounter), pausePollMs = 500 }) {
  let timer = null;
  let inFlight = false;
  let generation = 0;

  function schedule() {
    if (timer !== null || inFlight || !shouldAutoAdvanceFight(getPlayer())) return false;
    const currentGeneration = generation;
    const wait = typeof delay === 'function' ? delay(getPlayer()) : delay;
    timer = setTimer(async () => {
      timer = null;
      if (currentGeneration !== generation || !shouldAutoAdvanceFight(getPlayer())) return;
      if (isBattlePlaying()) { schedule(); return; }
      if (isPaused()) { holdUntilResumed(currentGeneration); return; }
      const { acceptanceId, revision } = getPlayer().activeEncounter;
      inFlight = true;
      let result;
      try { result = await advance({ acceptanceId, revision }); }
      finally {
        if (currentGeneration === generation) {
          inFlight = false;
          if (result?.ok) schedule();
          else if (result?.reason === 'save_failed') {
            const current = getPlayer();
            if ((current?.tutorial?.script === 5 || current?.activeEncounter?.kind === 'normal') && shouldAutoAdvanceFight(current)
              && current.activeEncounter.acceptanceId === acceptanceId && current.activeEncounter.revision === revision) {
              onSaveFailure?.({ acceptanceId, revision });
            }
          }
        }
      }
    }, wait);
    return true;
  }

  // While paused, poll cheaply; on resume the beat gets its full on-screen time again.
  function holdUntilResumed(currentGeneration) {
    timer = setTimer(() => {
      timer = null;
      if (currentGeneration !== generation) return;
      if (isPaused()) holdUntilResumed(currentGeneration);
      else schedule();
    }, pausePollMs);
  }

  function cancel() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    inFlight = false;
  }

  return { schedule, cancel };
}
