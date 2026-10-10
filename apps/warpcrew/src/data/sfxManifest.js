// @ts-nocheck
/**
 * Sound effects: Kenney CC0 packs (see public/audio/LICENSE.md).
 * `SFX` is what the game asks for by name; each name picks one of its clips.
 * `SFX_CLIPS` says how each clip was cut from its source (scripts/build-audio.mjs).
 * Runtime files: public/audio/<clip>.ogg (Opus) and public/audio/<clip>.m4a (AAC, for WebKit).
 */

/** name -> { clips, volume (0..1 mix level), voices (max at once), gap (min seconds between starts) } */
export const SFX = Object.freeze({
  // Fight
  shot_burst: { clips: ['shot_burst_1', 'shot_burst_2', 'shot_burst_3'], volume: 0.5, voices: 3, gap: 0.05 },
  shot_heavy: { clips: ['shot_heavy_1', 'shot_heavy_2'], volume: 0.65, voices: 2, gap: 0.06 },
  shot_enemy: { clips: ['shot_enemy_1', 'shot_enemy_2'], volume: 0.45, voices: 3, gap: 0.05 },
  shield: { clips: ['shield_1', 'shield_2'], volume: 0.5, voices: 2, gap: 0.08 },
  hit: { clips: ['hit_1', 'hit_2', 'hit_3'], volume: 0.8, voices: 2, gap: 0.06 },
  hit_enemy: { clips: ['hit_enemy_1', 'hit_enemy_2'], volume: 0.45, voices: 2, gap: 0.06 },
  fire: { clips: ['fire'], volume: 0.55, voices: 1, gap: 0.4 },
  fire_out: { clips: ['fire_out'], volume: 0.5, voices: 1, gap: 0.3 },
  boom: { clips: ['boom'], volume: 0.9, voices: 1, gap: 0.5 },
  hull_down: { clips: ['hull_down'], volume: 0.85, voices: 1, gap: 0.5 },
  alarm: { clips: ['alarm'], volume: 0.5, voices: 1, gap: 6 },
  clamp: { clips: ['clamp'], volume: 0.6, voices: 1, gap: 0.5 },
  boarders: { clips: ['boarders'], volume: 0.6, voices: 1, gap: 0.5 },
  board: { clips: ['board'], volume: 0.6, voices: 1, gap: 0.3 },
  overcharge: { clips: ['overcharge'], volume: 0.6, voices: 1, gap: 0.3 },
  rally: { clips: ['rally'], volume: 0.6, voices: 1, gap: 0.3 },
  lock: { clips: ['lock'], volume: 0.45, voices: 1, gap: 0.5 },
  win: { clips: ['win'], volume: 0.6, voices: 1, gap: 0.5 },
  // Enemy factions and twists (Phase 3): the same Kenney clips, mixed for their moment.
  missile: { clips: ['launch'], volume: 0.4, voices: 1, gap: 0.3 },
  drones: { clips: ['shot_burst_1', 'shot_burst_2', 'shot_burst_3'], volume: 0.28, voices: 3, gap: 0.03 },
  ion_shot: { clips: ['shield_2'], volume: 0.4, voices: 1, gap: 0.2 },
  ion_lock: { clips: ['lock'], volume: 0.5, voices: 1, gap: 0.4 },
  cloak: { clips: ['jump'], volume: 0.35, voices: 1, gap: 1 },
  decloak: { clips: ['arrive'], volume: 0.35, voices: 1, gap: 1 },
  regrow: { clips: ['fire_out'], volume: 0.18, voices: 1, gap: 0.9 },
  wave: { clips: ['alarm'], volume: 0.45, voices: 1, gap: 2 },
  // Flight and ship
  launch: { clips: ['launch'], volume: 0.55, voices: 1, gap: 1 },
  jump: { clips: ['jump'], volume: 0.55, voices: 1, gap: 0.5 },
  arrive: { clips: ['arrive'], volume: 0.5, voices: 1, gap: 0.3 },
  // Interface
  tap: { clips: ['tap'], volume: 0.35, voices: 2, gap: 0.04 },
  confirm: { clips: ['confirm'], volume: 0.45, voices: 1, gap: 0.08 },
  error: { clips: ['error'], volume: 0.45, voices: 1, gap: 0.15 },
  coin: { clips: ['coin'], volume: 0.45, voices: 2, gap: 0.08 },
  card: { clips: ['card'], volume: 0.45, voices: 1, gap: 0.2 },
  beacon: { clips: ['beacon'], volume: 0.4, voices: 1, gap: 0.06 },
});

