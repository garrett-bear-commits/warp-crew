// @ts-nocheck
/**
 * Music player. Presentation only: it never touches game state.
 *
 * - One looping track per scene (hub, map, fight, boss; src/data/musicManifest.js).
 * - Scene changes are hard or soft. Into or out of a fight (fight, boss) is hard: it crossfades at once, over
 *   FADE_S. Between the ship and the star map (hub, map) is soft: it starts only once the new scene has been
 *   wanted for SOFT_SWITCH_MS, is dropped if the player goes back first, and crossfades over SOFT_FADE_S. So
 *   tapping around the menus never flips the songs back and forth.
 * - Crossfades are equal-power (the incoming deck rises on a sine, the outgoing falls on a cosine), scheduled as
 *   sampled linear ramps. Any fade can be interrupted: the next one starts from the gain the deck has right now.
 * - Tracks stream through two <audio> "decks" (a whole song decoded into memory would cost tens of MB on a phone),
 *   routed through Web Audio for volume, because iOS ignores an element's own volume. Both decks are started
 *   inside user gestures, since iOS only lets an element play later if it first played from a tap.
 * - A deck that is still audible but must change song (a third song mid-fade, or a fight from the top) dips out
 *   over DIP_S first instead of cutting.
 * - Nothing plays before the first gesture (unlock()). Hidden pages pause.
 * - Music has its own on/off switch, per device (localStorage), apart from sound effects.
 * - The ship and map tracks resume where they left off: their place is saved the moment they start fading out,
 *   and a song brought back while it is still fading carries on with no seek. Fight tracks start from the top.
 * - Any failure (no Web Audio, a missing file, playback refused) leaves the game quiet, never broken.
 */
import { MUSIC_TRACKS, SCENE_TRACK } from '../data/musicManifest.js';
import { artUrl } from '../shared/artUrl.js';

export const MUSIC_MUTE_KEY = 'warpCrew.musicMuted';
export const MUSIC_MASTER = 0.55;
/** Crossfade into or out of a fight, in seconds. */
export const FADE_S = 1.2;
/** Crossfade between the ship and the star map, in seconds. */
export const SOFT_FADE_S = 2.5;
/** A ship <-> map change waits this long (ms) before it starts, and is dropped if the player goes back first. */
export const SOFT_SWITCH_MS = 4000;
/** A deck that is still audible dips out over this long (s) before it changes song. */
export const DIP_S = 0.15;

const SOFT_SCENES = new Set(['hub', 'map']);
const FADE_STEPS = 24;   // ramp points across a whole fade
const SILENT = 0.001;    // -60 dB: quiet enough to swap a song underneath
const HALF_PI = Math.PI / 2;

export function trackUrls(track, resolve = artUrl) {
  return { ogg: resolve(`/audio/music/${track.file}.ogg`), m4a: resolve(`/audio/music/${track.file}.m4a`) };
}

/**
 * An equal-power fade as points { t: seconds from now, v: gain }. A deck rising to `full` follows a sine and one
 * falling from `full` a cosine, so two decks crossing over keep their summed power. A fade that starts part-way
 * (it interrupted another) joins the curve at its current gain and takes only the time left on it.
 */
