/** Drives only the post-order guided crew beats; each beat still commits through sessionAction. */
export function shouldAutoAdvanceGuided(player) {
  const tutorial = player?.tutorial;
  const encounter = player?.activeEncounter;
  if (tutorial?.phase !== 'fight' || encounter?.kind !== 'guided' || encounter.result) return false;
  if (tutorial.script === 4) return encounter.orders?.brace?.used === true;
  if (tutorial.script === 5) return encounter.version === 2 && encounter.orders?.targetWeapons?.used === true;
  return false;
}

export function createGuidedBeatScheduler({ getPlayer, advance, isBattlePlaying, setTimer = setTimeout, clearTimer = clearTimeout, delay = 420 }) {
  let timer = null;
  let inFlight = false;
  let generation = 0;

  function schedule() {
    if (timer !== null || inFlight || !shouldAutoAdvanceGuided(getPlayer())) return false;
    const currentGeneration = generation;
    timer = setTimer(async () => {
      timer = null;
      if (currentGeneration !== generation || !shouldAutoAdvanceGuided(getPlayer())) return;
      if (isBattlePlaying()) { schedule(); return; }
      const { acceptanceId, revision } = getPlayer().activeEncounter;
      inFlight = true;
      let result;
      try { result = await advance({ acceptanceId, revision }); }
      finally {
        if (currentGeneration === generation) {
          inFlight = false;
          if (result?.ok) schedule();
        }
      }
    }, delay);
    return true;
  }

  function cancel() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    inFlight = false;
  }

  return { schedule, cancel };
}
