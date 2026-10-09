// Music: the CC0 tracks that ship, which scene plays what, and the two-deck player (crossfades, resume, mute,
// hidden pages, format fallback, iOS gesture priming). Design notes: src/ui/music.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { MUSIC_TRACKS, SCENE_TRACK, musicScene } from '../src/data/musicManifest.js';
import { createMusicPlayer, trackUrls, MUSIC_MUTE_KEY, FADE_S } from '../src/ui/music.js';

test('every scene has a credited CC0 or CC BY track that ships in both formats, inside the size budget', async () => {
  const license = await readFile(new URL('../public/audio/music/LICENSE.md', import.meta.url), 'utf8');
  for (const scene of ['hub', 'map', 'fight', 'boss']) assert.ok(MUSIC_TRACKS[SCENE_TRACK[scene]], `${scene} has a track`);
  let ogg = 0;
  for (const [id, track] of Object.entries(MUSIC_TRACKS)) {
    assert.match(track.licence, /^CC(0 1\.0| BY [34]\.0)$/, `${id}: CC0 or CC BY only`);
    assert.match(track.page, /^https:\/\//);
    assert.ok(track.volume > 0 && track.volume <= 1);
    assert.ok(license.includes(track.title) && license.includes(track.artist) && license.includes(track.page), `${id} is credited`);
    assert.ok(Object.values(SCENE_TRACK).includes(id), `${id} is used by a scene`);
    const urls = trackUrls(track, p => p);
    assert.equal(urls.ogg, `/audio/music/${track.file}.ogg`);
    for (const ext of ['ogg', 'm4a']) {
      const { size } = await stat(new URL(`../public${urls[ext]}`, import.meta.url));
      assert.ok(size > 100 * 1024 && size < 2.5 * 1024 * 1024, `${track.file}.${ext} is a real track under 2.5 MB`);
      if (ext === 'ogg') ogg += size;
    }
  }
  assert.ok(ogg < 7 * 1024 * 1024, `all music in one format stays under 7 MB (is ${(ogg / 1048576).toFixed(1)} MB)`);
});

test('the scene follows what is on screen: a running fight beats the tab, a Siege wall fight is a boss', () => {
  assert.equal(musicScene({}, 'ship'), 'hub');
  assert.equal(musicScene({}, 'crew'), 'hub');
  assert.equal(musicScene({}, 'missions'), 'map');
  assert.equal(musicScene(null, undefined), 'hub');
  const fighting = { activeEncounter: { result: null }, activeContract: { stage: 'encounter' } };
  assert.equal(musicScene(fighting, 'missions'), 'fight');
  assert.equal(musicScene({ ...fighting, activeContract: { wall: { id: 'veil' } } }, 'ship'), 'boss');
  assert.equal(musicScene({ activeEncounter: { result: 'won' } }, 'ship'), 'hub', 'a won fight waiting to be claimed is back to the ship theme');
  assert.equal(musicScene({ activeEncounter: { outcome: 'lost' } }, 'missions'), 'map');
});

// --- A fake browser: <audio> elements, Web Audio gains, timers, storage. -------------------------------------
function world({ webAudio = true, storage = {}, failElements = false } = {}) {
  const log = [];
  const els = [];
  const timers = [];
  const data = { ...storage };
  const createElement = () => {
    if (failElements) throw new Error('no audio here');
    const el = {
      id: els.length, src: '', loop: false, preload: '', volume: 1, currentTime: 0, paused: true, handlers: {},
      play() { this.paused = false; log.push(['play', this.id, this.src]); return Promise.resolve(); },
      pause() { this.paused = true; log.push(['pause', this.id]); },
      addEventListener(type, fn) { this.handlers[type] = fn; },
    };
    els.push(el);
    return el;
  };
  const gains = [];
  const ctx = {
    state: 'running', currentTime: 0, destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} }, connect() {} }; gains.push(g); return g; },
    createMediaElementSource(el) { return { el, connect() {} }; },
  };
  const doc = { hidden: false, handlers: {}, addEventListener(t, fn) { this.handlers[t] = fn; } };
  const player = createMusicPlayer({
    createContext: () => (webAudio ? ctx : null), createElement, doc, resolveUrl: p => p, formats: ['ogg', 'm4a'],
    storage: { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  const runTimers = () => { while (timers.length) timers.shift().fn(); };
  const deckOf = id => player._state().decks.find(d => d.trackId === id);
  const level = deck => (deck.gain ? deck.gain.gain.value : deck.el.volume);
  return { player, log, els, data, doc, runTimers, deckOf, level, gains };
}
const file = id => `/audio/music/${MUSIC_TRACKS[id].file}.ogg`;

test('nothing plays before a tap; the first tap plays the scene and primes the spare deck with the fight track', () => {
  const w = world();
  w.player.setScene('hub');
  assert.equal(w.log.length, 0, 'silent before any gesture');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  const spare = w.deckOf(SCENE_TRACK.fight);
  assert.ok(hub && spare && hub !== spare, 'two decks: the ship theme and the fight theme');
  assert.equal(hub.el.paused, false);
  assert.equal(hub.el.loop, true);
  assert.equal(w.level(hub), MUSIC_TRACKS[SCENE_TRACK.hub].volume);
  assert.deepEqual(w.log.filter(e => e[1] === spare.el.id).map(e => e[0]), ['play', 'pause'], 'the spare deck played and paused inside the tap');
  assert.ok(hub.primed && spare.primed);
  assert.equal(w.player._state().current, SCENE_TRACK.hub);
});

test('a fight crossfades in from the top; the ship theme resumes where it left off', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  hub.el.currentTime = 42;
  w.player.setScene('fight');
  const fight = w.deckOf(SCENE_TRACK.fight);
  assert.equal(fight.el.paused, false);
  assert.equal(fight.el.currentTime, 0);
  assert.equal(w.level(hub), 0, 'the ship theme fades out');
  assert.equal(hub.el.paused, false, 'still fading');
  w.runTimers();
  assert.equal(hub.el.paused, true, 'paused once the fade is done');
  fight.el.currentTime = 30;
  w.player.setScene('hub');
  assert.equal(hub.el.currentTime, 42, 'resumed at its place');
  assert.equal(hub.el.paused, false);
  w.player.setScene('fight');
  assert.equal(fight.el.currentTime, 0, 'every fight starts from the top');
});

test('the ship theme keeps its place even when its deck is reloaded with another track', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const deckA = w.deckOf(SCENE_TRACK.hub);
  deckA.el.currentTime = 50;
  w.player.setScene('map');      // the spare deck takes the map track
  w.runTimers();
  w.player.setScene('fight');    // the fight lands on deck A, which held the ship theme
  assert.equal(deckA.trackId, SCENE_TRACK.fight);
  assert.equal(deckA.el.src, file(SCENE_TRACK.fight));
  w.runTimers();
  w.player.setScene('hub');
  const hub = w.deckOf(SCENE_TRACK.hub);
  assert.equal(hub.el.currentTime, 50, 'back at 0:50');
  assert.equal(w.player._state().decks.length, 2, 'never more than two decks');
});

