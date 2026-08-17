// Acceptance API for Playwright: a fresh Postgres database (DATABASE_URL_TEST or a testcontainer),
// migrations from empty, GAME_ENV=lab, mock identity/payments, jobs on (outbox drain), listening on
// E2E_API_PORT (default 8090). Prints "E2E_API_READY" when serving.
import { createTestDatabase, enableAppRole } from '@foundation/testkit/pg';
import {
  migrateUp,
  createDb,
  createServer,
  createLogger,
  validateConfig,
  type ServerConfig,
} from '@foundation/server';
import { createHash } from 'node:crypto';
import { templateGame } from '../../server/games/template/game.config.ts';
import { templatePolicy } from '../../server/games/template/policy.ts';

export const E2E_ADMIN_SECRET = 'e2e-admin-secret-0123456789';
export const E2E_OPS_SECRET = 'e2e-ops-secret-0123456789';

const port = Number(process.env.E2E_API_PORT ?? 8090);
const test = await createTestDatabase('e2e');
await migrateUp(test.url);
await enableAppRole(test.url, test.name, 'foundation_app_e2e');
const u = new URL(test.url);
u.username = 'foundation_app';
u.password = 'foundation_app_e2e';
const config: ServerConfig = {
  databaseUrl: u.toString(),
  pgSsl: 'off',
  pgPool: 8,
  port,
  adminPort: 0,
  host: '127.0.0.1',
  gameId: 'template',
  env: 'lab',
  identityProvider: 'mock',
  paymentsProvider: 'mock',
  jestSecrets: [],
  adminKeys: [
    {
      keyId: 'e2e',
      secretSha256: createHash('sha256').update(E2E_ADMIN_SECRET).digest('hex'),
      scopes: ['read', 'support', 'grant', 'publish', 'restore', 'erase'],
    },
  ],
  opsSecret: E2E_OPS_SECRET,
  rateLimitStore: 'memory',
  sentryDsn: '',
  buildVersion: 'e2e',
  clientOrigins: [
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:4174',
    'http://127.0.0.1:4174',
  ],
  publicUrl: `http://127.0.0.1:${port}`,
  logLevel: process.env.E2E_LOG_LEVEL ?? 'warn',
  staticDir: '',
  jobsEnabled: true,
};
validateConfig(config);
const log = createLogger(config.logLevel);
const db = createDb(config.databaseUrl, { max: 8, applicationName: 'e2e' });
const server = await createServer({ config, game: templateGame, policy: templatePolicy, log, db });
await server.start();
console.log(`E2E_API_READY port=${port} db=${test.name}`);
const stop = async () => {
  await server.stop();
  await db.end();
  await test.drop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
