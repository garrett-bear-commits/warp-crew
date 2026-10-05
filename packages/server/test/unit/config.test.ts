import { describe, expect, it } from 'vitest';
import { loadConfig, parseAdminKeys, ConfigError, validateConfig } from '../../src/config.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const base = {
  DATABASE_URL: 'postgres://x:y@localhost:5432/db',
  GAME_ID: 'template',
  GAME_ENV: 'dev',
  IDENTITY_PROVIDER: 'mock',
  PAYMENTS_PROVIDER: 'mock',
  ADMIN_KEYS: JSON.stringify({ k1: { secretSha256: sha('s'), scopes: ['read'] } }),
  OPS_SECRET: 'x'.repeat(20),
  RATE_LIMIT_STORE: 'memory',
};

describe('config: env-schema + fail-closed validation', () => {
  it('loads a dev config', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      gameId: 'template',
      env: 'dev',
      identityProvider: 'mock',
      rateLimitStore: 'memory',
      pgSsl: 'off',
      port: 8080,
    });
  });
  it('log shipping: off without POSTHOG_LOGS_TOKEN; the URL must be http(s)', () => {
    expect(loadConfig(base)).toMatchObject({ posthogLogsToken: '', posthogLogsUrl: '' });
    expect(loadConfig({ ...base, POSTHOG_LOGS_TOKEN: ' phc_x ' }).posthogLogsToken).toBe('phc_x');
    expect(() => loadConfig({ ...base, POSTHOG_LOGS_URL: 'us.i.posthog.com' })).toThrow(
      /POSTHOG_LOGS_URL/,
    );
  });
  it('pool: 8 by default, 20 in prod, PG_POOL overrides both', () => {
    expect(loadConfig(base).pgPool).toBe(8);
    expect(loadConfig({ ...base, PG_POOL: '12' }).pgPool).toBe(12);
    const prod = {
      ...base,
      GAME_ENV: 'prod',
      IDENTITY_PROVIDER: 'jest',
      PAYMENTS_PROVIDER: 'jest',
      JEST_JWS_SECRETS: Buffer.alloc(32, 1).toString('base64'),
      RATE_LIMIT_STORE: 'pg',
      BUILD_VERSION: '1.0.0',
    };
    expect(loadConfig(prod).pgPool).toBe(20);
    expect(loadConfig({ ...prod, PG_POOL: '30' }).pgPool).toBe(30);
  });
  it('prod refuses memory rate store, mock identity/payments, PGSSL off, STATIC_DIR', () => {
    expect(() => loadConfig({ ...base, GAME_ENV: 'prod' })).toThrow(ConfigError);
    try {
      loadConfig({ ...base, GAME_ENV: 'prod', STATIC_DIR: '/x', PGSSL: 'off' });
    } catch (e) {
      const m = String(e);
      expect(m).toMatch(/RATE_LIMIT_STORE must be pg/);
      expect(m).toMatch(/IDENTITY_PROVIDER must be jest/);
      expect(m).toMatch(/PGSSL/);
      expect(m).toMatch(/STATIC_DIR/);
    }
  });
  it('jest identity requires JEST_JWS_SECRETS with ≥ 16 decoded bytes (no_secret → 503 would otherwise be the runtime behaviour)', () => {
    expect(() => loadConfig({ ...base, IDENTITY_PROVIDER: 'jest' })).toThrow(
      /JEST_JWS_SECRETS is required/,
    );
    expect(() =>
      loadConfig({ ...base, IDENTITY_PROVIDER: 'jest', JEST_JWS_SECRETS: 'c2hvcnQ=' }),
    ).toThrow(/≥ 16 bytes/);
    const ok = loadConfig({
      ...base,
      IDENTITY_PROVIDER: 'jest',
      JEST_JWS_SECRETS:
        Buffer.alloc(32, 1).toString('base64') + ', ' + Buffer.alloc(32, 2).toString('base64'),
    });
    expect(ok.jestSecrets).toHaveLength(2);
  });
  it('admin keys: sha256 hex + non-empty valid scopes; at least one key; ops secret required', () => {
    expect(() => parseAdminKeys('{"k":{"secretSha256":"nothex","scopes":["read"]}}')).toThrow(
      /sha256 hex/,
    );
    expect(() =>
      parseAdminKeys('{"k":{"secretSha256":"' + sha('a') + '","scopes":["god"]}}'),
    ).toThrow(/scopes/);
    expect(() => parseAdminKeys('[]')).toThrow(/object keyed/);
    expect(() => loadConfig({ ...base, ADMIN_KEYS: '{}' })).toThrow(/at least one key/);
    expect(() => loadConfig({ ...base, OPS_SECRET: '' })).toThrow(/OPS_SECRET/);
  });
  it('GAME_ID must be a slug; GAME_ENV closed', () => {
    expect(() => loadConfig({ ...base, GAME_ID: 'Bad Id' })).toThrow();
    expect(() => loadConfig({ ...base, GAME_ENV: 'staging' })).toThrow();
  });
  it('validateConfig is idempotent on a valid config', () => {
    const c = loadConfig(base);
    expect(() => validateConfig(c)).not.toThrow();
  });
});

