// @ts-nocheck
/**
 * Real-time tempo for crew fights. Beat rules stay deterministic in autoCombat;
 * this only decides how long each committed beat is shown before the next one.
 * Guided (tutorial) fights run 4-5 beats, about 15-20 s with reading time.
 * Normal fights run 6-9 beats at starter outputs, about 36-54 s.
 */
export const FIGHT_BEAT_MS = Object.freeze({ guided: 4000, normal: 6000 });

export function beatDelayMs(encounter) {
  return encounter?.kind === 'normal' ? FIGHT_BEAT_MS.normal : FIGHT_BEAT_MS.guided;
}

/** Guided fights wait for the captain's one order; normal fights always run on their own. */
export function shouldAutoAdvanceFight(player) {
  const encounter = player?.activeEncounter;
  if (!encounter || encounter.result) return false;
  if (encounter.kind === 'normal') return true;
  const tutorial = player.tutorial;
  if (tutorial?.phase !== 'fight' || encounter.kind !== 'guided') return false;
  if (tutorial.script === 4) return encounter.orders?.brace?.used === true;
  if (tutorial.script === 5) return encounter.version === 2 && encounter.orders?.targetWeapons?.used === true;
  return false;
}
