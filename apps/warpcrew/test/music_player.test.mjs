// Music: the CC0 tracks that ship, which scene plays what, and the two-deck player (soft ship <-> map changes
// that wait, hard fight changes at once, equal-power crossfades, resume, mute, hidden pages, format fallback,
// iOS gesture priming). Design notes: src/ui/music.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { MUSIC_TRACKS, SCENE_TRACK, musicScene } from '../src/data/musicManifest.js';
import {
  createMusicPlayer, trackUrls, fadeCurve, MUSIC_MUTE_KEY, FADE_S, SOFT_FADE_S, SOFT_SWITCH_MS, DIP_S,
} from '../src/ui/music.js';

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

test('the scene follows what is on screen: one song for every tab, the star map only on Explore, a running fight beats both', async () => {
  for (const tab of ['ship', 'crew', 'shop', 'log']) assert.equal(musicScene({}, tab), 'hub', `${tab} plays the ship song`);
  assert.equal(musicScene({}, 'missions'), 'hub', 'the contract board plays the ship song');
  assert.equal(musicScene({}, 'missions', 'contracts'), 'hub');
  assert.equal(musicScene({}, 'missions', 'away'), 'hub');
  assert.equal(musicScene({}, 'missions', 'explore'), 'map', 'only the sector map plays the star-map song');
  assert.equal(musicScene({}, 'ship', 'explore'), 'hub', 'the Explore view only counts while Contracts is open');
  assert.equal(musicScene(null, undefined), 'hub');
  const fighting = { activeEncounter: { result: null }, activeContract: { stage: 'encounter' } };
  assert.equal(musicScene(fighting, 'missions', 'explore'), 'fight');
  assert.equal(musicScene(fighting, 'crew'), 'fight');
  assert.equal(musicScene({ ...fighting, activeContract: { wall: { id: 'veil' } } }, 'ship'), 'boss');
  assert.equal(musicScene({ activeEncounter: { result: 'won' } }, 'ship'), 'hub', 'a won fight waiting to be claimed is back to the ship theme');
  assert.equal(musicScene({ activeEncounter: { outcome: 'lost' } }, 'missions', 'explore'), 'map');
  assert.equal(musicScene({ activeEncounter: { outcome: 'lost' } }, 'missions', 'contracts'), 'hub');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /setMusicScene\(musicScene\(player, tab, \w+\)\)/, 'the game passes the Contracts view it shows');
});

// --- A fake browser: <audio> elements, Web Audio gains with automation, a clock with timers, storage. -------
function fakeParam(clock, initial, { hold }) {
  const param = {
    base: initial,
    events: [],   // { type: 'set' | 'ramp', v, t }, in time order
    calls: [],    // every automation call, to check that nothing was scheduled
    get value() { return this.at(clock.now / 1000); },
    set value(v) { this.events = []; this.base = v; },
    at(t) {
      let v = this.base;
      let from = null;
      for (const e of this.events) {
        if (e.t <= t) { v = e.v; from = e.t; continue; }
        if (e.type === 'ramp' && from != null) return v + ((e.v - v) * (t - from)) / (e.t - from);
        break;
      }
      return v;
    },
    final() { return this.events.length ? this.events[this.events.length - 1].v : this.base; },
    insert(e) {
      const i = this.events.findIndex(x => x.t > e.t);
      if (i < 0) this.events.push(e); else this.events.splice(i, 0, e);
    },
    setValueAtTime(v, t) { this.calls.push('set'); this.insert({ type: 'set', v, t }); },
    linearRampToValueAtTime(v, t) { this.calls.push('ramp'); this.insert({ type: 'ramp', v, t }); },
    // As in browsers: a ramp still running at `t` is dropped, so the value falls back to the last set point.
    cancelScheduledValues(t) { this.calls.push('cancel'); this.events = this.events.filter(e => e.t < t); },
  };
  if (hold) {
    param.cancelAndHoldAtTime = function cancelAndHoldAtTime(t) {
      this.calls.push('hold');
      const v = this.at(t);
      this.events = this.events.filter(e => e.t < t);
      this.insert({ type: 'set', v, t });
    };
  }
  return param;
}

