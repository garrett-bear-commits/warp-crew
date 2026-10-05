// Env preflight (§10 "< 1 h to check-health green"): parse a .env file and apply the same
// refusals as packages/server/src/config.ts — re-implemented here so the tool never loads
// fastify/env-schema. Keep this list in step with validateConfig().
import { ADMIN_SCOPES, GAME_ENVS } from '@foundation/contracts/enums';
import { RELEASE_VERSION_PATTERN } from '@foundation/contracts/versions';

export interface EnvCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: EnvCheck[];
  problems: string[];
}

/** Parse KEY=VALUE lines (export prefix, quotes, # comments, blank lines). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

const GAME_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function preflightEnv(env: Record<string, string>): PreflightResult {
  const checks: EnvCheck[] = [];
  const problems: string[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push(detail !== undefined ? { name, ok, detail } : { name, ok });
    if (!ok) problems.push(detail ? `${name}: ${detail}` : name);
  };
  const get = (k: string) => (env[k] ?? '').trim();

  check('DATABASE_URL set', get('DATABASE_URL').length > 0, 'required');
  check(
    'GAME_ID valid',
    GAME_ID_RE.test(get('GAME_ID')) && get('GAME_ID').length <= 64,
    `must match ${GAME_ID_RE.source} (got "${get('GAME_ID')}")`,
  );
  const gameEnv = get('GAME_ENV');
  const envOk = (GAME_ENVS as readonly string[]).includes(gameEnv);
  check('GAME_ENV valid', envOk, `one of ${GAME_ENVS.join('|')} (got "${gameEnv}")`);
  const prod = gameEnv === 'prod';

  const rateStore = get('RATE_LIMIT_STORE') || 'pg';
  const identity = get('IDENTITY_PROVIDER') || 'jest';
  const payments = get('PAYMENTS_PROVIDER') || 'jest';
  const pgSsl = get('PGSSL') || (prod ? 'verify' : 'off');
  check('RATE_LIMIT_STORE', ['pg', 'memory'].includes(rateStore), `pg|memory (got "${rateStore}")`);
  check('IDENTITY_PROVIDER', ['jest', 'mock'].includes(identity), `jest|mock (got "${identity}")`);
  check('PAYMENTS_PROVIDER', ['jest', 'mock'].includes(payments), `jest|mock (got "${payments}")`);
  check(
    'PGSSL',
    ['verify', 'require', 'off'].includes(pgSsl),
    `verify|require|off (got "${pgSsl}")`,
  );
  if (prod) {
    check('prod: RATE_LIMIT_STORE=pg', rateStore === 'pg', 'memory store is dev/lab only');
    check('prod: IDENTITY_PROVIDER=jest', identity === 'jest', 'mock identity refused in prod');
    check('prod: PAYMENTS_PROVIDER=jest', payments === 'jest', 'mock payments refused in prod');
    check('prod: PGSSL verify|require', pgSsl !== 'off', 'PGSSL=off refused in prod');
    check(
      'prod: STATIC_DIR unset',
      get('STATIC_DIR') === '',
      'serving the client from the API is Lab/dev only',
    );
  }

  const secrets = get('JEST_JWS_SECRETS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (identity === 'jest') {
    check('JEST_JWS_SECRETS present', secrets.length > 0, 'required when IDENTITY_PROVIDER=jest');
  }
  const shortSecret = secrets.find((s) => !isBase64(s) || Buffer.from(s, 'base64').length < 16);
  check(
    'JEST_JWS_SECRETS entries base64 ≥ 16 bytes',
    shortSecret === undefined,
    shortSecret === undefined ? undefined : 'an entry is not base64 of at least 16 bytes',
  );

  const ops = get('OPS_SECRET');
  check('OPS_SECRET present', ops.length > 0, 'required');
  check('OPS_SECRET ≥ 16 chars', ops.length === 0 || ops.length >= 16, `got ${ops.length}`);

  const admin = parseAdminKeysShape(get('ADMIN_KEYS') || '{}');
  check('ADMIN_KEYS JSON shape', admin.ok, admin.ok ? `${admin.count} key(s)` : admin.problem);
  if (admin.ok) check('ADMIN_KEYS non-empty', admin.count > 0, 'at least one key required');

  const build = get('BUILD_VERSION');
  const buildInfo = get('BUILD_INFO_FILE');
  check(
    'BUILD_VERSION or BUILD_INFO_FILE set',
    build.length > 0 || buildInfo.length > 0,
    'set the release version (used in manifests + 426 minBuild), or the deploy-written build record',
  );
  // Without a build record, prod boots on BUILD_VERSION and refuses anything but a release.
  if (prod && !buildInfo)
    check(
      'prod: BUILD_VERSION is a release X.Y.Z',
      RELEASE_VERSION_PATTERN.test(build),
      `no v, no -prerelease (got "${build}")`,
    );
  if (prod)
    check('prod: PUBLIC_URL set', get('PUBLIC_URL').length > 0, 'admin inspector connect-src');

  return { ok: problems.length === 0, checks, problems };
}

function isBase64(s: string): boolean {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(s);
}

export function parseAdminKeysShape(
  json: string,
): { ok: true; count: number } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, problem: 'not valid JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, problem: 'must be an object keyed by keyId' };
  let count = 0;
  for (const [keyId, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { secretSha256?: unknown; scopes?: unknown };
    if (typeof o?.secretSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(o.secretSha256))
      return { ok: false, problem: `${keyId}.secretSha256 must be a sha256 hex` };
    if (
      !Array.isArray(o.scopes) ||
      o.scopes.length === 0 ||
      !o.scopes.every((s) => (ADMIN_SCOPES as readonly string[]).includes(String(s)))
    )
      return {
        ok: false,
        problem: `${keyId}.scopes must be a non-empty list of ${ADMIN_SCOPES.join('|')}`,
      };
    count++;
  }
  return { ok: true, count };
}

export function formatChecklist(r: PreflightResult): string[] {
  const lines = r.checks.map(
    (c) => `${c.ok ? '[ok]  ' : '[FAIL]'} ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ''}`,
  );
  lines.push(r.ok ? 'preflight: OK' : `preflight: ${r.problems.length} problem(s)`);
  return lines;
}