test('quick scene changes mid-fade still keep the ship theme in its place', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  w.deckOf(SCENE_TRACK.hub).el.currentTime = 42;
  w.player.setScene('fight');
  w.player.setScene('map');      // lands on the ship theme's deck before its fade-out finished
  w.runTimers();
  w.player.setScene('hub');
  assert.equal(w.deckOf(SCENE_TRACK.hub).el.currentTime, 42);
});

test('the music switch stops and restarts the scene and is remembered on this device', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  assert.equal(w.player.toggleMuted(), true);
  assert.equal(hub.el.paused, true);
  assert.equal(w.data[MUSIC_MUTE_KEY], '1');
  w.player.setScene('fight');
  assert.ok(w.els.every(el => el.paused), 'scene changes stay quiet while off');
  const hubSrc = hub.el.src;
  w.player.toggleMuted();
  assert.equal(w.deckOf(SCENE_TRACK.fight).el.paused, false, 'on again: the current scene plays');
  assert.equal(hub.el.src, hubSrc, 'on the deck already holding it: the ship theme was not swapped out');
  const again = world({ storage: { [MUSIC_MUTE_KEY]: '1' } });
  again.player.setScene('hub');
  again.player.unlock();
  assert.ok(again.player.isMuted());
  assert.ok(again.els.every(el => el.paused), 'off survives a reload');
});

test('a hidden page goes quiet and picks up again when shown', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  w.doc.hidden = true;
  w.doc.handlers.visibilitychange();
  assert.equal(hub.el.paused, true);
  w.player.setScene('fight');
  assert.ok(w.els.every(el => el.paused));
  w.doc.hidden = false;
  w.doc.handlers.visibilitychange();
  assert.equal(w.deckOf(SCENE_TRACK.fight).el.paused, false);
});

test('a track that will not load tries the other format once; no Web Audio or no <audio> never breaks the game', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  hub.el.handlers.error();
  assert.equal(hub.el.src, `/audio/music/${MUSIC_TRACKS[SCENE_TRACK.hub].file}.m4a`);
  assert.equal(hub.el.paused, false);
  hub.el.handlers.error();
  assert.equal(hub.el.src, `/audio/music/${MUSIC_TRACKS[SCENE_TRACK.hub].file}.m4a`, 'only once');

  const plain = world({ webAudio: false });
  plain.player.setScene('hub');
  plain.player.unlock();
  const deck = plain.deckOf(SCENE_TRACK.hub);
  assert.ok(deck.el.volume > 0 && deck.el.volume < 1, 'falls back to the element volume');
  plain.player.setScene('fight');
  assert.equal(deck.el.volume, 0);

  const none = world({ failElements: true });
  none.player.setScene('hub');
  assert.doesNotThrow(() => { none.player.unlock(); none.player.setScene('fight'); none.player.toggleMuted(); });
});

test('a fade-out that finishes after its deck came back does not pause it', () => {
  const w = world();
  w.player.setScene('hub');
  w.player.unlock();
  const hub = w.deckOf(SCENE_TRACK.hub);
  w.player.setScene('fight');
  w.player.setScene('hub');   // back before the fade timer fires
  w.runTimers();
  assert.equal(hub.el.paused, false, 'the ship theme keeps playing');
  assert.ok(FADE_S > 0);
});