function world({ webAudio = true, hold = true, storage = {}, failElements = false } = {}) {
  const log = [];
  const els = [];
  const clock = { now: 0 };   // ms
  let timers = [];
  let seq = 0;
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
    state: 'running', destination: {},
    get currentTime() { return clock.now / 1000; },
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = { gain: fakeParam(clock, 1, { hold }), connect() {} }; gains.push(g); return g; },
    createMediaElementSource(el) { return { el, connect() {} }; },
  };
  const doc = { hidden: false, handlers: {}, addEventListener(t, fn) { this.handlers[t] = fn; } };
  const player = createMusicPlayer({
    createContext: () => (webAudio ? ctx : null), createElement, doc, resolveUrl: p => p, formats: ['ogg', 'm4a'],
    storage: { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } },
    setTimer: (fn, ms) => timers.push({ due: clock.now + ms, seq: seq++, fn }),
  });
  const nextTimer = () => timers.reduce((a, b) => (!a || b.due < a.due || (b.due === a.due && b.seq < a.seq) ? b : a), null);
  const fire = (t) => { timers = timers.filter(x => x !== t); clock.now = Math.max(clock.now, t.due); t.fn(); };
  /** Let `ms` pass, firing every timer that falls due on the way, in order. */
  const advance = (ms) => {
    const end = clock.now + ms;
    for (let t = nextTimer(); t && t.due <= end; t = nextTimer()) fire(t);
    clock.now = end;
  };
  /** Let time run until no timer is left. */
  const runTimers = () => { for (let t = nextTimer(); t; t = nextTimer()) fire(t); };
  const deckOf = id => player._state().decks.find(d => d.trackId === id);
  const level = deck => (deck.gain ? deck.gain.gain.final() : deck.el.volume);   // where the deck is heading
  const now = () => clock.now / 1000;
  const gainNow = deck => deck.gain.gain.at(now());                              // what it plays right now
  const fadeLeft = deck => deck.gain.gain.events[deck.gain.gain.events.length - 1].t - now();
  const current = () => player._state().current;
  const positions = () => player._state().positions;
  return { player, log, els, data, doc, advance, runTimers, deckOf, level, gainNow, fadeLeft, now, current, positions, gains };
}
const file = id => `/audio/music/${MUSIC_TRACKS[id].file}.ogg`;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** A ship on screen, the first tap, and long enough for the first song to be fully in. */
function playing(opts) {
  const w = world(opts);
  w.player.setScene('hub');
  w.player.unlock();
  w.advance(3000);
  return w;
}

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
  w.advance(DIP_S * 1000 + 50);   // the fight song was still fading out: it dips out, then starts again
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
  w.runTimers();                 // map -> ship waits SOFT_SWITCH_MS
  assert.equal(w.deckOf(SCENE_TRACK.hub).el.currentTime, 42);
});

test('ten quick taps around Ship, Contracts, Crew, Shop and Log never change the song', () => {
  const w = playing();
  const hub = w.deckOf(SCENE_TRACK.hub);
  const logBefore = w.log.length;
  const calls = w.gains.map(g => g.gain.calls.length);
  const srcs = w.els.map(el => el.src);
  const taps = [['missions', 'contracts'], ['ship'], ['crew'], ['missions', 'away'], ['shop'], ['log'],
    ['missions', 'contracts'], ['crew'], ['ship'], ['missions', 'contracts']];
  for (const [tab, view] of taps) {
    w.player.unlock();   // every tap is a gesture
    w.player.setScene(musicScene({}, tab, view));
    assert.equal(w.current(), SCENE_TRACK.hub, `${tab} ${view || ''}`);
    w.advance(350);
  }
  w.advance(SOFT_SWITCH_MS * 2);
  assert.equal(w.current(), SCENE_TRACK.hub);
  assert.equal(hub.el.paused, false);
  assert.equal(w.log.length, logBefore, 'no play, pause or reload');
  assert.deepEqual(w.els.map(el => el.src), srcs);
  assert.deepEqual(w.gains.map(g => g.gain.calls.length), calls, 'not even a fade was scheduled');
});

