// Config (§4.2): env-schema. GAME_ID/GAME_ENV are deployment configuration only — audience
// verification, game config selection, observability, fleet tooling — never persisted on rows
// (ADR-003). Validation refuses unsafe combinations in prod (memory rate store, mock identity,
// missing secrets).
import { existsSync, readFileSync } from 'node:fs';
import envSchema from 'env-schema';
import { Type, type Static } from '@sinclair/typebox';
import { GAME_ENVS, type AdminScope, ADMIN_SCOPES } from '@foundation/contracts/enums';
import { RELEASE_VERSION_PATTERN, isBuildVersion } from '@foundation/contracts/versions';
import type { CfAccessConfig } from './auth/cf-access.ts';

const Schema = Type.Object({
  DATABASE_URL: Type.String({ minLength: 1 }),
  PGSSL: Type.Optional(
    Type.Union([Type.Literal('verify'), Type.Literal('require'), Type.Literal('off')]),
  ),
  /** Connections per API process. Unset: 20 in prod, 8 elsewhere (see defaultPgPool). */
  PG_POOL: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
  /** Cloudflare Access team domain, https://<team>.cloudflareaccess.com. With
   *  CF_ACCESS_AUD, every admin request needs a valid Access token; both unset: no check. */
  CF_ACCESS_TEAM_DOMAIN: Type.Optional(Type.String({ default: '' })),
  /** The Access application's AUD tag (comma-separated while an application is replaced). */
  CF_ACCESS_AUD: Type.Optional(Type.String({ default: '' })),
  RATE_LIMIT_STORE: Type.Optional(
    Type.Union([Type.Literal('pg'), Type.Literal('memory')], { default: 'pg' }),
  ),
  SENTRY_DSN: Type.Optional(Type.String({ default: '' })),
  /** PostHog project token: ships API logs to PostHog Logs over OTLP. Unset: no shipping. */
  POSTHOG_LOGS_TOKEN: Type.Optional(Type.String({ default: '' })),
  /** OTLP/HTTP logs endpoint; default PostHog US cloud (POSTHOG_LOGS_URL in logship.ts). */
  POSTHOG_LOGS_URL: Type.Optional(Type.String({ default: '' })),
  /** TypeSafe API key for Jev, Jest's notification moderation model (names.check). Unset: names
   *  go unchecked by the server. */
  TYPESAFE_API_KEY: Type.Optional(Type.String({ default: '' })),
  BUILD_VERSION: Type.Optional(Type.String({ default: 'dev' })),
  /** Git commit of this build, when BUILD_INFO_FILE doesn't record one. */
  BUILD_COMMIT: Type.Optional(Type.String({ default: '' })),
  /** JSON {version, commit} written by the deploy workflow; wins over BUILD_VERSION/BUILD_COMMIT.
   *  A placeholder without a version falls back to them (local stack). */
  BUILD_INFO_FILE: Type.Optional(Type.String({ default: '' })),
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
  /** Cloudflare Access in front of the admin origin; absent: admin requests need no Access token. */
  cfAccess?: CfAccessConfig;
  rateLimitStore: 'pg' | 'memory';
  sentryDsn: string;
  /** '' = no log shipping. */
  posthogLogsToken: string;
  /** '' = the PostHog US endpoint. */
  posthogLogsUrl: string;
  typesafeApiKey: string;
  buildVersion: string;
  /** Git commit of this build; '' when unknown. */
  buildCommit: string;
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

/**
 * CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD, or null when both are unset. One without the other is
 * refused: a half-set pair must not silently leave the admin API without its Access check.
 */
export function parseCfAccess(teamDomain: string, aud: string): CfAccessConfig | null {
  const team = teamDomain.trim();
  const audiences = aud
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!team && !audiences.length) return null;
  if (!team || !audiences.length)
    throw new ConfigError('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set together');
  let url: URL;
  try {
    url = new URL(team);
  } catch {
    throw new ConfigError('CF_ACCESS_TEAM_DOMAIN must be https://<team>.cloudflareaccess.com');
  }
  if (url.protocol !== 'https:' || url.origin !== team.replace(/\/+$/, '').toLowerCase())
    throw new ConfigError('CF_ACCESS_TEAM_DOMAIN must be https://<team>.cloudflareaccess.com');
  for (const a of audiences)
    if (!/^[0-9a-f]{64}$/.test(a))
      throw new ConfigError('CF_ACCESS_AUD must be the Access application AUD tag (64 hex)');
  return { teamDomain: url.origin, audiences };
}

/** The build the deploy workflow recorded. Missing file or a placeholder without a
 *  version → null, so local builds keep their BUILD_VERSION. */
export function readBuildInfo(
  path: string,
): { version: string; commit: string; env: string | undefined } | null {
  if (!path) return null;
  if (!existsSync(path)) throw new ConfigError(`BUILD_INFO_FILE ${path} does not exist`);
  let info: unknown;
  try {
    info = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ConfigError(`BUILD_INFO_FILE ${path} is not JSON`);
  }
  const { version, commit, env } = (info ?? {}) as {
    version?: unknown;
    commit?: unknown;
    env?: unknown;
  };
  if (version === undefined || version === null) return null;
  if (typeof version !== 'string' || !isBuildVersion(version))
    throw new ConfigError(`BUILD_INFO_FILE version ${JSON.stringify(version)} is not X.Y.Z`);
  return {
    version,
    commit: typeof commit === 'string' ? commit : '',
    env: typeof env === 'string' ? env : undefined,
  };
}

/**
 * Pool size when PG_POOL is unset. A scheduled job holds two connections (its advisory-lock
 * transaction and its queries), the runner allows two at once plus the outbox drain, and requests
 * need the rest. Production: 2 replicas × 20 + migrator + admin stays well under a managed
 * Postgres' usual ~100 max_connections.
 */
export function defaultPgPool(env: ServerConfig['env']): number {
  return env === 'prod' ? 20 : 8;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = envSchema<RawConfig>({ schema: Schema, data: env, dotenv: false });
  const buildInfo = readBuildInfo(raw.BUILD_INFO_FILE ?? '');
  // An image that carries a build record must run the release Deploy production recorded:
  // never the placeholder's fallback to a hand-set BUILD_VERSION, never a staging build.
  if (raw.GAME_ENV === 'prod' && raw.BUILD_INFO_FILE) {
    if (!buildInfo)
      throw new ConfigError(
        `BUILD_INFO_FILE ${raw.BUILD_INFO_FILE} is the placeholder: production images come from Deploy production`,
      );
    if (buildInfo.env !== 'production')
      throw new ConfigError(
        `BUILD_INFO_FILE records a ${buildInfo.env ?? 'unknown'} build, not production`,
      );
  }
  const cfAccess = parseCfAccess(raw.CF_ACCESS_TEAM_DOMAIN ?? '', raw.CF_ACCESS_AUD ?? '');
  const cfg: ServerConfig = {
    databaseUrl: raw.DATABASE_URL,
    pgSsl: raw.PGSSL ?? (raw.GAME_ENV === 'prod' ? 'verify' : 'off'),
    pgPool: raw.PG_POOL ?? defaultPgPool(raw.GAME_ENV),
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
    ...(cfAccess ? { cfAccess } : {}),
    rateLimitStore: raw.RATE_LIMIT_STORE ?? 'pg',
    sentryDsn: raw.SENTRY_DSN ?? '',
    posthogLogsToken: (raw.POSTHOG_LOGS_TOKEN ?? '').trim(),
    posthogLogsUrl: (raw.POSTHOG_LOGS_URL ?? '').trim(),
    typesafeApiKey: (raw.TYPESAFE_API_KEY ?? '').trim(),
    buildVersion: buildInfo?.version ?? raw.BUILD_VERSION ?? 'dev',
    buildCommit: buildInfo ? buildInfo.commit : (raw.BUILD_COMMIT ?? ''),
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
    if (!RELEASE_VERSION_PATTERN.test(cfg.buildVersion))
      problems.push(
        `build version must be a release X.Y.Z in prod (got ${JSON.stringify(cfg.buildVersion)}; Deploy production writes BUILD_INFO_FILE)`,
      );
  }
  if (cfg.identityProvider === 'jest' && cfg.jestSecrets.length === 0)
    problems.push(
      'JEST_JWS_SECRETS is required when IDENTITY_PROVIDER=jest (identity fails closed: no_secret → 503)',
    );
  for (const s of cfg.jestSecrets)
    if (Buffer.from(s, 'base64').length < 16)
      problems.push('every JEST_JWS_SECRETS entry must be base64 of ≥ 16 bytes');
  if (cfg.posthogLogsUrl && !/^https?:\/\/[^/]+/.test(cfg.posthogLogsUrl))
    problems.push('POSTHOG_LOGS_URL must be an http(s) URL');
  if (cfg.env === 'prod' && cfg.posthogLogsUrl.startsWith('http://'))
    problems.push('POSTHOG_LOGS_URL must be https in prod (it carries the project token)');
  if (!cfg.opsSecret) problems.push('OPS_SECRET is required');
  if (cfg.opsSecret && cfg.opsSecret.length < 16) problems.push('OPS_SECRET must be ≥ 16 chars');
  if (cfg.adminKeys.length === 0) problems.push('ADMIN_KEYS must contain at least one key');
  if (problems.length) throw new ConfigError(problems.join('; '));
}
