// Minimal store-only ZIP writer + reader (ADR-023 zip fallback). No dependencies: CRC-32 comes
// from node:zlib, the container format is written by hand (local headers, central directory,
// end-of-central-directory). Store-only keeps it trivially verifiable; Vite output is already
// minified and hosts gzip on the wire.
import { crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { walk } from './paths.ts';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Epoch ms used for the DOS timestamp; defaults to 1980-01-01 for reproducible archives. */
  mtimeMs?: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;

function dosDateTime(ms: number | undefined): { time: number; date: number } {
  const d = new Date(ms ?? Date.UTC(1980, 0, 1));
  const year = Math.max(1980, d.getUTCFullYear());
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | Math.max(1, d.getUTCDate());
  const time =
    (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  return { time, date };
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of entries) {
    if (e.name.length === 0 || e.name.startsWith('/') || e.name.includes('..'))
      throw new Error(`invalid zip entry name: ${e.name}`);
    const name = Buffer.from(enc.encode(e.name));
    const crc = crc32(e.data) >>> 0;
    const { time, date } = dosDateTime(e.mtimeMs);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, Buffer.from(e.data));

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(VERSION, 4); // version made by
    cd.writeUInt16LE(VERSION, 6); // version needed
    cd.writeUInt16LE(FLAG_UTF8, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + e.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

export interface ZipListing {
  name: string;
  size: number;
  crc32: number;
  method: number;
  localOffset: number;
}

/** Parse the central directory (used by tests and by `zip --verify`). */
export function readZipDirectory(zip: Buffer): ZipListing[] {
  // EOCD is the last 22 bytes when there is no archive comment (we never write one), but scan
  // backwards anyway so archives from other writers still parse.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: end of central directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: ZipListing[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`bad central header at ${p}`);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    out.push({ name, size, crc32: crc, method, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extract one stored entry's bytes via its local header (store-only archives). */
export function readZipEntry(zip: Buffer, entry: ZipListing): Buffer {
  const p = entry.localOffset;
  if (zip.readUInt32LE(p) !== SIG_LOCAL) throw new Error(`bad local header at ${p}`);
  if (entry.method !== 0)
    throw new Error(`entry ${entry.name} is not stored (method ${entry.method})`);
  const nameLen = zip.readUInt16LE(p + 26);
  const extraLen = zip.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + entry.size);
  if (crc32(data) >>> 0 !== entry.crc32) throw new Error(`crc mismatch for ${entry.name}`);
  return Buffer.from(data);
}

/** Zip a directory (posix names relative to `dir`, sorted for reproducibility). */
export function zipDirectory(dir: string, mtimeMs?: number): Buffer {
  const files = walk(dir, () => true, [], ['.git']).sort();
  const entries: ZipEntry[] = files.map((f) => ({
    name: relative(dir, f).split(sep).join('/'),
    data: readFileSync(f),
    ...(mtimeMs !== undefined ? { mtimeMs } : {}),
  }));
  return writeZip(entries);
}