test('the star-map song waits for the Explore map to stay open; tapping back first keeps the ship song with no fade', () => {
  const w = playing();
  const contracts = () => w.player.setScene(musicScene({}, 'missions', 'contracts'));
  const explore = () => w.player.setScene(musicScene({}, 'missions', 'explore'));
  contracts();
  const hub = w.deckOf(SCENE_TRACK.hub);
  const calls = w.gains.map(g => g.gain.calls.length);
  const srcs = w.els.map(el => el.src);

  explore();
  w.advance(SOFT_SWITCH_MS - 500);
  assert.equal(w.current(), SCENE_TRACK.hub, 'still waiting');
  contracts();   // back before the wait is over: dropped
  w.advance(SOFT_SWITCH_MS * 2);
  for (let i = 0; i < 10; i += 1) {   // in and out of Explore every second never lands either
    (i % 2 ? contracts : explore)();
    w.advance(1000);
  }
  w.advance(SOFT_SWITCH_MS * 2);
  assert.equal(w.current(), SCENE_TRACK.hub);
  assert.equal(hub.el.paused, false);
  assert.equal(w.deckOf(SCENE_TRACK.map), undefined, 'the map song never even loaded');
  assert.deepEqual(w.els.map(el => el.src), srcs);
  assert.deepEqual(w.gains.map(g => g.gain.calls.length), calls, 'no fade at all');

  explore();     // and this time the player stays on the map
  w.advance(SOFT_SWITCH_MS - 1);
  assert.equal(w.current(), SCENE_TRACK.hub);
  w.advance(1);
  assert.equal(w.current(), SCENE_TRACK.map, 'after the wait');
  const map = w.deckOf(SCENE_TRACK.map);
  assert.equal(map.el.paused, false);
  assert.equal(w.level(map), MUSIC_TRACKS[SCENE_TRACK.map].volume);
  assert.equal(w.level(hub), 0);
  assert.ok(near(w.fadeLeft(map), SOFT_FADE_S) && near(w.fadeLeft(hub), SOFT_FADE_S), 'a long, gentle crossfade');
});

test('a fight switches at once, and so does coming back from it; the ship song picks up at its place', () => {
  const w = playing();
  const hub = w.deckOf(SCENE_TRACK.hub);
  hub.el.currentTime = 42;
  w.player.setScene(musicScene({}, 'missions', 'explore'));   // a map change starts waiting...
  w.advance(2000);
  const fighting = { activeEncounter: { result: null }, activeContract: { stage: 'encounter' } };
  w.player.setScene(musicScene(fighting, 'missions', 'explore'));   // ...and a fight cuts in
  assert.equal(w.current(), SCENE_TRACK.fight, 'at once');
  const fight = w.deckOf(SCENE_TRACK.fight);
  assert.equal(fight.el.paused, false);
  assert.equal(fight.el.currentTime, 0);
  assert.ok(near(w.fadeLeft(fight), FADE_S) && near(w.fadeLeft(hub), FADE_S), 'the quick fight crossfade');
  assert.equal(w.positions().get(SCENE_TRACK.hub), 42, 'the ship song saves its place as soon as it fades');
  w.advance(SOFT_SWITCH_MS * 3);
  assert.equal(w.current(), SCENE_TRACK.fight, 'the waiting map change was dropped');
  assert.equal(hub.el.paused, true);

  w.player.setScene(musicScene({ activeEncounter: { result: 'won' } }, 'ship'));   // won, waiting to be claimed
  assert.equal(w.current(), SCENE_TRACK.hub, 'back at once');
  assert.equal(hub.el.currentTime, 42, 'at its place');
  assert.equal(hub.el.paused, false);
  assert.equal(w.level(hub), MUSIC_TRACKS[SCENE_TRACK.hub].volume);
  assert.equal(w.level(fight), 0);
  assert.ok(near(w.fadeLeft(hub), FADE_S));

  w.advance(5000);
  w.player.setScene(musicScene({ ...fighting, activeContract: { wall: { id: 'veil' } } }, 'ship'));
  assert.equal(w.current(), SCENE_TRACK.boss, 'a Siege wall switches at once too');
});

