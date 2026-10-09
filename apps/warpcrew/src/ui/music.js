// @ts-nocheck
/**
 * Music player. Presentation only: it never touches game state.
 *
 * - One looping track per scene (hub, map, fight, boss; src/data/musicManifest.js). Changing scene crossfades.
 * - Tracks stream through two <audio> "decks" (a whole song decoded into memory would cost tens of MB on a phone),
 *   routed through Web Audio for volume, because iOS ignores an element's own volume. Both decks are started
 *   inside user gestures, since iOS only lets an element play later if it first played from a tap.
 * - Nothing plays before the first gesture (unlock()). Hidden pages pause.
 * - Music has its own on/off switch, per device (localStorage), apart from sound effects.
 * - The ship and map tracks resume where they left off; fight tracks start from the top.
 * - Any failure (no Web Audio, a missing file, playback refused) leaves the game quiet, never broken.
 */
import { MUSIC_TRACKS, SCENE_TRACK } from '../data/musicManifest.js';
import { artUrl } from '../shared/artUrl.js';

export const MUSIC_MUTE_KEY = 'warpCrew.musicMuted';
export const MUSIC_MASTER = 0.55;
export const FADE_S = 1.2;

export function trackUrls(track, resolve = artUrl) {
  return { ogg: resolve(`/audio/music/${track.file}.ogg`), m4a: resolve(`/audio/music/${track.file}.m4a`) };
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function defaultContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC() : null;
}

function preferredOrder(doc) {
  try {
    const probe = doc?.createElement?.('audio');
    if (probe?.canPlayType?.('audio/ogg; codecs="opus"')) return ['ogg', 'm4a'];
  } catch { /* fall through */ }
  return ['m4a', 'ogg'];
}

const quietly = fn => { try { const p = fn(); p?.catch?.(() => {}); } catch { /* ignore */ } };

