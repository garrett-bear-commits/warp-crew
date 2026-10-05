// @ts-nocheck
/**
 * Real-time tempo for crew fights. Beat rules stay deterministic in autoCombat;
 * this only decides how long each committed beat is shown before the next one.
 * Guided (tutorial) fights run 4-5 beats, about 15-20 s with reading time.
 * Normal fights run 6-9 beats at starter outputs, about 36-54 s.
 */
export const FIGHT_BEAT_MS = Object.freeze({ guided: 4000, normal: 6000 });

export function beatDelayMs(encounter) {
  // FTL-lite fights run in real time: one beat is one second of fight.
  if (encounter?.version === 3) return 1000;
  return encounter?.kind === 'normal' ? FIGHT_BEAT_MS.normal : FIGHT_BEAT_MS.guided;
}

/** Guided fights wait for the captain's one order; normal fights always run on their own. */
export function shouldAutoAdvanceFight(player) {
  const encounter = player?.activeEncounter;
  if (!encounter || encounter.result || encounter.phase === 'downed') return false;
  if (encounter.kind === 'normal' && !encounter.guided) return true;
  const tutorial = player.tutorial;
  if (tutorial?.phase !== 'fight' || !(encounter.kind === 'guided' || encounter.guided === true)) return false;
  if (tutorial.script === 4) return encounter.orders?.brace?.used === true;
  if (tutorial.script === 5) return encounter.version === 3 ? encounter.guided === true && encounter.intent?.target === 'weapons'
    : encounter.version === 2 && encounter.orders?.targetWeapons?.used === true;
  return false;
}
