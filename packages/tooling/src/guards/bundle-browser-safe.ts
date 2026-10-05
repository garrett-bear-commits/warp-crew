// §3: browser bundles contain zero node modules and zero TypeBox runtime. Scans built assets.
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { repoRoot, walk, read } from '../paths.ts';
import type { GuardResult } from './run-all.ts';

const BUNDLE_DIRS = [
  'apps/template-game/dist',
  'apps/server/admin-inspector/dist',
  'apps/idle-civ/dist',
];

const MARKERS: Array<[RegExp, string]> = [
  [/TypeBox\.Kind/, 'TypeBox runtime symbol'],
  [/Symbol\.for\(["']TypeBox/, 'TypeBox runtime symbol'],
  [/@sinclair\/typebox/, 'TypeBox import'],
  [/\bfrom\s*["']node:[a-z_]+["']/, 'node builtin import'],
  [/\brequire\(["']node:[a-z_]+["']\)/, 'node builtin require'],
  [
    /["']node:crypto["']|["']node:fs["']|["']node:zlib["']|["']node:http["']/,
    'node builtin reference',
  ],
  [/createHmac\(/, 'node crypto HMAC (verifiers are node-only)'],
  [/JEST_JWS_SECRETS|ADMIN_KEYS|OPS_SECRET/, 'server secret name in browser bundle'],
];

export function guardBundlesBrowserSafe(): GuardResult {
  const root = repoRoot();
  const violations: string[] = [];
  let scanned = 0;
  const missing: string[] = [];
  for (const d of BUNDLE_DIRS) {
    const dir = resolve(root, d);
    if (!existsSync(dir)) {
      missing.push(d);
      continue;
    }
    for (const f of walk(dir, (p) => /\.(js|mjs|html)$/.test(p), [], ['.git'])) {
      scanned++;
      const src = read(f);
      for (const [re, what] of MARKERS) {
        const m = re.exec(src);
        if (m) violations.push(`${relative(root, f)}: ${what} (${m[0].slice(0, 40)})`);
      }
    }
  }
  if (missing.length)
    violations.push(`bundles not built: ${missing.join(', ')} (run pnpm build first)`);
  return {
    name: 'bundle-browser-safe (§3)',
    ok: violations.length === 0,
    violations,
    note: `${scanned} bundle files scanned`,
  };
}
