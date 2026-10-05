import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** Recursively list files under dir, filtered by predicate; skips node_modules/dist/.git. */
export function walk(
  dir: string,
  pred: (p: string) => boolean,
  out: string[] = [],
  skip = [
    'node_modules',
    '.git',
    'dist',
    'coverage',
    'test-results',
    'playwright-report',
    'pgdata',
  ],
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (skip.includes(e)) continue;
    const p = resolve(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, pred, out, skip);
    else if (pred(p)) out.push(p);
  }
  return out;
}

export function read(p: string): string {
  return readFileSync(p, 'utf8');
}
