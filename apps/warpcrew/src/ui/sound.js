// @ts-nocheck
/**
 * Sound effects player (Web Audio). Presentation only: it never touches game state,
 * and its randomness (which variant, a hair of pitch) is plain Math.random.
 *
 * - Files are fetched after first paint, decoded once, then played as buffers.
 * - Nothing sounds before the first user gesture (unlock()).
 * - Each sound has a mix volume, a voice cap (oldest voice is cut) and a minimum gap,
 *   so rapid volleys stay readable instead of stacking into noise.
 * - Mute is per device (localStorage). Hidden pages go quiet.
 * - Any failure (no Web Audio, missing file, decode error) leaves the game silent, never broken.
 */
import { SFX, SFX_ALIASES, SFX_CLIPS } from '../data/sfxManifest.js';
import { artUrl } from '../shared/artUrl.js';

export const MUTE_KEY = 'warpCrew.sfxMuted';
const MASTER = 0.8;

export function clipUrls(clip, resolve = artUrl) {
  return { ogg: resolve(`/audio/${clip}.ogg`), m4a: resolve(`/audio/${clip}.m4a`) };
}

export function resolveSfxName(name) {
  const key = SFX_ALIASES[name] || name;
  return SFX[key] ? key : null;
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function defaultContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC({ latencyHint: 'interactive' }) : null;
}

async function defaultFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.arrayBuffer();
}

/** Ogg Opus where the browser says it can; AAC otherwise (iOS WebKit). Either way the other is tried on failure. */
function preferredOrder() {
  try {
    const probe = globalThis.document?.createElement?.('audio');
    if (probe?.canPlayType?.('audio/ogg; codecs="opus"')) return ['ogg', 'm4a'];
  } catch { /* fall through */ }
  return ['m4a', 'ogg'];
}

function decode(ctx, bytes) {
  // Older WebKit only has the callback form.
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p?.then) p.then(resolve, reject);
    } catch (err) { reject(err); }
  });
}

