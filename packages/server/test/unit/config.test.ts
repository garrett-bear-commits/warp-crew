import { describe, expect, it } from 'vitest';
import { loadConfig, parseAdminKeys, ConfigError, validateConfig } from '../../src/config.ts';
import { createHash } from 'node:crypto';

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
    };
    expect(loadConfig(prod).pgSsl).toBe('verify'); // default in prod
    expect(loadConfig({ ...prod, PGSSL: 'require' }).pgSsl).toBe('require');
    expect(() => loadConfig({ ...prod, PGSSL: 'off' })).toThrow(/PGSSL/);
    expect(() => loadConfig({ ...prod, PGSSL: 'prefer' })).toThrow();
  });
});