test('a quick ship -> map -> ship keeps the ship song in its place; a song brought back mid-fade carries on with no jump', () => {
  // Back within the fade: the change home waits its turn, and the ship song resumes at its latest place.
  const w = playing();
  const hub = w.deckOf(SCENE_TRACK.hub);
  hub.el.currentTime = 42;
  w.player.setScene('map');
  w.advance(SOFT_SWITCH_MS);
  assert.equal(w.current(), SCENE_TRACK.map);
  assert.equal(w.positions().get(SCENE_TRACK.hub), 42, 'saved the moment it starts to fade');
  w.advance(1000);
  hub.el.currentTime = 43;   // it plays on while it fades
  w.player.setScene('hub');  // back, within the fade
  w.advance(1000);
  hub.el.currentTime = 44;
  w.advance(1000);           // the fade is over: it pauses and saves its place again
  assert.equal(hub.el.paused, true);
  assert.equal(w.positions().get(SCENE_TRACK.hub), 44, 'kept fresh');
  w.advance(SOFT_SWITCH_MS);
  assert.equal(w.current(), SCENE_TRACK.hub);
  assert.equal(hub.el.currentTime, 44, 'not from the top');
  assert.equal(hub.el.paused, false);

  // A fight that is over at once brings the ship song back while it is still fading out, with and without
  // cancelAndHoldAtTime.
  for (const hold of [true, false]) {
    const v = playing({ hold });
    const ship = v.deckOf(SCENE_TRACK.hub);
    ship.el.currentTime = 42;
    v.player.setScene('fight');
    v.advance(FADE_S * 500);   // halfway through the fade
    const fight = v.deckOf(SCENE_TRACK.fight);
    const before = [v.gainNow(ship), v.gainNow(fight)];
    assert.ok(before[0] > 0.5 && before[0] < 0.7 && before[1] > 0.5 && before[1] < 0.7, `mid-fade (${before})`);
    ship.el.currentTime = 42.6;
    v.player.setScene('hub');
    assert.equal(ship.el.currentTime, 42.6, 'no seek: it carries on');
    assert.equal(ship.el.paused, false);
    assert.ok(near(v.gainNow(ship), before[0]), `the ship song rises from where it was (hold ${hold})`);
    assert.ok(near(v.gainNow(fight), before[1]), `the fight song falls from where it was (hold ${hold})`);
    assert.equal(v.level(ship), MUSIC_TRACKS[SCENE_TRACK.hub].volume);
    assert.equal(v.level(fight), 0);
    v.advance(100);
    assert.ok(v.gainNow(ship) > before[0] && v.gainNow(fight) < before[1]);
    v.runTimers();
    assert.equal(ship.el.paused, false);
    assert.equal(fight.el.paused, true);
    assert.equal(ship.el.currentTime, 42.6);
  }
});

test('a stale fade timer never pauses a song that came back and is fading out again', () => {
  const w = playing();
  const hub = w.deckOf(SCENE_TRACK.hub);
  w.player.setScene('fight');   // t = 0: the ship song's first fade-out; its timer is due at FADE_S + 0.1 s
  w.advance(500);
  w.player.setScene('hub');     // back...
  w.advance(300);
  w.player.setScene('fight');   // ...and away again: a second fade-out from t = 0.8 s
  w.advance(600);               // t = 1.4 s: past the first timer, inside the second fade
  assert.equal(hub.el.paused, false, 'the first fade-out\'s timer did not cut the second one short');
  assert.ok(w.gainNow(hub) > 0.1, 'still audibly fading');
  w.advance(FADE_S * 1000);
  assert.equal(hub.el.paused, true, 'the latest fade-out pauses it once it is done');
});

