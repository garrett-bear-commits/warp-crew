// §7: no secrets in client packages (or anywhere in the repo). Heuristic scan for private keys,
// non-example env files, and long high-entropy assignments to secret-like names.
import { relative } from 'node:path';
import { repoRoot, walk, read } from '../paths.ts';
import type { GuardResult } from './run-all.ts';

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key material'],
  [
    /\b(JEST_JWS_SECRETS|OPS_SECRET|ADMIN_KEYS|DATABASE_URL)\s*=\s*['"]?[A-Za-z0-9+/=_:@.-]{24,}/,
    'secret-like env assignment with a real-looking value',
  ],
  [/\bsk_live_[A-Za-z0-9]{16,}/, 'live API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
];

export function guardNoSecrets(): GuardResult {
  const root = repoRoot();
  const violations: string[] = [];
  const files = walk(
    root,
    (p) => /\.(ts|tsx|js|json|yml|yaml|env|md|sql|html)$/.test(p) || /\/\.env(\..+)?$/.test(p),
  );
  for (const f of files) {
    const rel = relative(root, f);
    if (/\/\.env(\.[^/]+)?$/.test(rel) && !rel.endsWith('.example')) {
      violations.push(`${rel}: env file committed (only .env.example allowed)`);
      continue;
    }
    if (rel.includes('tooling/src/guards/')) continue;
    // .env.example files hold documented placeholders (dev-only local URLs, CHANGE_ME values)
    if (rel.endsWith('.env.example')) continue;
    const src = read(f);
    for (const [re, what] of PATTERNS) {
      const m = re.exec(src);
      if (
        m &&
        !/example|fixture|test|placeholder|CHANGE_ME|dev-only/i.test(
          m[0] + src.slice(Math.max(0, m.index - 80), m.index),
        )
      ) {
        violations.push(`${rel}: ${what}`);
      }
    }
  }
  return {
    name: 'no-secrets (§7)',
    ok: violations.length === 0,
    violations,
    note: `${files.length} files scanned`,
  };
}
