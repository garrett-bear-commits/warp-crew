#!/usr/bin/env node
/**
 * Cut, level and encode the game's sound effects from the Kenney CC0 packs.
 *
 *   node scripts/build-audio.mjs /path/to/folder-with-kenney-packs
 *
 * The folder holds kenney_sci-fi-sounds/, kenney_impact-sounds/ and kenney_interface-sounds/
 * (each with Audio/*.ogg). Clips and cuts come from src/data/sfxManifest.js. Every clip is made
 * mono 48 kHz, trimmed of leading/trailing silence, capped and faded, then gain-matched to the
 * same gated RMS (peaks kept under -1 dBFS) and written as public/audio/<clip>.ogg (Opus) and
 * public/audio/<clip>.m4a (AAC). Per-sound mix levels live in the manifest, not in the files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SFX_CLIPS } from '../src/data/sfxManifest.js';

const SR = 48000;
const TARGET_RMS_DB = -18;
const PEAK_DB = -1;
const SILENCE_DB = -55;

const srcRoot = process.argv[2] || process.env.KENNEY_DIR;
if (!srcRoot) {
  console.error('usage: node scripts/build-audio.mjs <folder with kenney_* packs>');
  process.exit(1);
}
const outDir = fileURLToPath(new URL('../public/audio/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const db = x => 20 * Math.log10(Math.max(1e-9, x));
const fromDb = d => 10 ** (d / 20);

function decode(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`decode failed: ${path}\n${r.stderr}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
}

function cut(x, { start: skip = 0, dur, fadeIn = 0.003, fadeOut = 0.02, repeat = 1, pad = 0 }) {
  const floor = fromDb(SILENCE_DB);
  let start = Math.round(skip * SR);
  while (start < x.length && Math.abs(x[start]) < floor) start += 1;
  let y = x.subarray(start, Math.min(x.length, start + Math.round(dur * SR)));
  let end = y.length;
  while (end > 0 && Math.abs(y[end - 1]) < floor) end -= 1;
  y = Float32Array.from(y.subarray(0, end));
  const fi = Math.min(y.length, Math.round(fadeIn * SR));
  for (let i = 0; i < fi; i++) y[i] *= i / fi;
  const fo = Math.min(y.length, Math.round(fadeOut * SR));
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= (i / fo) ** 2;
  if (repeat <= 1) return y;
  const gap = Math.round(pad * SR);
  const out = new Float32Array(y.length * repeat + gap * (repeat - 1));
  for (let k = 0; k < repeat; k++) out.set(y, k * (y.length + gap));
  return out;
}

/** RMS over 10 ms windows within 30 dB of the loudest window, so silence and tails do not drag it down. */
function gatedRms(y) {
  const win = Math.round(SR * 0.01);
  const blocks = [];
  for (let i = 0; i < y.length; i += win) {
    let e = 0;
    const n = Math.min(win, y.length - i);
    for (let j = 0; j < n; j++) e += y[i + j] ** 2;
    blocks.push(e / n);
  }
  const loud = Math.max(...blocks);
  const kept = blocks.filter(e => e >= loud * 1e-3);
  return Math.sqrt(kept.reduce((a, b) => a + b, 0) / kept.length);
}

function level(y) {
  const peak = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const gain = Math.min(fromDb(TARGET_RMS_DB) / gatedRms(y), fromDb(PEAK_DB) / peak);
  return { y: y.map(v => v * gain), gainDb: db(gain), rmsDb: db(gatedRms(y) * gain), peakDb: db(peak * gain) };
}

function encode(y, path, codec) {
  const pcm = Buffer.from(y.buffer, y.byteOffset, y.byteLength);
  const args = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-map_metadata', '-1', ...codec, path];
  const r = spawnSync('ffmpeg', args, { input: pcm });
  if (r.status !== 0) throw new Error(`encode failed: ${path}\n${r.stderr}`);
  return statSync(path).size;
}

const aacEncoder = spawnSync('ffmpeg', ['-hide_banner', '-encoders']).stdout.toString().includes('aac_at') ? 'aac_at' : 'aac';
let total = 0;
const standIns = [];
for (const [clip, wanted] of Object.entries(SFX_CLIPS)) {
  const sourceOf = s => `${srcRoot}/${s.pack}/Audio/${s.file}.ogg`;
  // A clip whose pack is missing falls back to its sci-fi stand-in, and the build says so.
  const spec = existsSync(sourceOf(wanted)) || !wanted.alt ? wanted : wanted.alt;
  if (spec !== wanted) standIns.push(`${clip} (${wanted.file} -> ${spec.file})`);
  const { y, gainDb, rmsDb, peakDb } = level(cut(decode(sourceOf(spec)), spec));
  const ogg = encode(y, `${outDir}${clip}.ogg`, ['-c:a', 'libopus', '-b:a', '40k', '-vbr', 'on', '-application', 'audio']);
  const m4a = encode(y, `${outDir}${clip}.m4a`, ['-c:a', aacEncoder, '-b:a', '48k', '-movflags', '+faststart']);
  total += ogg + m4a;
  console.log(`${clip.padEnd(14)} ${spec.file.padEnd(28)} ${(y.length / SR).toFixed(2)}s gain ${gainDb.toFixed(1)}dB rms ${rmsDb.toFixed(1)} peak ${peakDb.toFixed(1)}  ogg ${(ogg / 1024).toFixed(1)}K m4a ${(m4a / 1024).toFixed(1)}K`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB`);
if (standIns.length) console.log(`STAND-INS (pack missing): ${standIns.join(', ')}`);
