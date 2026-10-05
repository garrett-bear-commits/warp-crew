import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { SFX, SFX_ALIASES, SFX_CLIPS } from '../src/data/sfxManifest.js';
import { createSoundPlayer, clipUrls, resolveSfxName, MUTE_KEY } from '../src/ui/sound.js';

// --- Names map to files that ship, inside the size budget, with credit. ---------------------
let total = 0;
for (const [name, def] of Object.entries(SFX)) {
  assert.ok(def.clips.length >= 1, `${name} has clips`);
  assert.ok(def.volume > 0 && def.volume <= 1, `${name} volume`);
  assert.ok(Number.isInteger(def.voices) && def.voices >= 1, `${name} voices`);
  for (const clip of def.clips) assert.ok(SFX_CLIPS[clip], `${name} -> ${clip} is cut in the manifest`);
}
for (const clip of Object.keys(SFX_CLIPS)) {
  assert.ok(Object.values(SFX).some(def => def.clips.includes(clip)), `${clip} is used by a sound`);
  const urls = clipUrls(clip, path => path);
  assert.equal(urls.ogg, `/audio/${clip}.ogg`);
  assert.equal(urls.m4a, `/audio/${clip}.m4a`);
  for (const ext of ['ogg', 'm4a']) {
    const info = await stat(new URL(`../public/audio/${clip}.${ext}`, import.meta.url));
    assert.ok(info.size > 200, `${clip}.${ext} is a real file`);
    total += info.size;
  }
}
assert.ok(total < 600 * 1024, `audio stays under 600 KB (is ${Math.round(total / 1024)} KB)`);
const license = await readFile(new URL('../public/audio/LICENSE.md', import.meta.url), 'utf8');
assert.match(license, /Kenney/);
assert.match(license, /CC0/);
for (const name of ['shot_burst', 'shot_heavy', 'shot_enemy', 'shield', 'hit', 'fire', 'fire_out', 'boom', 'alarm',
  'boarders', 'overcharge', 'board', 'rally', 'launch', 'jump', 'arrive', 'tap', 'confirm', 'error', 'coin', 'card', 'beacon']) {
  assert.ok(SFX[name], `${name} exists`);
}
assert.equal(resolveSfxName('pew'), 'shot_burst');
assert.equal(resolveSfxName('nope'), null);
for (const target of Object.values(SFX_ALIASES)) assert.ok(SFX[target]);