export function createSoundPlayer({
  createContext = defaultContext,
  fetchBytes = defaultFetch,
  storage = defaultStorage(),
  doc = globalThis.document,
  resolveUrl = artUrl,
  formats = null,
  random = Math.random,
} = {}) {
  let ctx = null;
  let master = null;
  let unlocked = false;
  let hidden = Boolean(doc?.hidden);
  let muted = false;
  try { muted = storage?.getItem(MUTE_KEY) === '1'; } catch { muted = false; }
  const bytes = new Map();      // clip -> Promise<{ format: ArrayBuffer }>
  const buffers = new Map();    // clip -> AudioBuffer | null (null = gave up)
  const decoding = new Map();   // clip -> Promise
  const voices = new Map();     // name -> [{ src, gain, endsAt }]
  const lastStart = new Map();  // name -> ctx time
  const lastClip = new Map();   // name -> clip
  const order = formats || preferredOrder();
  const listeners = new Set();

  function fetchClip(clip) {
    if (!bytes.has(clip)) {
      const urls = clipUrls(clip, resolveUrl);
      // Only the preferred format is fetched up front; the fallback only if that fails.
      const first = fetchBytes(urls[order[0]]).then(data => ({ [order[0]]: data }), () => ({}));
      bytes.set(clip, first);
    }
    return bytes.get(clip);
  }

  /** Fetch every clip's bytes without an AudioContext (safe before a gesture; never blocks paint). */
  function preload() {
    for (const clip of Object.keys(SFX_CLIPS)) fetchClip(clip);
  }

  function decodeClip(clip) {
    if (buffers.has(clip)) return Promise.resolve(buffers.get(clip));
    if (decoding.has(clip)) return decoding.get(clip);
    const job = (async () => {
      const got = await fetchClip(clip);
      for (const format of order) {
        try {
          let data = got[format];
          if (!data) data = await fetchBytes(clipUrls(clip, resolveUrl)[format]);
          // decodeAudioData detaches its input, so decode a copy.
          const buffer = await decode(ctx, data.slice(0));
          buffers.set(clip, buffer);
          return buffer;
        } catch { /* try the next format */ }
      }
      buffers.set(clip, null);
      return null;
    })().catch(() => { buffers.set(clip, null); return null; });
    decoding.set(clip, job);
    return job;
  }

  function decodeAll() {
    if (!ctx) return Promise.resolve();
    return Promise.all(Object.keys(SFX_CLIPS).map(decodeClip)).then(() => undefined);
  }

  function applyLevel() {
    if (!master || !ctx) return;
    const level = muted || hidden ? 0 : MASTER;
    try {
      master.gain.cancelScheduledValues?.(ctx.currentTime);
      master.gain.setTargetAtTime
        ? master.gain.setTargetAtTime(level, ctx.currentTime, 0.03)
        : (master.gain.value = level);
    } catch { master.gain.value = level; }
  }

  function stopAll() {
    for (const list of voices.values()) for (const v of list) { try { v.src.stop(); } catch { /* already stopped */ } }
    voices.clear();
  }

  /** Call from a user gesture. Creates/resumes the context and starts decoding. */
  function unlock() {
    if (unlocked) {
      if (ctx?.state === 'suspended' && !hidden) ctx.resume?.()?.catch?.(() => {});
      return;
    }
    unlocked = true;
    try {
      ctx = createContext();
      if (!ctx) return;
      master = ctx.createGain();
      master.gain.value = muted || hidden ? 0 : MASTER;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});
      decodeAll();
    } catch {
      ctx = null;
      master = null;
    }
  }

  function pickClip(name, clips) {
    if (clips.length === 1) return clips[0];
    const prev = lastClip.get(name);
    const pool = clips.filter(c => c !== prev);
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }

  /**
   * Play a sound by name. `delay` (seconds) schedules it on the audio clock.
   * Returns true when a voice started.
   */
  function play(rawName, { delay = 0, volume = 1 } = {}) {
    const name = resolveSfxName(rawName);
    if (!name || !ctx || !master || muted || hidden) return false;
    if (ctx.state && ctx.state !== 'running') return false;
    const def = SFX[name];
    const at = ctx.currentTime + Math.max(0, delay);
    const prevAt = lastStart.get(name);
    if (prevAt !== undefined && Math.abs(at - prevAt) < (def.gap || 0)) return false;
    const clip = pickClip(name, def.clips);
    const buffer = buffers.get(clip);
    if (!buffer) { if (!buffers.has(clip)) decodeClip(clip); return false; }
    const now = ctx.currentTime;
    const live = (voices.get(name) || []).filter(v => v.endsAt > now);
    while (live.length >= (def.voices || 1)) {
      const oldest = live.shift();
      try {
        oldest.gain.gain.setTargetAtTime?.(0, Math.max(now, at - 0.02), 0.01);
        oldest.src.stop(at);
      } catch { /* already stopped */ }
    }
    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buffer;
      // Frequent sounds get a hair of pitch spread so repeats do not sound stamped.
      if (def.clips.length > 1 && src.playbackRate) src.playbackRate.value = 0.96 + random() * 0.08;
      gain.gain.value = Math.max(0, Math.min(1, def.volume * volume));
      src.connect(gain);
      gain.connect(master);
      src.start(at);
      const voice = { src, gain, endsAt: at + (buffer.duration || 0) / (src.playbackRate?.value || 1) };
      live.push(voice);
      voices.set(name, live);
      lastStart.set(name, at);
      lastClip.set(name, clip);
      src.onended = () => {
        const list = voices.get(name);
        if (list) voices.set(name, list.filter(v => v !== voice));
      };
      return true;
    } catch {
      return false;
    }
  }

  function setMuted(next) {
    muted = Boolean(next);
    try { storage?.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage may be blocked */ }
    if (muted) stopAll();
    applyLevel();
    for (const fn of listeners) { try { fn(muted); } catch { /* ignore */ } }
    return muted;
  }

  function setHidden(next) {
    hidden = Boolean(next);
    if (hidden) stopAll();
    applyLevel();
    try {
      if (hidden) ctx?.suspend?.()?.catch?.(() => {});
      else if (unlocked) ctx?.resume?.()?.catch?.(() => {});
    } catch { /* ignore */ }
  }

  try {
    doc?.addEventListener?.('visibilitychange', () => setHidden(doc.hidden));
    globalThis.addEventListener?.('pagehide', () => setHidden(true));
    globalThis.addEventListener?.('pageshow', () => setHidden(Boolean(doc?.hidden)));
  } catch { /* ignore */ }

  return {
    play,
    unlock,
    preload,
    decodeAll,
    setMuted,
    isMuted: () => muted,
    toggleMuted: () => setMuted(!muted),
    onMuteChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    setHidden,
    // For tests and debugging.
    _state: () => ({ ctx, unlocked, hidden, muted, voices, buffers }),
  };
}

let shared = null;
function player() {
  if (!shared) shared = createSoundPlayer();
  return shared;
}

export const sfx = (name, opts) => player().play(name, opts);
export const unlockSfx = () => player().unlock();
export const preloadSfx = () => player().preload();
export const isSfxMuted = () => player().isMuted();
export const setSfxMuted = muted => player().setMuted(muted);
export const toggleSfxMuted = () => player().toggleMuted();
