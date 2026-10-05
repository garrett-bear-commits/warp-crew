// foundation zip --dist <dir> --out <file.zip> [--now <ms>]   (ADR-023 zip fallback)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readZipDirectory, readZipEntry, zipDirectory } from '../zip.ts';
import { flag, opt, optInt, parseArgs, type Io } from '../args.ts';

export const usage =
  'zip --dist <dir> --out <file.zip> [--now <epochMs>] | zip --verify --out <file.zip>';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const out = resolve(opt(args, 'out'));
  if (flag(args, 'verify')) {
    const buf = readFileSync(out);
    const entries = readZipDirectory(buf);
    for (const e of entries) readZipEntry(buf, e); // crc-checked
    io.log(`${out}: ${entries.length} entries verified`);
    return 0;
  }
  const dist = resolve(opt(args, 'dist'));
  const now = optInt(args, 'now');
  const buf = zipDirectory(dist, now);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  io.log(`wrote ${out} (${buf.length} bytes, ${readZipDirectory(buf).length} entries, store-only)`);
  return 0;
}
