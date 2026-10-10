// @ts-nocheck
/**
 * Music: which track plays where, and where each one comes from.
 *
 * Every track is CC0 from OpenGameArt (licence checked on each track's page, 2026-10-09); credits are in
 * public/audio/music/LICENSE.md. Files are built by scripts/build-music.mjs from the downloads named in
 * `source`: loudness-matched, then written as public/audio/music/<file>.ogg (Opus) and .m4a (AAC).
 * `volume` is the mix level on top of that. `resume: true` picks up where the track left off (the ship and the
 * map); fights start from the top.
 */
export const MUSIC_TRACKS = Object.freeze({
  space_city: Object.freeze({
    file: 'space-city', title: 'Space City', artist: 'MintoDog', licence: 'CC0 1.0',
    page: 'https://opengameart.org/content/space-city', source: 'space_city_bpm115_0.ogg',
    volume: 0.85, resume: true,
  }),
  cosmic_navigation: Object.freeze({
    file: 'cosmic-navigation', title: 'Cosmic Navigation', artist: 'Synth-thetic', licence: 'CC0 1.0',
    page: 'https://opengameart.org/content/cosmic-navigation', source: 'cosmic_navigation_loop.flac',
    volume: 1, resume: true,
  }),
  space_battle: Object.freeze({
    file: 'space-battle', title: 'Space Battle', artist: 'MintoDog', licence: 'CC0 1.0',
    page: 'https://opengameart.org/content/space-battle', source: 'space_battle_bpm130_0.ogg',
    volume: 0.8,
  }),
  hard_boss_battle: Object.freeze({
    file: 'hard-boss-battle', title: 'Hard Boss Battle 1', artist: 'MintoDog', licence: 'CC0 1.0',
    page: 'https://opengameart.org/content/hard-boss-battle-1', source: 'hard_boss_battle_1_bpm200_0.ogg',
    volume: 0.8,
  }),
});

/**
 * Scene -> track. Every tab (Ship, Crew, Contracts with its board and Away, Shop, Log) is the hub, so tapping
 * around the menus keeps one song; only the Explore sector map is the star map.
 */
export const SCENE_TRACK = Object.freeze({
  hub: 'space_city',
  map: 'cosmic_navigation',
  fight: 'space_battle',
  boss: 'hard_boss_battle',
});

const fightRunning = encounter => Boolean(encounter) && encounter.result == null && encounter.outcome == null;

/**
 * The music scene for what is on screen: a running fight wins over the tab; a Siege wall fight is a boss.
 * `missionView` is the Contracts tab view being shown (contracts, away or explore).
 */
export function musicScene(player, tab, missionView) {
  if (fightRunning(player?.activeEncounter)) return player?.activeContract?.wall ? 'boss' : 'fight';
  return tab === 'missions' && missionView === 'explore' ? 'map' : 'hub';
}