describe('Postgres TLS mapping (audit F2)', () => {
  it('off → false, require → require, verify → verify-full; never prefer/plaintext fallback', async () => {
    const { pgSslOption } = await import('../../src/db/index.ts');
    expect(pgSslOption('off')).toBe(false);
    expect(pgSslOption('require')).toBe('require');
    expect(pgSslOption('verify')).toBe('verify-full');
    for (const v of ['off', 'require', 'verify'] as const)
      expect(pgSslOption(v)).not.toBe('prefer');
  });
  it('production config can only resolve to require or verify-full', () => {
    const prod = {
      ...base,
      GAME_ENV: 'prod',
      RATE_LIMIT_STORE: 'pg',
      IDENTITY_PROVIDER: 'jest',
      PAYMENTS_PROVIDER: 'jest',
      JEST_JWS_SECRETS: Buffer.alloc(32, 1).toString('base64'),
      BUILD_VERSION: '0.22.0',
    };
    expect(loadConfig(prod).pgSsl).toBe('verify'); // default in prod
    expect(loadConfig({ ...prod, PGSSL: 'require' }).pgSsl).toBe('require');
    expect(() => loadConfig({ ...prod, PGSSL: 'off' })).toThrow(/PGSSL/);
    expect(() => loadConfig({ ...prod, PGSSL: 'prefer' })).toThrow();
  });
});

describe('config: build version from the deploy', () => {
  const infoFile = (content: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), 'build-info-')), 'build-info.json');
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  };
  const prod = {
    ...base,
    GAME_ENV: 'prod',
    RATE_LIMIT_STORE: 'pg',
    IDENTITY_PROVIDER: 'jest',
    PAYMENTS_PROVIDER: 'jest',
    JEST_JWS_SECRETS: Buffer.alloc(32, 1).toString('base64'),
  };

  it('the recorded build wins over hand-set BUILD_VERSION / BUILD_COMMIT', () => {
    const file = infoFile({ version: '0.22.1', commit: 'a'.repeat(40), env: 'production' });
    const c = loadConfig({
      ...base,
      BUILD_VERSION: '0.20.0',
      BUILD_COMMIT: 'old',
      BUILD_INFO_FILE: file,
    });
    expect(c).toMatchObject({ buildVersion: '0.22.1', buildCommit: 'a'.repeat(40) });
  });
  it('a placeholder without a version falls back to BUILD_VERSION (local stack)', () => {
    const file = infoFile({ $comment: 'placeholder' });
    expect(loadConfig({ ...base, BUILD_VERSION: '0.22.0', BUILD_INFO_FILE: file })).toMatchObject({
      buildVersion: '0.22.0',
      buildCommit: '',
    });
    expect(loadConfig(base)).toMatchObject({ buildVersion: 'dev', buildCommit: '' });
  });
  it('refuses a missing, unreadable or v-prefixed build record', () => {
    expect(() => loadConfig({ ...base, BUILD_INFO_FILE: '/nonexistent/build-info.json' })).toThrow(
      /does not exist/,
    );
    expect(() => loadConfig({ ...base, BUILD_INFO_FILE: infoFile('{') })).toThrow(/not JSON/);
    expect(() =>
      loadConfig({ ...base, BUILD_INFO_FILE: infoFile({ version: 'v0.22.1', commit: 'x' }) }),
    ).toThrow(/not X.Y.Z/);
  });
  it('prod boots only on a production release record, or a release BUILD_VERSION without one', () => {
    const release = { version: '0.22.1', commit: 'c', env: 'production' };
    expect(loadConfig({ ...prod, BUILD_INFO_FILE: infoFile(release) })).toMatchObject({
      buildVersion: '0.22.1',
      buildCommit: 'c',
    });
    // An image with a record never falls back to a leftover hand-set variable.
    expect(() =>
      loadConfig({
        ...prod,
        BUILD_VERSION: '0.22.0',
        BUILD_INFO_FILE: infoFile({ $comment: 'placeholder' }),
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      loadConfig({
        ...prod,
        BUILD_INFO_FILE: infoFile({ ...release, version: '0.22.1-staging.9', env: 'staging' }),
      }),
    ).toThrow(/staging build, not production/);
    expect(() => loadConfig(prod)).toThrow(/build version must be a release X.Y.Z in prod/);
    expect(() => loadConfig({ ...prod, BUILD_VERSION: 'v0.22.0' })).toThrow(/release X.Y.Z/);
    expect(() => loadConfig({ ...prod, BUILD_VERSION: '0.22.1-staging.9' })).toThrow(
      /release X.Y.Z/,
    );
    // Staging (lab) keeps booting on its prerelease, a hand-set or a missing version.
    expect(
      loadConfig({
        ...base,
        GAME_ENV: 'lab',
        BUILD_INFO_FILE: infoFile({ ...release, version: '0.22.1-staging.9', env: 'staging' }),
      }).buildVersion,
    ).toBe('0.22.1-staging.9');
    expect(loadConfig({ ...base, GAME_ENV: 'lab' }).buildVersion).toBe('dev');
  });
});