test('a third song mid-fade dips the fading deck out over DIP_S instead of cutting it', () => {
  const w = playing();
  const ship = w.deckOf(SCENE_TRACK.hub);
  w.player.setScene('map');
  w.advance(SOFT_SWITCH_MS);
  const map = w.deckOf(SCENE_TRACK.map);
  assert.notEqual(map, ship);
  w.advance(1000);              // mid-crossfade: both songs audible
  ship.el.currentTime = 43;
  const g = w.gainNow(ship);
  assert.ok(g > 0.1, 'the ship song is still audible');
  w.player.setScene('fight');   // the fight needs a deck: the only spare is the ship song's, still fading out
  assert.equal(w.current(), SCENE_TRACK.fight, 'on its way at once');
  assert.equal(ship.el.src, file(SCENE_TRACK.hub), 'not swapped under a playing song');
  assert.ok(near(w.gainNow(ship), g), 'no cut');
  assert.equal(w.level(ship), 0);
  assert.ok(near(w.fadeLeft(ship), DIP_S), 'a short dip');
  assert.equal(w.level(map), 0, 'the map song fades out as well');
  w.advance(DIP_S * 1000 + 50);
  assert.equal(ship.trackId, SCENE_TRACK.fight);
  assert.equal(ship.el.src, file(SCENE_TRACK.fight));
  assert.equal(ship.el.paused, false);
  assert.equal(ship.el.currentTime, 0, 'the fight from the top');
  assert.equal(w.level(ship), MUSIC_TRACKS[SCENE_TRACK.fight].volume);
  assert.equal(w.positions().get(SCENE_TRACK.hub), 43, 'the ship song keeps its place');
});

/** At every sample point of a crossfade, (in / in's full)^2 + (out / out's full)^2 = 1. */
function assertEqualPower(w, incoming, outgoing, seconds) {
  const t0 = w.now();
  const inc = incoming.gain.gain;
  const out = outgoing.gain.gain;
  const vIn = MUSIC_TRACKS[incoming.trackId].volume;
  const vOut = MUSIC_TRACKS[outgoing.trackId].volume;
  const times = p => [...new Set(p.events.filter(e => e.t >= t0).map(e => e.t))];
  const points = times(inc);
  assert.ok(points.length >= 12, 'a sampled curve, not a step');
  assert.ok(near(points.at(-1) - t0, seconds), `the crossfade takes ${seconds} s`);
  assert.deepEqual(times(out), points, 'both decks share the sample points');
  let last = [-1, 2];
  for (const t of points) {
    const a = inc.at(t) / vIn;
    const b = out.at(t) / vOut;
    assert.ok(near(a * a + b * b, 1), `equal power at +${(t - t0).toFixed(3)} s: ${a}^2 + ${b}^2`);
    assert.ok(a >= last[0] && b <= last[1], 'in rises, out falls');
    last = [a, b];
  }
  for (let i = 1; i < points.length; i += 1) {   // and the ramps between the points stay on the curve
    const t = (points[i - 1] + points[i]) / 2;
    const a = inc.at(t) / vIn;
    const b = out.at(t) / vOut;
    assert.ok(Math.abs(a * a + b * b - 1) < 0.01);
  }
  assert.equal(inc.at(t0), 0);
  assert.ok(near(inc.at(t0 + seconds), vIn) && out.at(t0 + seconds) === 0);
}