// --- A fake Web Audio world. ------------------------------------------------------------------
function fakeAudio() {
  const started = [];
  const stopped = [];
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    createGain() { return { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} }, connect() {} }; },
    createBufferSource() {
      const src = {
        buffer: null, playbackRate: { value: 1 }, connect() {},
        start(at) { src.at = at; started.push(src); },
        stop(at) { stopped.push({ src, at }); },
      };
      return src;
    },
    decodeAudioData(bytes) { return Promise.resolve({ duration: 0.3, bytes: bytes.byteLength }); },
  };
  return { ctx, started, stopped };
}
function fakeStorage(init = {}) {
  const data = { ...init };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
function fakeDoc() {
  const handlers = {};
  return { hidden: false, handlers, addEventListener: (t, fn) => { handlers[t] = fn; } };
}
const okFetch = async () => new ArrayBuffer(16);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function readyPlayer(opts = {}) {
  const audio = fakeAudio();
  const doc = opts.doc || fakeDoc();
  const player = createSoundPlayer({
    createContext: () => audio.ctx, fetchBytes: okFetch, storage: fakeStorage(), doc, resolveUrl: p => p,
    formats: ['ogg', 'm4a'], random: () => 0.5, ...opts,
  });
  player.unlock();
  await player.decodeAll();
  await flush();
  return { player, audio, doc };
}

// Never before a gesture.
{
  const audio = fakeAudio();
  let made = 0;
  const player = createSoundPlayer({ createContext: () => { made += 1; return audio.ctx; }, fetchBytes: okFetch, storage: fakeStorage(), doc: fakeDoc(), resolveUrl: p => p });
  player.preload();
  assert.equal(made, 0, 'preload fetches bytes without creating an AudioContext');
  assert.equal(player.play('tap'), false, 'no sound before unlock');
}

// Plays after unlock; unknown names are ignored.
{
  const { player, audio } = await readyPlayer();
  assert.equal(audio.ctx.state, 'running');
  assert.equal(player.play('tap'), true);
  assert.equal(player.play('pew'), true, 'old synth name still works');
  assert.equal(player.play('no_such_sound'), false);
  assert.ok(audio.started.length === 2);
}

// Voice limiting: a rapid volley never stacks past the cap, and the min gap drops near-duplicates.
{
  const { player, audio } = await readyPlayer();
  const cap = SFX.shot_burst.voices;
  let played = 0;
  for (let i = 0; i < 8; i++) {
    audio.ctx.currentTime = i * 0.06; // faster than each clip's 0.3 s length
    if (player.play('shot_burst')) played += 1;
  }
  assert.equal(played, 8);
  const live = player._state().voices.get('shot_burst').filter(v => v.endsAt > audio.ctx.currentTime);
  assert.ok(live.length <= cap, `at most ${cap} burst voices (had ${live.length})`);
  assert.ok(audio.stopped.length >= 8 - cap, 'oldest voices were cut');
  audio.ctx.currentTime = 10;
  assert.equal(player.play('alarm'), true);
  audio.ctx.currentTime = 11;
  assert.equal(player.play('alarm'), false, 'alarm does not repeat inside its gap');
  audio.ctx.currentTime = 10 + SFX.alarm.gap + 0.1;
  assert.equal(player.play('alarm'), true, 'alarm can sound again later');
  // Delayed sounds are scheduled on the audio clock.
  audio.ctx.currentTime = 20;
  assert.equal(player.play('shot_enemy', { delay: 0.25 }), true);
  assert.equal(audio.started.at(-1).at, 20.25);
}

// Mute persists per device and silences play.
{
  const storage = fakeStorage();
  const { player } = await readyPlayer({ storage });
  assert.equal(player.isMuted(), false);
  player.setMuted(true);
  assert.equal(storage.data[MUTE_KEY], '1');
  assert.equal(player.play('tap'), false);
  const again = await readyPlayer({ storage });
  assert.equal(again.player.isMuted(), true, 'mute survives a reload');
  assert.equal(again.player.play('tap'), false);
  again.player.toggleMuted();
  assert.equal(storage.data[MUTE_KEY], '0');
  assert.equal(again.player.play('tap'), true);
}

// Hidden pages go quiet and suspend.
{
  const doc = fakeDoc();
  const { player, audio } = await readyPlayer({ doc });
  doc.hidden = true;
  doc.handlers.visibilitychange();
  assert.equal(audio.ctx.state, 'suspended');
  assert.equal(player.play('tap'), false);
  doc.hidden = false;
  doc.handlers.visibilitychange();
  await flush();
  assert.equal(player.play('tap'), true);
}

// Silent failure: no Web Audio, a throwing constructor, missing files, undecodable files.
{
  const none = createSoundPlayer({ createContext: () => null, fetchBytes: okFetch, storage: fakeStorage(), doc: fakeDoc(), resolveUrl: p => p });
  none.unlock();
  assert.equal(none.play('tap'), false);

  const throws = createSoundPlayer({ createContext: () => { throw new Error('blocked'); }, fetchBytes: okFetch, storage: fakeStorage(), doc: fakeDoc(), resolveUrl: p => p });
  assert.doesNotThrow(() => throws.unlock());
  assert.equal(throws.play('boom'), false);

  const missing = await readyPlayer({ fetchBytes: async url => { throw new Error(`404 ${url}`); } });
  assert.equal(missing.player.play('hit'), false);

  const audio = fakeAudio();
  audio.ctx.decodeAudioData = () => Promise.reject(new Error('bad data'));
  const bad = await readyPlayer({ createContext: () => audio.ctx });
  assert.equal(bad.player.play('hit'), false);

  const noStore = await readyPlayer({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.doesNotThrow(() => noStore.player.setMuted(true));
  assert.equal(noStore.player.isMuted(), true);
}

// Falls back to AAC when Ogg will not decode (iOS WebKit).
{
  const audio = fakeAudio();
  const fetched = [];
  audio.ctx.decodeAudioData = bytes => bytes.byteLength === 8 ? Promise.reject(new Error('no ogg')) : Promise.resolve({ duration: 0.2 });
  const { player } = await readyPlayer({
    createContext: () => audio.ctx,
    fetchBytes: async url => { fetched.push(url); return new ArrayBuffer(url.endsWith('.ogg') ? 8 : 16); },
  });
  assert.equal(player.play('tap'), true);
  assert.ok(fetched.includes('/audio/tap.m4a'));
}

// Audio randomness never touches Math.random (seeded game state stays untouched).
{
  const { player, audio } = await readyPlayer({ random: () => 0.1 });
  const original = Math.random;
  Math.random = () => { throw new Error('sound must not use the shared RNG'); };
  try {
    for (let i = 0; i < 5; i++) { audio.ctx.currentTime = i; player.play('hit'); player.play('shot_heavy'); }
  } finally {
    Math.random = original;
  }
}

console.log('sound_player.test.mjs OK');
