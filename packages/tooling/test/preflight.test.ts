// preflight: .env parsing + the same refusals as packages/server/src/config.ts validateConfig().
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvFile, preflightEnv, parseAdminKeysShape, cliMain } from '../src/index.ts';

// fixture values (test-only)
const JWS_FIXTURE = Buffer.alloc(16, 7).toString('base64');
const SHA_FIXTURE = 'a'.repeat(64);
const ADMIN_FIXTURE = JSON.stringify({
  dev: { secretSha256: SHA_FIXTURE, scopes: ['read', 'grant'] },
});

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgres://u:p@db/x',
    GAME_ID: 'template',
    GAME_ENV: 'prod',
    JEST_JWS_SECRETS: JWS_FIXTURE,
    OPS_SECRET: 'ops-secret-0123456789',
    ADMIN_KEYS: ADMIN_FIXTURE,
    BUILD_VERSION: '1.0.0',
    PUBLIC_URL: 'http://api.test',
    ...overrides,
  };
}

describe('parseEnvFile', () => {
  it('handles comments, export, quotes and inline comments', () => {
    const env = parseEnvFile(
      [
        '# comment',
        '',
        'A=1',
        'export B="two words"',
        "C='single # not comment'",
        'D=value # trailing comment',
        'E={"json":"x"}',
        'not a line',
      ].join('\n'),
    );
    expect(env).toEqual({
      A: '1',
      B: 'two words',
      C: 'single # not comment',
      D: 'value',
      E: '{"json":"x"}',
    });
  });
});

describe('preflightEnv', () => {
  it('accepts a complete prod env', () => {
    const r = preflightEnv(baseEnv());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(
      r.checks.some((c) => c.name === 'ADMIN_KEYS JSON shape' && c.detail === '1 key(s)'),
    ).toBe(true);
  });

  it('prod refuses memory rate store, mock providers, PGSSL=off, STATIC_DIR', () => {
    const r = preflightEnv(
      baseEnv({
        RATE_LIMIT_STORE: 'memory',
        IDENTITY_PROVIDER: 'mock',
        PAYMENTS_PROVIDER: 'mock',
        PGSSL: 'off',
        STATIC_DIR: '/srv',
      }),
    );
    expect(r.ok).toBe(false);
    const p = r.problems.join('\n');
    expect(p).toMatch(/RATE_LIMIT_STORE=pg/);
    expect(p).toMatch(/IDENTITY_PROVIDER=jest/);
    expect(p).toMatch(/PAYMENTS_PROVIDER=jest/);
    expect(p).toMatch(/PGSSL/);
    expect(p).toMatch(/STATIC_DIR/);
  });

  it('prod refuses a BUILD_VERSION that is not a release X.Y.Z, as the server does', () => {
    for (const bad of ['dev', 'v0.22.0', '0.22.1-staging.9'])
      expect(preflightEnv(baseEnv({ BUILD_VERSION: bad })).problems.join('\n'), bad).toMatch(
        /prod: BUILD_VERSION is a release X.Y.Z/,
      );
    // With the deploy-written record the server reads the version from the file instead.
    expect(
      preflightEnv(
        baseEnv({ BUILD_VERSION: '', BUILD_INFO_FILE: '/app/infra/railway/build-info.json' }),
      ).problems,
    ).toEqual([]);
    expect(preflightEnv(baseEnv({ GAME_ENV: 'lab', BUILD_VERSION: 'dev' })).problems).toEqual([]);
  });

  it('lab/dev allow memory + mock but still require secrets and admin keys', () => {
    const ok = preflightEnv(
      baseEnv({
        GAME_ENV: 'lab',
        RATE_LIMIT_STORE: 'memory',
        IDENTITY_PROVIDER: 'mock',
        PGSSL: 'off',
        JEST_JWS_SECRETS: '',
      }),
    );
    expect(ok.problems).toEqual([]);
    const bad = preflightEnv(baseEnv({ GAME_ENV: 'dev', OPS_SECRET: 'short', ADMIN_KEYS: '{}' }));
    expect(bad.problems.join('\n')).toMatch(/OPS_SECRET ≥ 16/);
    expect(bad.problems.join('\n')).toMatch(/ADMIN_KEYS non-empty/);
  });

  it('checks JEST_JWS_SECRETS presence + entry length, OPS_SECRET, GAME_ID/GAME_ENV, ADMIN_KEYS shape', () => {
    expect(preflightEnv(baseEnv({ JEST_JWS_SECRETS: '' })).problems.join('\n')).toMatch(
      /JEST_JWS_SECRETS present/,
    );
    expect(
      preflightEnv(baseEnv({ JEST_JWS_SECRETS: `${JWS_FIXTURE},c2hvcnQ=` })).problems.join('\n'),
    ).toMatch(/base64 ≥ 16 bytes/);
    expect(preflightEnv(baseEnv({ OPS_SECRET: '' })).problems.join('\n')).toMatch(
      /OPS_SECRET present/,
    );
    expect(preflightEnv(baseEnv({ GAME_ID: 'Bad Id' })).problems.join('\n')).toMatch(
      /GAME_ID valid/,
    );
    expect(preflightEnv(baseEnv({ GAME_ENV: 'staging' })).problems.join('\n')).toMatch(
      /GAME_ENV valid/,
    );
    expect(preflightEnv(baseEnv({ ADMIN_KEYS: 'nope' })).problems.join('\n')).toMatch(
      /not valid JSON/,
    );
    expect(
      preflightEnv(
        baseEnv({ ADMIN_KEYS: JSON.stringify({ k: { secretSha256: 'zz', scopes: ['read'] } }) }),
      ).problems.join('\n'),
    ).toMatch(/sha256 hex/);
    expect(
      preflightEnv(
        baseEnv({
          ADMIN_KEYS: JSON.stringify({ k: { secretSha256: SHA_FIXTURE, scopes: ['root'] } }),
        }),
      ).problems.join('\n'),
    ).toMatch(/scopes/);
    expect(preflightEnv(baseEnv({ DATABASE_URL: '' })).problems.join('\n')).toMatch(/DATABASE_URL/);
  });

  it('parseAdminKeysShape mirrors config.ts parseAdminKeys', () => {
    expect(parseAdminKeysShape('[]')).toEqual({
      ok: false,
      problem: 'must be an object keyed by keyId',
    });
    expect(parseAdminKeysShape(ADMIN_FIXTURE)).toEqual({ ok: true, count: 1 });
  });

  it('CLI prints a checklist and exits non-zero on problems', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'foundation-preflight-'));
    try {
      const good = join(tmp, 'good.env');
      const env = baseEnv();
      writeFileSync(
        good,
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n',
      );
      const lines: string[] = [];
      const io = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
      expect(await cliMain(['preflight', '--env-file', good], io)).toBe(0);
      expect(lines.join('\n')).toContain('preflight: OK');
      expect(lines.join('\n')).toMatch(/\[ok\]\s+DATABASE_URL set/);
      const bad = join(tmp, 'bad.env');
      writeFileSync(bad, 'GAME_ID=template\nGAME_ENV=prod\nRATE_LIMIT_STORE=memory\n');
      lines.length = 0;
      expect(await cliMain(['preflight', '--env-file', bad], io)).toBe(1);
      expect(lines.join('\n')).toMatch(/\[FAIL\] prod: RATE_LIMIT_STORE=pg/);
      expect(lines.join('\n')).toMatch(/preflight: \d+ problem/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