test('crossfades are equal-power: 2.5 s between the ship and the map, 1.2 s into a fight', () => {
  const w = playing();
  const ship = w.deckOf(SCENE_TRACK.hub);
  w.player.setScene('map');
  w.advance(SOFT_SWITCH_MS);
  const map = w.deckOf(SCENE_TRACK.map);
  assert.equal(SOFT_FADE_S, 2.5);
  assertEqualPower(w, map, ship, SOFT_FADE_S);
  w.advance(10000);
  w.player.setScene('fight');
  assert.equal(FADE_S, 1.2);
  assertEqualPower(w, w.deckOf(SCENE_TRACK.fight), map, FADE_S);

  // A fade that interrupts another joins the curve where the deck is, and takes only the time left.
  const part = fadeCurve(0.3, 1, 1, 2);
  const p0 = Math.asin(0.3) / (Math.PI / 2);
  assert.equal(part[0].v, 0.3);
  assert.equal(part.at(-1).v, 1);
  assert.ok(near(part.at(-1).t, 2 * (1 - p0)));
  for (const { t, v } of part) assert.ok(near(v, Math.sin((p0 + t / 2) * (Math.PI / 2))), 'on the sine');
  for (const { t, v } of fadeCurve(0.8, 0, 0.8, 1.2)) assert.ok(near(v, 0.8 * Math.cos((t / 1.2) * (Math.PI / 2))), 'on the cosine');
  assert.deepEqual(fadeCurve(0.5, 0, 1, 0), [{ t: 0, v: 0 }], 'no fade time: at once');
});

test('after the first ship -> map change, a later tap puts the fight song back on the idle spare deck', () => {
  const w = playing();
  const ship = w.deckOf(SCENE_TRACK.hub);
  ship.el.currentTime = 42;
  w.player.setScene('map');
  w.advance(SOFT_SWITCH_MS);
  assert.equal(w.deckOf(SCENE_TRACK.fight), undefined, 'the map song took the fight song\'s deck');
  w.player.unlock();   // a tap mid-crossfade: the ship deck is still fading, so it is left alone
  assert.equal(ship.trackId, SCENE_TRACK.hub);
  w.advance(SOFT_FADE_S * 1000 + 200);
  assert.equal(ship.el.paused, true);
  const n = w.log.length;
  w.player.unlock();   // a later tap: the spare deck is idle
  assert.equal(ship.trackId, SCENE_TRACK.fight);
  assert.equal(ship.el.src, file(SCENE_TRACK.fight));
  assert.deepEqual(w.log.slice(n).map(e => e[0]), ['play', 'pause'], 'primed silently inside the tap');
  assert.equal(ship.el.paused, true);
  assert.equal(w.level(ship), 0);
  assert.equal(w.current(), SCENE_TRACK.map, 'the map song plays on');
  assert.equal(w.positions().get(SCENE_TRACK.hub), 42);
  w.player.unlock();
  assert.equal(w.log.length, n + 2, 'only once');

  w.player.setScene('fight');   // the next fight starts on the ready deck, no reload
  assert.equal(w.current(), SCENE_TRACK.fight);
  assert.equal(ship.el.paused, false);
  assert.ok(w.log.slice(n + 2).every(e => e[0] !== 'play' || e[2] === file(SCENE_TRACK.fight)));
  w.advance(5000);
  w.player.setScene('hub');
  assert.equal(w.deckOf(SCENE_TRACK.hub).el.currentTime, 42, 'and the ship song still comes back at its place');

  // Never while a ship <-> map change is waiting (the ship song is about to come back on that deck).
  const v = playing();
  v.player.setScene('map');
  v.advance(SOFT_SWITCH_MS + SOFT_FADE_S * 1000 + 200);
  const home = v.deckOf(SCENE_TRACK.hub);
  assert.equal(home.el.paused, true);
  v.player.setScene('hub');
  v.player.unlock();
  assert.equal(home.trackId, SCENE_TRACK.hub, 'left alone');
  v.advance(SOFT_SWITCH_MS);
  assert.equal(v.current(), SCENE_TRACK.hub);
  assert.equal(home.el.paused, false);
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

  const mid = playing();   // switched off mid-crossfade: both songs stop at once
  mid.player.setScene('map');
  mid.advance(SOFT_SWITCH_MS + 1000);
  mid.player.toggleMuted();
  assert.ok(mid.els.every(el => el.paused));
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
  plain.runTimers();
  plain.player.setScene('map');
  plain.runTimers();
  assert.ok(plain.deckOf(SCENE_TRACK.map).el.volume > 0, 'scene changes still work on element volume');

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