/** Older names the code used for the synth stings. */
export const SFX_ALIASES = Object.freeze({ pew: 'shot_burst' });

const SCI = 'kenney_sci-fi-sounds';
const IMP = 'kenney_impact-sounds';
const UI = 'kenney_interface-sounds';

/**
 * clip -> source and cut. `start` skips into the source; `dur` caps the length; `fadeIn`/`fadeOut` shape it;
 * `repeat` loops it with `pad` seconds of silence between. `alt` is a sci-fi-pack stand-in the build uses
 * only when the clip's own pack is not on disk (see scripts/build-audio.mjs).
 */
export const SFX_CLIPS = Object.freeze({
  shot_burst_1: { pack: SCI, file: 'laserSmall_001', dur: 0.28, fadeOut: 0.08 },
  shot_burst_2: { pack: SCI, file: 'laserSmall_002', dur: 0.28, fadeOut: 0.08 },
  shot_burst_3: { pack: SCI, file: 'laserSmall_003', dur: 0.28, fadeOut: 0.08 },
  shot_heavy_1: { pack: SCI, file: 'laserLarge_000', dur: 0.5, fadeOut: 0.2 },
  shot_heavy_2: { pack: SCI, file: 'laserLarge_004', dur: 0.5, fadeOut: 0.2 },
  shot_enemy_1: { pack: SCI, file: 'laserRetro_000', dur: 0.24, fadeOut: 0.08 },
  shot_enemy_2: { pack: SCI, file: 'laserRetro_001', dur: 0.24, fadeOut: 0.08 },
  shield_1: { pack: SCI, file: 'forceField_001', dur: 0.5, fadeOut: 0.2 },
  shield_2: { pack: SCI, file: 'forceField_003', dur: 0.5, fadeOut: 0.2 },
  hit_1: { pack: IMP, file: 'impactPlate_heavy_001', dur: 0.35, fadeOut: 0.12,
    alt: { pack: SCI, file: 'impactMetal_000', dur: 0.4, fadeOut: 0.15 } },
  hit_2: { pack: IMP, file: 'impactPlate_heavy_003', dur: 0.35, fadeOut: 0.12,
    alt: { pack: SCI, file: 'explosionCrunch_000', dur: 0.3, fadeOut: 0.15 } },
  hit_3: { pack: SCI, file: 'impactMetal_001', dur: 0.45, fadeOut: 0.2 },
  hit_enemy_1: { pack: IMP, file: 'impactMetal_heavy_002', dur: 0.12, fadeOut: 0.04,
    alt: { pack: SCI, file: 'impactMetal_004', dur: 0.15, fadeOut: 0.06 } },
  hit_enemy_2: { pack: IMP, file: 'impactMetal_heavy_004', dur: 0.13, fadeOut: 0.04,
    alt: { pack: SCI, file: 'impactMetal_002', dur: 0.15, fadeOut: 0.06 } },
  fire: { pack: SCI, file: 'thrusterFire_003', dur: 0.9, fadeIn: 0.05, fadeOut: 0.45 },
  fire_out: { pack: SCI, file: 'slime_000', dur: 0.5, fadeOut: 0.2 },
  boom: { pack: SCI, file: 'explosionCrunch_001', dur: 1.2, fadeOut: 0.5 },
  hull_down: { pack: SCI, file: 'lowFrequency_explosion_001', dur: 0.9, fadeOut: 0.4 },
  alarm: { pack: UI, file: 'error_006', dur: 0.26, fadeOut: 0.04, repeat: 2, pad: 0.1,
    alt: { pack: SCI, file: 'computerNoise_003', dur: 0.16, fadeIn: 0.01, fadeOut: 0.03, repeat: 3, pad: 0.08 } },
  clamp: { pack: IMP, file: 'impactBell_heavy_002', dur: 0.6, fadeOut: 0.25,
    alt: { pack: SCI, file: 'impactMetal_003', dur: 0.6, fadeOut: 0.25 } },
  boarders: { pack: SCI, file: 'doorOpen_001', dur: 0.4, fadeOut: 0.1 },
  board: { pack: SCI, file: 'doorClose_001', dur: 0.53, fadeOut: 0.06 },
  overcharge: { pack: UI, file: 'maximize_006', dur: 0.38, fadeOut: 0.08,
    alt: { pack: SCI, file: 'engineCircular_001', dur: 0.6, fadeIn: 0.1, fadeOut: 0.3 } },
  rally: { pack: UI, file: 'maximize_009', dur: 0.22, fadeOut: 0.05,
    alt: { pack: SCI, file: 'engineCircular_004', dur: 0.5, fadeIn: 0.05, fadeOut: 0.25 } },
  lock: { pack: SCI, file: 'computerNoise_001', dur: 0.45, fadeIn: 0.02, fadeOut: 0.15 },
  win: { pack: UI, file: 'confirmation_004', dur: 0.49, fadeOut: 0.12,
    alt: { pack: SCI, file: 'computerNoise_000', start: 1, dur: 0.45, fadeIn: 0.01, fadeOut: 0.15 } },
  launch: { pack: SCI, file: 'spaceEngineLarge_000', dur: 1.8, fadeIn: 0.25, fadeOut: 0.9 },
  jump: { pack: SCI, file: 'spaceEngineSmall_000', dur: 1.0, fadeIn: 0.1, fadeOut: 0.6 },
  arrive: { pack: SCI, file: 'doorOpen_000', dur: 0.35, fadeOut: 0.1 },
  tap: { pack: UI, file: 'select_002', dur: 0.04, fadeOut: 0.01,
    alt: { pack: SCI, file: 'computerNoise_002', start: 0.5, dur: 0.035, fadeIn: 0.003, fadeOut: 0.01 } },
  confirm: { pack: UI, file: 'confirmation_001', dur: 0.29, fadeOut: 0.06,
    alt: { pack: SCI, file: 'computerNoise_000', dur: 0.14, fadeIn: 0.005, fadeOut: 0.04 } },
  error: { pack: UI, file: 'error_004', dur: 0.1, fadeOut: 0.02,
    alt: { pack: SCI, file: 'spaceEngineSmall_000', dur: 0.1, fadeIn: 0.005, fadeOut: 0.02, repeat: 2, pad: 0.05 } },
  coin: { pack: UI, file: 'glass_002', dur: 0.13, fadeOut: 0.04,
    alt: { pack: SCI, file: 'doorOpen_000', dur: 0.12, fadeOut: 0.06 } },
  card: { pack: UI, file: 'open_002', dur: 0.31, fadeOut: 0.06,
    alt: { pack: SCI, file: 'doorOpen_002', dur: 0.3, fadeOut: 0.08 } },
  beacon: { pack: UI, file: 'toggle_002', dur: 0.14, fadeOut: 0.03,
    alt: { pack: SCI, file: 'computerNoise_001', start: 2, dur: 0.08, fadeIn: 0.003, fadeOut: 0.02 } },
});

export const SFX_FORMATS = Object.freeze(['ogg', 'm4a']);