export function fadeCurve(from, to, full, seconds) {
  const top = Math.max(Number(full) || 0, from, to);
  if (!(seconds > 0) || !(top > 0) || Math.abs(to - from) < 1e-6) return [{ t: 0, v: to }];
  const rising = to > from;
  const phase = (v) => {
    const x = Math.min(1, Math.max(0, v / top));
    return (rising ? Math.asin(x) : Math.acos(x)) / HALF_PI;
  };
  const p0 = phase(from);
  const p1 = phase(to);
  const span = Math.abs(p1 - p0);
  const steps = Math.max(2, Math.ceil(FADE_STEPS * span));
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = p0 + ((p1 - p0) * i) / steps;
    const v = i === 0 ? from : i === steps ? to : top * (rising ? Math.sin(p * HALF_PI) : Math.cos(p * HALF_PI));
    points.push({ t: (seconds * span * i) / steps, v });
  }
  return points;
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
  let scene = null;                // the scene the music follows
  let pendingScene = null;         // a soft change waiting out SOFT_SWITCH_MS
  let pendingToken = 0;            // bumped to drop a waiting soft change
  let decks = [];
  let current = null;              // the deck that should be audible
  let gesture = false;             // inside unlock(), i.e. a user gesture
  const positions = new Map();     // trackId -> seconds, for tracks that resume
  const order = formats || preferredOrder(doc);
  const makeElement = createElement || (() => doc?.createElement?.('audio'));
  const listeners = new Set();

  const audible = () => unlocked && !muted && !hidden;
  const wantedTrack = () => (scene && tracks[sceneTrack[scene]] ? sceneTrack[scene] : null);
  const fullLevel = trackId => tracks[trackId]?.volume ?? 1;

  /** A deck's gain right now, read from its own schedule (an AudioParam's `value` lags on some browsers). */
  function gainNow(deck) {
    if (deck.gain && ctx) {
      const ramp = deck.ramp;
      if (!ramp) return Number(deck.gain.gain.value) || 0;
      const t = (Number(ctx.currentTime) || 0) - ramp.t0;
      const pts = ramp.points;
      if (t <= pts[0].t) return pts[0].v;
      for (let i = 1; i < pts.length; i += 1) {
        if (t < pts[i].t) return pts[i - 1].v + ((pts[i].v - pts[i - 1].v) * (t - pts[i - 1].t)) / (pts[i].t - pts[i - 1].t);
      }
      return pts[pts.length - 1].v;
    }
    try { return (Number(deck.el.volume) || 0) / MUSIC_MASTER; } catch { return 0; }
  }

  /**
   * Fade a deck to `to` over `seconds` (0: at once) on the equal-power curve, from the gain it has now, so a fade
   * cut short by another never jumps. Without Web Audio the element's volume is set at once.
   */
  function fadeTo(deck, to, seconds, { full = fullLevel(deck.trackId), from = null } = {}) {
    if (deck.gain && ctx) {
      const param = deck.gain.gain;
      const t0 = Number(ctx.currentTime) || 0;
      const start = from ?? gainNow(deck);   // read before cancelling
      const points = fadeCurve(start, to, full, seconds);
      try {
        try { param.cancelAndHoldAtTime(t0); } catch { param.cancelScheduledValues(t0); }
        param.setValueAtTime(points[0].v, t0);
        for (const p of points.slice(1)) param.linearRampToValueAtTime(p.v, t0 + p.t);
        deck.ramp = { t0, points };
        return;
      } catch {
        try {
          param.value = to;
          deck.ramp = { t0, points: [{ t: 0, v: to }] };
          return;
        } catch { /* fall back to the element */ }
      }
    }
    try { deck.el.volume = Math.max(0, Math.min(1, to * MUSIC_MASTER)); } catch { /* ignore */ }
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

  function play(deck) {
    quietly(() => deck.el.play());
    if (gesture) deck.primed = true;
  }

  function pause(deck) {
    try { deck.el.pause(); } catch { /* ignore */ }
  }

  function makeDeck() {
    const deck = { el: null, gain: null, trackId: null, formatIndex: 0, primed: false, ramp: null, token: 0, pending: null };
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

  /** Start a silent or paused deck on `trackId` from its place (saved spot, or the top for a fight), fading up. */
  function begin(deck, trackId, fade) {
    if (deck.trackId !== trackId) load(deck, trackId);
    try {
      deck.el.currentTime = tracks[trackId]?.resume ? positions.get(trackId) || 0 : 0;
    } catch { /* not seekable yet: plays from the top */ }
    play(deck);
    fadeTo(deck, fullLevel(trackId), fade, { from: 0 });
  }

  /** Make `deck` the one playing `trackId`. */
  function bringIn(deck, trackId, fade) {
    const token = ++deck.token;   // any retire or dip still pending on this deck is now stale
    deck.pending = null;
    const playing = !deck.el.paused;
    if (playing && deck.trackId === trackId && tracks[trackId]?.resume) {
      // Back before its fade-out finished: carry on from here (no seek), up from the gain it has now.
      fadeTo(deck, fullLevel(trackId), fade);
      return;
    }
    const level = playing ? gainNow(deck) : 0;
    if (level > SILENT) {
      // Still audible but it needs another song (or a fight from the top): dip it out first, never cut.
      fadeTo(deck, 0, DIP_S, { full: level });
      deck.pending = trackId;
      setTimer(() => {
        if (deck.token !== token) return;
        deck.pending = null;
        begin(deck, trackId, fade);
      }, DIP_S * 1000 + 30);
      return;
    }
    begin(deck, trackId, fade);
  }

  /** Fade a deck out (or stop it at once) and pause it. Its place is saved now and again when it pauses. */
  function retire(deck, fade) {
    const token = ++deck.token;
    deck.pending = null;
    remember(deck);
    if (fade > 0 && !deck.el.paused) {
      fadeTo(deck, 0, fade);
      setTimer(() => {
        // Only the latest retire may pause: the deck may have come back (and gone again) since this one.
        if (deck.token !== token || current === deck) return;
        remember(deck);
        pause(deck);
      }, fade * 1000 + 100);
    } else {
      fadeTo(deck, 0, 0);
      pause(deck);
    }
  }

  /** Bring what is audible in line with the scene, the switch and page visibility. */
  function sync(fade = FADE_S) {
    const id = audible() ? wantedTrack() : null;
    if (!id || !decks.length) {
      for (const deck of decks) if (deck === current || !deck.el.paused) retire(deck, 0);
      current = null;
      return;
    }
    if (current && (current.pending === id || (current.trackId === id && !current.pending))) {
      if (!current.pending && current.el.paused) bringIn(current, id, fade);
      return;
    }
    const deck = decks.find(d => d.trackId === id) || decks.find(d => d !== current) || decks[0];
    const prev = current;
    current = deck;
    if (prev && prev !== deck) retire(prev, fade);
    bringIn(deck, id, fade);
  }

  /**
   * Keep the fight track (the likeliest sudden scene) ready on the spare deck. The first ship -> map change puts
   * the map song on the deck that held it; once the other deck has faded out and paused, a later tap loads the
   * fight track there, so the next fight starts without a wait. Only an idle, silent, primed deck is touched, and
   * never while a ship <-> map change is waiting.
   */
  function reprime() {
    const fightId = sceneTrack.fight;
    if (!audible() || !tracks[fightId] || pendingScene != null || !SOFT_SCENES.has(scene)) return;
    if (decks.some(d => d.trackId === fightId || d.pending === fightId)) return;
    const spare = decks.find(d => d !== current && d.primed && d.el.paused);
    if (!spare) return;
    load(spare, fightId);
    quietly(() => spare.el.play());
    pause(spare);
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
      pause(deck);
      deck.primed = true;
    }
    reprime();
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
      sync(FADE_S);
      prime();
    } finally {
      gesture = false;
    }
  }

  function dropPending() {
    pendingScene = null;
    pendingToken += 1;
  }

  /**
   * Follow the scene on screen. Ship <-> map waits SOFT_SWITCH_MS and is dropped if the scene goes back first;
   * anything into or out of a fight, or while nothing is playing yet, applies at once.
   */
  function setScene(next) {
    if (pendingScene != null && next === pendingScene) return;   // already waiting for it
    if (next === scene) { dropPending(); return; }
    if (SOFT_SCENES.has(scene) && SOFT_SCENES.has(next) && audible() && current) {
      dropPending();
      pendingScene = next;
      const token = pendingToken;
      setTimer(() => {
        if (token !== pendingToken) return;
        pendingScene = null;
        scene = next;
        sync(SOFT_FADE_S);
      }, SOFT_SWITCH_MS);
      return;
    }
    dropPending();
    scene = next;
    sync(FADE_S);
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
    _state: () => ({
      ctx, unlocked, hidden, muted, scene, pending: pendingScene,
      current: current ? current.pending || current.trackId : null, decks, positions,
    }),
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