export function createMusicPlayer({
  createContext = defaultContext,
  createElement = null,
  storage = defaultStorage(),
  doc = globalThis.document,
  resolveUrl = artUrl,
  formats = null,
  tracks = MUSIC_TRACKS,
  sceneTrack = SCENE_TRACK,
  setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let ctx = null;
  let master = null;
  let unlocked = false;
  let hidden = Boolean(doc?.hidden);
  let muted = false;
  try { muted = storage?.getItem(MUSIC_MUTE_KEY) === '1'; } catch { muted = false; }
  let scene = null;
  let decks = [];
  let current = null;              // the deck that should be audible
  let gesture = false;             // inside unlock(), i.e. a user gesture
  const positions = new Map();     // trackId -> seconds, for tracks that resume
  const order = formats || preferredOrder(doc);
  const makeElement = createElement || (() => doc?.createElement?.('audio'));
  const listeners = new Set();

  const audible = () => unlocked && !muted && !hidden;
  const wantedTrack = () => (scene && tracks[sceneTrack[scene]] ? sceneTrack[scene] : null);

  function setLevel(deck, level, fade = FADE_S) {
    if (deck.gain && ctx) {
      try {
        deck.gain.gain.cancelScheduledValues?.(ctx.currentTime);
        if (deck.gain.gain.setTargetAtTime && fade > 0) deck.gain.gain.setTargetAtTime(level, ctx.currentTime, fade / 4);
        else deck.gain.gain.value = level;
        return;
      } catch { /* fall back to the element */ }
    }
    try { deck.el.volume = Math.max(0, Math.min(1, level * MUSIC_MASTER)); } catch { /* ignore */ }
  }

  function remember(deck) {
    if (deck.trackId && tracks[deck.trackId]?.resume) {
      try { positions.set(deck.trackId, Number(deck.el.currentTime) || 0); } catch { /* ignore */ }
    }
  }

  function load(deck, trackId) {
    remember(deck);
    deck.trackId = trackId;
    deck.formatIndex = 0;
    try { deck.el.src = trackUrls(tracks[trackId], resolveUrl)[order[0]]; } catch { /* ignore */ }
  }

  function makeDeck() {
    const deck = { el: null, gain: null, trackId: null, formatIndex: 0, primed: false };
    try {
      const el = makeElement();
      if (!el) return null;
      el.loop = true;
      el.preload = 'auto';
      // The other format, once, if the first will not load.
      el.addEventListener?.('error', () => {
        if (!deck.trackId) return;
        deck.formatIndex += 1;
        if (deck.formatIndex >= order.length) return;
        try { el.src = trackUrls(tracks[deck.trackId], resolveUrl)[order[deck.formatIndex]]; } catch { return; }
        if (current === deck && audible()) quietly(() => el.play());
      });
      deck.el = el;
      if (ctx && master) {
        try {
          const source = ctx.createMediaElementSource(el);
          deck.gain = ctx.createGain();
          deck.gain.gain.value = 0;
          source.connect(deck.gain);
          deck.gain.connect(master);
        } catch { deck.gain = null; }
      }
      if (!deck.gain) el.volume = 0;
      return deck;
    } catch {
      return null;
    }
  }

  function start(deck) {
    const track = tracks[deck.trackId];
    try {
      if (track?.resume) deck.el.currentTime = positions.get(deck.trackId) || 0;
      else deck.el.currentTime = 0;
    } catch { /* not seekable yet: plays from the top */ }
    quietly(() => deck.el.play());
    if (gesture) deck.primed = true;
    setLevel(deck, track?.volume ?? 1);
  }

  function retire(deck, { fade }) {
    if (fade) {
      setLevel(deck, 0);
      setTimer(() => {
        if (current === deck) return;
        remember(deck);
        try { deck.el.pause(); } catch { /* ignore */ }
      }, FADE_S * 1000 + 100);
    } else {
      setLevel(deck, 0, 0);
      remember(deck);
      try { deck.el.pause(); } catch { /* ignore */ }
    }
  }

  /** Bring what is audible in line with the scene, the switch and page visibility. */
  function sync() {
    const id = audible() ? wantedTrack() : null;
    if (!id || !decks.length) {
      if (current) { retire(current, { fade: false }); current = null; }
      return;
    }
    if (current?.trackId === id) {
      if (current.el.paused) start(current);
      return;
    }
    const deck = decks.find(d => d.trackId === id) || decks.find(d => d !== current) || decks[0];
    const prev = current;
    current = deck;
    if (prev && prev !== deck) retire(prev, { fade: true });
    if (deck.trackId !== id) load(deck, id);
    start(deck);
  }

  /**
   * Let a deck play later: iOS only allows that once it has played inside a user gesture. The spare deck plays
   * silently and pauses at once, holding the fight track (the likeliest next scene) so it starts buffering.
   */
  function prime() {
    if (!audible()) return;
    for (const deck of decks) {
      if (deck.primed || deck === current) continue;
      if (!deck.trackId) {
        const spare = sceneTrack.fight !== wantedTrack() ? sceneTrack.fight : sceneTrack.hub;
        if (!tracks[spare]) continue;
        load(deck, spare);
      }
      quietly(() => deck.el.play());
      try { deck.el.pause(); } catch { /* ignore */ }
      deck.primed = true;
    }
  }

  /** Call from every user gesture: sets up the audio context and both decks, then plays the current scene. */
  function unlock() {
    if (!unlocked) {
      unlocked = true;
      try {
        ctx = createContext();
        if (ctx) {
          master = ctx.createGain();
          master.gain.value = MUSIC_MASTER;
          master.connect(ctx.destination);
        }
      } catch {
        ctx = null;
        master = null;
      }
      decks = [makeDeck(), makeDeck()].filter(Boolean);
    }
    if (ctx?.state === 'suspended' && !hidden) quietly(() => ctx.resume());
    gesture = true;
    try {
      sync();
      prime();
    } finally {
      gesture = false;
    }
  }

  function setScene(next) {
    if (next === scene) return;
    scene = next;
    sync();
  }

  function setMuted(next) {
    muted = Boolean(next);
    try { storage?.setItem(MUSIC_MUTE_KEY, muted ? '1' : '0'); } catch { /* storage may be blocked */ }
    sync();
    for (const fn of listeners) { try { fn(muted); } catch { /* ignore */ } }
    return muted;
  }

  function setHidden(next) {
    hidden = Boolean(next);
    if (hidden) {
      sync();
      quietly(() => ctx?.suspend?.());
    } else {
      if (unlocked) quietly(() => ctx?.resume?.());
      sync();
    }
  }

  try {
    doc?.addEventListener?.('visibilitychange', () => setHidden(doc.hidden));
    globalThis.addEventListener?.('pagehide', () => setHidden(true));
    globalThis.addEventListener?.('pageshow', () => setHidden(Boolean(doc?.hidden)));
  } catch { /* ignore */ }

  return {
    unlock,
    setScene,
    setMuted,
    setHidden,
    isMuted: () => muted,
    toggleMuted: () => setMuted(!muted),
    onMuteChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    // For tests and debugging.
    _state: () => ({ ctx, unlocked, hidden, muted, scene, current: current?.trackId || null, decks, positions }),
  };
}

let shared = null;
function player() {
  if (!shared) shared = createMusicPlayer();
  return shared;
}

export const unlockMusic = () => player().unlock();
export const setMusicScene = scene => player().setScene(scene);
export const isMusicMuted = () => player().isMuted();
export const toggleMusicMuted = () => player().toggleMuted();
