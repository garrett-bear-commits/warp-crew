// §3 bundle-size gate: sum of gzip sizes of every .js/.css under a dist dir must be ≤ max bytes.
// Runs standalone (CI): `node --experimental-strip-types packages/tooling/src/bundle-size.ts <dist> <maxBytes>`
// and via `foundation bundle-size --dist <dir> --max-bytes <n>`.
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { walk } from './paths.ts';

export interface BundleFile {
  path: string;
  bytes: number;
  gzipBytes: number;
}

export interface BundleReport {
  files: BundleFile[];
  totalBytes: number;
  totalGzipBytes: number;
}

export function measureBundle(dist: string): BundleReport {
  if (!existsSync(dist)) throw new Error(`dist dir not found: ${dist}`);
  const files = walk(dist, (p) => /\.(js|mjs|css)$/.test(p), [], ['.git']).sort();
  const out: BundleFile[] = files.map((f) => {
    const buf = readFileSync(f);
    return {
      path: relative(dist, f),
      bytes: buf.length,
      gzipBytes: gzipSync(buf, { level: 9 }).length,
    };
  });
  return {
    files: out,
    totalBytes: out.reduce((a, f) => a + f.bytes, 0),
    totalGzipBytes: out.reduce((a, f) => a + f.gzipBytes, 0),
  };
}

export function checkBundleSize(
  dist: string,
  maxBytes: number,
): { ok: boolean; report: BundleReport; lines: string[] } {
  const report = measureBundle(dist);
  const lines = report.files.map((f) => `  ${f.path}: ${f.bytes} B (gzip ${f.gzipBytes} B)`);
  lines.push(
    `total gzip ${report.totalGzipBytes} B of ${maxBytes} B budget (${report.files.length} files)`,
  );
  const ok = report.totalGzipBytes <= maxBytes;
  lines.push(
    ok ? 'bundle-size: OK' : `bundle-size: FAIL (over by ${report.totalGzipBytes - maxBytes} B)`,
  );
  return { ok, report, lines };
}

/** Positional entry: <dist> <maxBytes>. */
export function runBundleSizeMain(argv: string[], log: (l: string) => void = console.log): number {
  const [dist, max] = argv;
  const maxBytes = Number(max);
  if (!dist || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    log('usage: bundle-size.ts <dist-dir> <max-gzip-bytes>');
    return 1;
  }
  try {
    const r = checkBundleSize(resolve(dist), maxBytes);
    for (const l of r.lines) log(l);
    return r.ok ? 0 : 1;
  } catch (e) {
    log(`bundle-size: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runBundleSizeMain(process.argv.slice(2)));
}
