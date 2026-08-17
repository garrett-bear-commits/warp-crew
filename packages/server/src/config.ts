// Config (§4.2): env-schema. GAME_ID/GAME_ENV are deployment configuration only — audience
// verification, game config selection, observability, fleet tooling — never persisted on rows
// (ADR-003). Validation refuses unsafe combinations in prod (memory rate store, mock identity,
// missing secrets).
import envSchema from 'env-schema';
import { Type, type Static } from '@sinclair/typebox';
import { GAME_ENVS, type AdminScope, ADMIN_SCOPES } from '@foundation/contracts/enums';

const Schema = Type.Object({
  DATABASE_URL: Type.String({ minLength: 1 }),
  PGSSL: Type.Optional(
    Type.Union([Type.Literal('verify'), Type.Literal('require'), Type.Literal('off')]),
  ),
  PG_POOL: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 8 })),
  PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535, default: 8080 })),
  ADMIN_PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535, default: 8081 })),
  HOST: Type.Optional(Type.String({ default: '0.0.0.0' })),
  GAME_ID: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
  GAME_ENV: Type.Union(GAME_ENVS.map((e) => Type.Literal(e))),
  IDENTITY_PROVIDER: Type.Optional(
    Type.Union([Type.Literal('jest'), Type.Literal('mock')], { default: 'jest' }),
  ),
  PAYMENTS_PROVIDER: Type.Optional(
    Type.Union([Type.Literal('jest'), Type.Literal('mock')], { default: 'jest' }),
  ),
  /** Comma-separated base64 HS256 secrets, newest first (rotation list). */
  JEST_JWS_SECRETS: Type.Optional(Type.String({ default: '' })),
  /** JSON: {"<keyId>": {"secretSha256": "<hex>", "scopes": ["read", ...]}} */
  ADMIN_KEYS: Type.Optional(Type.String({ default: '{}' })),
  OPS_SECRET: Type.Optional(Type.String({ default: '' })),
  RATE_LIMIT_STORE: Type.Optional(
    Type.Union([Type.Literal('pg'), Type.Literal('memory')], { default: 'pg' }),
  ),
  SENTRY_DSN: Type.Optional(Type.String({ default: '' })),
  BUILD_VERSION: Type.Optional(Type.String({ default: 'dev' })),
  /** Comma-separated allowed browser origins (our client host + platform per-game host pattern). */
  CLIENT_ORIGINS: Type.Optional(Type.String({ default: '' })),
  /** Public URL of this API (for admin inspector connect-src). */
  PUBLIC_URL: Type.Optional(Type.String({ default: '' })),
  LOG_LEVEL: Type.Optional(Type.String({ default: 'info' })),
  /** Serve the built template game + admin inspector from this process (Lab/dev only). */
  STATIC_DIR: Type.Optional(Type.String({ default: '' })),
  JOBS_ENABLED: Type.Optional(
    Type.Union([Type.Literal('true'), Type.Literal('false')], { default: 'true' }),
  ),
});

export type RawConfig = Static<typeof Schema>;

export interface AdminKey {
  keyId: string;
  secretSha256: string;
  scopes: readonly AdminScope[];
}

export interface ServerConfig {
  databaseUrl: string;
  pgSsl: 'verify' | 'require' | 'off';
  pgPool: number;
  port: number;
  adminPort: number;
  host: string;
  gameId: string;
  env: 'prod' | 'lab' | 'dev';
  identityProvider: 'jest' | 'mock';
  paymentsProvider: 'jest' | 'mock';
  jestSecrets: string[];
  adminKeys: AdminKey[];
  opsSecret: string;
  rateLimitStore: 'pg' | 'memory';
  sentryDsn: string;
  buildVersion: string;
  clientOrigins: string[];
  publicUrl: string;
  logLevel: string;
  staticDir: string;
  jobsEnabled: boolean;
}

export class ConfigError extends Error {}

