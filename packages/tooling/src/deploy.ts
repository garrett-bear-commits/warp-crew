// Provider-neutral static release layout (ADR-023, §10): hashed immutable assets under
// `v/<releaseId>/`, a top-level no-cache `index.html` rewritten to point at the release, a
// `manifest.json` {game, env, buildVersion, contractVersion, takenAt, releaseId, files} and a
// `headers.json` documenting the cache-control policy. In place and hash-verified: the previous
// releases stay under v/ (history) and index.html is swapped only after every listed file's
// sha256 was re-verified on disk.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { repoRoot, walk } from './paths.ts';

export interface ReleaseManifest {
  game: string;
  env: string;
  buildVersion: string;
  contractVersion: string;
  takenAt: string;
  releaseId: string;
  files: Record<string, string>;
}

export const HEADERS_POLICY = {
  '/index.html': { 'cache-control': 'no-cache' },
  '/manifest.json': { 'cache-control': 'no-cache' },
  '/headers.json': { 'cache-control': 'no-cache' },
  '/v/*': { 'cache-control': 'public, max-age=31536000, immutable' },
} as const;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Hex(readFileSync(path));
}

/** Read CONTRACT_VERSION from packages/contracts/src/enums.ts without loading TypeBox. */
export function readContractVersion(root = repoRoot()): string {
  const src = readFileSync(resolve(root, 'packages/contracts/src/enums.ts'), 'utf8');
  const m = /export const CONTRACT_VERSION\s*=\s*'([^']+)'/.exec(src);
  if (!m?.[1]) throw new Error('CONTRACT_VERSION not found in packages/contracts/src/enums.ts');
  return m[1];
}

/** Posix-style relative path map of every file in `dist` → sha256. */
export function hashDir(dist: string): Record<string, string> {
  const files = walk(dist, () => true, [], ['.git']).sort();
  const out: Record<string, string> = {};
  for (const f of files) out[relative(dist, f).split(sep).join('/')] = sha256File(f);
  return out;
}

export interface ReleaseInput {
  game: string;
  env: string;
  buildVersion: string;
  contractVersion: string;
  takenAt: string;
  files: Record<string, string>;
}

/**
 * Pure planner. The releaseId is content-addressed: sha256 over {game, env, buildVersion,
 * contractVersion, files} (sorted keys, takenAt excluded) prefix 12 — redeploying the very same
 * build yields the same id instead of a new history entry.
 */
export function planRelease(input: ReleaseInput): ReleaseManifest {
  const files = sortKeys(input.files);
  const idSource = JSON.stringify({
    game: input.game,
    env: input.env,
    buildVersion: input.buildVersion,
    contractVersion: input.contractVersion,
    files,
  });
  return {
    game: input.game,
    env: input.env,
    buildVersion: input.buildVersion,
    contractVersion: input.contractVersion,
    takenAt: input.takenAt,
    releaseId: sha256Hex(idSource).slice(0, 12),
    files,
  };
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Rewrite asset references in index.html so the no-cache top-level copy points into
 * `v/<releaseId>/`. Handles `./assets/x`, `/assets/x` and bare `assets/x` in src/href attributes,
 * preserving the original prefix style.
 */
export function rewriteIndexHtml(html: string, releaseId: string, files: string[]): string {
  let out = html;
  for (const f of files) {
    if (f === 'index.html') continue;
    const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(\\s(?:src|href)=["'])(\\./|/)?${escaped}(["'])`, 'g'),
      (_m, pre: string, prefix: string | undefined, post: string) =>
        `${pre}${prefix ?? ''}v/${releaseId}/${f}${post}`,
    );
  }
  return out;
}

export interface DeployResult {
  manifest: ReleaseManifest;
  releaseDir: string;
  reused: boolean;
  previousReleases: string[];
}

export function readManifest(out: string): ReleaseManifest | null {
  const p = join(out, 'manifest.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as ReleaseManifest;
}

/** Copy dist into <out>/v/<releaseId>/, verify hashes, then swap index.html + manifest.json. */
export function deployStatic(opts: {
  dist: string;
  out: string;
  game: string;
  env: string;
  buildVersion: string;
  contractVersion: string;
  takenAt: string;
}): DeployResult {
  if (!existsSync(join(opts.dist, 'index.html')))
    throw new Error(`${opts.dist} has no index.html (build the client first)`);
  const files = hashDir(opts.dist);
  const manifest = planRelease({ ...opts, files });
  const previous = readManifest(opts.out);
  const previousReleases: string[] = [];
  const vDir = join(opts.out, 'v');
  if (existsSync(vDir)) {
    for (const d of walk(vDir, (p) => p.endsWith(`${sep}manifest.json`), [], [])) {
      const id = relative(vDir, dirname(d));
      if (id !== manifest.releaseId) previousReleases.push(id);
    }
  }
  const releaseDir = join(vDir, manifest.releaseId);
  const reused = previous?.releaseId === manifest.releaseId && verifyRelease(opts.out).ok;
  if (!reused) {
    for (const [rel, hash] of Object.entries(files)) {
      const target = join(releaseDir, ...rel.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(opts.dist, ...rel.split('/')), target);
      const onDisk = sha256File(target);
      if (onDisk !== hash)
        throw new Error(`hash mismatch after copy: ${rel} expected ${hash} got ${onDisk}`);
    }
    writeFileSync(join(releaseDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  // Every listed file verified on disk → now (and only now) swap the no-cache entry points.
  const problems = verifyFiles(releaseDir, manifest.files);
  if (problems.length) throw new Error(`release verification failed:\n${problems.join('\n')}`);
  const html = rewriteIndexHtml(
    readFileSync(join(opts.dist, 'index.html'), 'utf8'),
    manifest.releaseId,
    Object.keys(manifest.files),
  );
  atomicWrite(join(opts.out, 'index.html'), html);
  atomicWrite(join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  atomicWrite(join(opts.out, 'headers.json'), JSON.stringify(HEADERS_POLICY, null, 2) + '\n');
  return { manifest, releaseDir, reused, previousReleases: previousReleases.sort() };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function verifyFiles(dir: string, files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [rel, hash] of Object.entries(files)) {
    const p = join(dir, ...rel.split('/'));
    if (!existsSync(p)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    const actual = sha256File(p);
    if (actual !== hash) problems.push(`${rel}: expected ${hash} got ${actual}`);
  }
  return problems;
}

/** Re-hash the current release named by <out>/manifest.json; also checks index.html points at it. */
export function verifyRelease(out: string): {
  ok: boolean;
  problems: string[];
  releaseId?: string;
} {
  const manifest = readManifest(out);
  if (!manifest) return { ok: false, problems: ['manifest.json missing'] };
  const releaseDir = join(out, 'v', manifest.releaseId);
  const problems = verifyFiles(releaseDir, manifest.files);
  const indexPath = join(out, 'index.html');
  if (!existsSync(indexPath)) problems.push('index.html missing');
  else {
    const html = readFileSync(indexPath, 'utf8');
    const refs = [...html.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const r of refs) {
      if (/^(https?:)?\/\//.test(r) || r.startsWith('data:')) continue;
      const clean = r.replace(/^\.?\//, '');
      if (!clean.startsWith(`v/${manifest.releaseId}/`))
        problems.push(`index.html references ${r} outside v/${manifest.releaseId}/`);
      else if (!existsSync(join(out, ...clean.split('/'))))
        problems.push(`index.html references missing ${r}`);
    }
  }
  return { ok: problems.length === 0, problems, releaseId: manifest.releaseId };
}
