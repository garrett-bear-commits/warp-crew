// zip fallback (ADR-023): store-only writer; the central directory reads back and every entry's
// bytes + crc32 match.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { writeZip, readZipDirectory, readZipEntry, zipDirectory, cliMain } from '../src/index.ts';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'foundation-zip-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('writeZip / readZipDirectory', () => {
  it('round-trips entries (names, sizes, crc, bytes) and writes valid signatures', () => {
    const entries = [
      { name: 'index.html', data: new TextEncoder().encode('<!doctype html><p>héllo</p>') },
      { name: 'assets/app-abc.js', data: new TextEncoder().encode('console.log("x")') },
      { name: 'assets/empty.txt', data: new Uint8Array(0) },
      { name: 'ünïcode/名前.txt', data: new TextEncoder().encode('naming') },
    ];
    const zip = writeZip(entries);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    const dir = readZipDirectory(zip);
    expect(dir.map((d) => d.name)).toEqual(entries.map((e) => e.name));
    for (const [i, d] of dir.entries()) {
      const e = entries[i]!;
      expect(d.method).toBe(0);
      expect(d.size).toBe(e.data.length);
      expect(d.crc32).toBe(crc32(e.data) >>> 0);
      expect(Buffer.from(readZipEntry(zip, d))).toEqual(Buffer.from(e.data));
    }
  });

  it('is deterministic for the same input and rejects unsafe names', () => {
    const e = [{ name: 'a.txt', data: new TextEncoder().encode('a') }];
    expect(writeZip(e).equals(writeZip(e))).toBe(true);
    expect(() => writeZip([{ name: '../x', data: new Uint8Array(0) }])).toThrow(
      /invalid zip entry name/,
    );
    expect(() => writeZip([{ name: '/abs', data: new Uint8Array(0) }])).toThrow(
      /invalid zip entry name/,
    );
  });

  it('detects a corrupted entry via crc', () => {
    const zip = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello world') }]);
    const dir = readZipDirectory(zip);
    const local = dir[0]!.localOffset;
    const nameLen = zip.readUInt16LE(local + 26);
    zip[local + 30 + nameLen] = 0x58; // flip first data byte
    expect(() => readZipEntry(zip, dir[0]!)).toThrow(/crc mismatch/);
  });

  it('zipDirectory + CLI zip/--verify write and validate an archive from a dist dir', async () => {
    const dist = join(tmp, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<p>x</p>');
    writeFileSync(join(dist, 'assets', 'a.js'), '1');
    const buf = zipDirectory(dist, 1_700_000_000_000);
    expect(readZipDirectory(buf).map((d) => d.name)).toEqual(['assets/a.js', 'index.html']);
    const out = join(tmp, 'release', 'client.zip');
    const lines: string[] = [];
    const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
    expect(await cliMain(['zip', '--dist', dist, '--out', out], io)).toBe(0);
    const onDisk = readFileSync(out);
    expect(readZipDirectory(onDisk).length).toBe(2);
    expect(await cliMain(['zip', '--verify', '--out', out], io)).toBe(0);
    expect(lines.join('\n')).toContain('2 entries verified');
  });
});
