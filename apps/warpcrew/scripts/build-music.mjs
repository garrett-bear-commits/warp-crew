#!/usr/bin/env node
/**
 * Loudness-match and encode the game's music from the CC0 downloads named in src/data/musicManifest.js.
 *
 *   node scripts/build-music.mjs /path/to/folder-with-the-downloads
 *
 * Each track keeps its length and stereo (so the loop points stay where the composer put them), gets one linear
 * gain to TARGET_LUFS integrated (less if that would push the true peak over PEAK_DBTP; no compression), and is
 * written as public/audio/music/<file>.ogg (Opus) and public/audio/music/<file>.m4a (AAC). Per-track mix levels
 * live in the manifest, not in the files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MUSIC_TRACKS } from '../src/data/musicManifest.js';

const TARGET_LUFS = -16;
const PEAK_DBTP = -1.5;

const srcRoot = process.argv[2] || process.env.MUSIC_DIR;
if (!srcRoot) {
  console.error('usage: node scripts/build-music.mjs <folder with the downloaded tracks>');
  process.exit(1);
}
const outDir = fileURLToPath(new URL('../public/audio/music/', import.meta.url));
mkdirSync(outDir, { recursive: true });

function measure(path, filter = '') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', `${filter}ebur128=peak=true`, '-f', 'null', '-'],
    { maxBuffer: 1 << 26 });
  const log = r.stderr.toString().split('\n');
  const value = label => Number(log.filter(l => l.trim().startsWith(label)).pop()?.trim().split(/\s+/)[1]);
  return { lufs: value('I:'), peak: value('Peak:') };
}

function encode(input, gainDb, path, codec) {
  const args = ['-v', 'error', '-y', '-i', input, '-map_metadata', '-1', '-vn', '-af', `volume=${gainDb.toFixed(2)}dB`, ...codec, path];
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw new Error(`encode failed: ${path}\n${r.stderr}`);
  return statSync(path).size;
}

const aacEncoder = spawnSync('ffmpeg', ['-hide_banner', '-encoders']).stdout.toString().includes('aac_at') ? 'aac_at' : 'aac';
let total = 0;
for (const [id, track] of Object.entries(MUSIC_TRACKS)) {
  const input = `${srcRoot}/${track.source}`;
  if (!existsSync(input)) throw new Error(`missing download for ${id}: ${input} (from ${track.page})`);
  const before = measure(input);
  const gainDb = Math.min(TARGET_LUFS - before.lufs, PEAK_DBTP - before.peak);
  const ogg = encode(input, gainDb, `${outDir}${track.file}.ogg`, ['-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on', '-ar', '48000']);
  const m4a = encode(input, gainDb, `${outDir}${track.file}.m4a`, ['-c:a', aacEncoder, '-b:a', '112k', '-ar', '44100', '-movflags', '+faststart']);
  const after = measure(`${outDir}${track.file}.ogg`);
  total += ogg + m4a;
  console.log(`${id.padEnd(18)} gain ${gainDb.toFixed(1).padStart(5)} dB  ${before.lufs} -> ${after.lufs} LUFS  peak ${after.peak} dBTP`
    + `  ogg ${(ogg / 1024).toFixed(0)}K m4a ${(m4a / 1024).toFixed(0)}K`);
}
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB (a player downloads one format, one track at a time)`);