export function parseAdminKeys(json: string): AdminKey[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    throw new ConfigError('ADMIN_KEYS is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError('ADMIN_KEYS must be an object keyed by keyId');
  const out: AdminKey[] = [];
  for (const [keyId, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as { secretSha256?: unknown; scopes?: unknown };
    if (typeof o?.secretSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(o.secretSha256))
      throw new ConfigError(`ADMIN_KEYS.${keyId}.secretSha256 must be a sha256 hex`);
    if (
      !Array.isArray(o.scopes) ||
      o.scopes.length === 0 ||
      !o.scopes.every((s) => (ADMIN_SCOPES as readonly string[]).includes(String(s)))
    )
      throw new ConfigError(
        `ADMIN_KEYS.${keyId}.scopes must be a non-empty list of ${ADMIN_SCOPES.join('|')}`,
      );
    out.push({
      keyId,
      secretSha256: o.secretSha256.toLowerCase(),
      scopes: o.scopes as AdminScope[],
    });
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = envSchema<RawConfig>({ schema: Schema, data: env, dotenv: false });
  const cfg: ServerConfig = {
    databaseUrl: raw.DATABASE_URL,
    pgSsl: raw.PGSSL ?? (raw.GAME_ENV === 'prod' ? 'verify' : 'off'),
    pgPool: raw.PG_POOL ?? 8,
    port: raw.PORT ?? 8080,
    adminPort: raw.ADMIN_PORT ?? 8081,
    host: raw.HOST ?? '0.0.0.0',
    gameId: raw.GAME_ID,
    env: raw.GAME_ENV,
    identityProvider: raw.IDENTITY_PROVIDER ?? 'jest',
    paymentsProvider: raw.PAYMENTS_PROVIDER ?? 'jest',
    jestSecrets: (raw.JEST_JWS_SECRETS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminKeys: parseAdminKeys(raw.ADMIN_KEYS ?? '{}'),
    opsSecret: raw.OPS_SECRET ?? '',
    rateLimitStore: raw.RATE_LIMIT_STORE ?? 'pg',
    sentryDsn: raw.SENTRY_DSN ?? '',
    buildVersion: raw.BUILD_VERSION ?? 'dev',
    clientOrigins: (raw.CLIENT_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicUrl: raw.PUBLIC_URL ?? '',
    logLevel: raw.LOG_LEVEL ?? 'info',
    staticDir: raw.STATIC_DIR ?? '',
    jobsEnabled: (raw.JOBS_ENABLED ?? 'true') === 'true',
  };
  validateConfig(cfg);
  return cfg;
}

/** Refuse unsafe production configuration (fail closed at boot, not at first request). */
export function validateConfig(cfg: ServerConfig): void {
  const problems: string[] = [];
  if (cfg.env === 'prod') {
    if (cfg.rateLimitStore !== 'pg')
      problems.push('RATE_LIMIT_STORE must be pg in prod (memory store is dev/lab only)');
    if (cfg.identityProvider !== 'jest') problems.push('IDENTITY_PROVIDER must be jest in prod');
    if (cfg.paymentsProvider !== 'jest') problems.push('PAYMENTS_PROVIDER must be jest in prod');
    if (cfg.pgSsl === 'off') problems.push('PGSSL must be verify or require in prod');
    if (cfg.staticDir)
      problems.push('STATIC_DIR (serving the client from the API) is Lab/dev only');
  }
  if (cfg.identityProvider === 'jest' && cfg.jestSecrets.length === 0)
    problems.push(
      'JEST_JWS_SECRETS is required when IDENTITY_PROVIDER=jest (identity fails closed: no_secret → 503)',
    );
  for (const s of cfg.jestSecrets)
    if (Buffer.from(s, 'base64').length < 16)
      problems.push('every JEST_JWS_SECRETS entry must be base64 of ≥ 16 bytes');
  if (!cfg.opsSecret) problems.push('OPS_SECRET is required');
  if (cfg.opsSecret && cfg.opsSecret.length < 16) problems.push('OPS_SECRET must be ≥ 16 chars');
  if (cfg.adminKeys.length === 0) problems.push('ADMIN_KEYS must contain at least one key');
  if (problems.length) throw new ConfigError(problems.join('; '));
}
