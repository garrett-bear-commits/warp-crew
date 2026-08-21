// Route tests with fakes (§9): buildApp()/inject() on real Postgres, tokens minted in-test.
import {
  createTestDatabase,
  connect,
  enableAppRole,
  type TestDatabase,
} from '@foundation/testkit/pg';
import { mintMockToken, mintMockReceipt } from '@foundation/jest-verify';
import {
  migrateUp,
  createDb,
  createServer,
  fixedClock,
  validateConfig,
  type ServerConfig,
  type Server,
  type Db,
} from '@foundation/server';
import pino from 'pino';
import type { Sql } from 'postgres';
import { randomUUID, createHash } from 'node:crypto';
import { templateGame } from '../../games/template/game.config.ts';
import { templatePolicy } from '../../games/template/policy.ts';
import type { GameConfig } from '@foundation/server';

export const T0 = 1_786_924_800_000;
export const ADMIN_SECRET = 'test-admin-secret-0123456789';
export const OPS_SECRET = 'test-ops-secret-0123456789';

export interface Harness {
  test: TestDatabase;
  root: Sql;
  db: Db;
  server: Server;
  clock: ReturnType<typeof fixedClock>;
  config: ServerConfig;
  inject: Server['app']['inject'];
  playerHeaders(
    playerKey: string,
    opts?: { registered?: boolean; iatMs?: number; build?: string },
  ): Record<string, string>;
  adminHeaders(keyId?: string): Record<string, string>;
  opsHeaders(): Record<string, string>;
  token(playerKey: string, iatMs?: number, registered?: boolean): string;
  receipt(o: {
    playerKey: string;
    token: string;
    sku: string;
    price?: number;
    currency?: string;
    sandbox?: true;
    aud?: string;
  }): string;
  receiptBatch(o: {
    playerKey: string;
    purchases: Array<{
      token: string;
      sku: string;
      price?: number;
      currency?: string;
      sandbox?: true;
    }>;
    aud?: string;
  }): string;
  uuid(): string;
  drainOutbox(): Promise<{ delivered: number; failed: number; dead: number }>;
  close(): Promise<void>;
}

export async function setupHarness(
  opts: { env?: 'dev' | 'lab' | 'prod'; game?: Partial<GameConfig>; prefix?: string } = {},
): Promise<Harness> {
  const test = await createTestDatabase(opts.prefix ?? 'app');
  await migrateUp(test.url);
  const root = connect(test.url, { max: 2 });
  await enableAppRole(test.url, test.name, 'foundation_app_test');
  const u = new URL(test.url);
  u.username = 'foundation_app';
  u.password = 'foundation_app_test';
  const db = createDb(u.toString(), {
    max: 8,
    lockTimeoutMs: 3000,
    statementTimeoutMs: 15_000,
    applicationName: 'app-test',
  });
  const clock = fixedClock(T0);
  const config: ServerConfig = {
    databaseUrl: u.toString(),
    pgSsl: 'off',
    pgPool: 8,
    port: 0,
    adminPort: 0,
    host: '127.0.0.1',
    gameId: 'template',
    env: opts.env ?? 'lab',
    identityProvider: 'mock',
    paymentsProvider: 'mock',
    jestSecrets: [],
    adminKeys: [
      {
        keyId: 'full',
        secretSha256: createHash('sha256').update(ADMIN_SECRET).digest('hex'),
        scopes: ['read', 'support', 'grant', 'publish', 'restore', 'erase'],
      },
      {
        keyId: 'reader',
        secretSha256: createHash('sha256').update(ADMIN_SECRET).digest('hex'),
        scopes: ['read'],
      },
    ],
    opsSecret: OPS_SECRET,
    rateLimitStore: 'memory',
    sentryDsn: '',
    buildVersion: 'test',
    clientOrigins: ['http://localhost:5173'],
    publicUrl: '',
    logLevel: 'silent',
    staticDir: '',
    jobsEnabled: false,
  };
  validateConfig(config);
  const game: GameConfig = { ...templateGame, ...opts.game };
  const server = await createServer({
    config,
    game,
    policy: templatePolicy,
    clock,
    log: pino({ level: 'silent' }),
    db,
  });
  await server.ready();
  return {
    test,
    root,
    db,
    server,
    clock,
    config,
    inject: server.app.inject.bind(server.app),
    token: (playerKey, iatMs, registered) =>
      mintMockToken(playerKey, iatMs ?? clock.now(), registered ?? false),
    playerHeaders(playerKey, o = {}) {
      const h: Record<string, string> = {
        'x-player-key': playerKey,
        authorization: `Bearer ${mintMockToken(playerKey, o.iatMs ?? clock.now(), o.registered ?? false)}`,
      };
      if (o.build) h['x-build-version'] = o.build;
      return h;
    },
    adminHeaders: (keyId = 'full') => ({ 'x-admin-key-id': keyId, 'x-admin-secret': ADMIN_SECRET }),
    opsHeaders: () => ({ 'x-ops-secret': OPS_SECRET }),
    receipt: (o) =>
      mintMockReceipt({
        aud: o.aud ?? 'template',
        sub: o.playerKey,
        purchase: {
          purchaseToken: o.token,
          productSku: o.sku,
          createdAt: clock.now(),
          completedAt: clock.now() + 1,
          ...(o.price !== undefined ? { price: o.price } : {}),
          ...(o.currency ? { currency: o.currency } : {}),
          ...(o.sandbox ? { sandbox: true } : {}),
        },
      }),
    receiptBatch: (o) =>
      mintMockReceipt({
        aud: o.aud ?? 'template',
        sub: o.playerKey,
        purchases: o.purchases.map((purchase) => ({
          purchaseToken: purchase.token,
          productSku: purchase.sku,
          createdAt: clock.now(),
          completedAt: null,
          ...(purchase.price !== undefined ? { price: purchase.price } : {}),
          ...(purchase.currency ? { currency: purchase.currency } : {}),
          ...(purchase.sandbox ? { sandbox: true } : {}),
        })),
      }),
    uuid: () => randomUUID(),
    drainOutbox: () => server.ctx.outbox.drain(),
    async close() {
      await server.stop();
      await root.end({ timeout: 5 });
      await test.drop();
    },
  };
}

export const saveBody = (
  o: Partial<{
    commandId: string;
    generation: number;
    clientSeq: number;
    baseSeq: number;
    sessionId: string;
    progress: number;
    savedAt: number;
    schemaVersion: number;
    buildVersion: string;
    enc: 'json' | 'gzip+b64';
    reason: string;
    blob: string;
    summary: Record<string, number>;
  }> = {},
  blobObj: Record<string, unknown> = { v: 1, counter: 10, gold: 5 },
) => ({
  commandId: o.commandId ?? randomUUID(),
  generation: o.generation ?? 0,
  clientSeq: o.clientSeq ?? 1,
  baseSeq: o.baseSeq ?? 0,
  sessionId: o.sessionId ?? '2f5b7f6a-3c9d-4e1f-8a2b-0c1d2e3f4a5b',
  progress: o.progress ?? 10,
  savedAt: o.savedAt ?? T0,
  schemaVersion: o.schemaVersion ?? 1,
  buildVersion: o.buildVersion ?? '1.0.0',
  enc: o.enc ?? 'json',
  reason: o.reason ?? 'timer',
  blob: o.blob ?? JSON.stringify(blobObj),
  ...(o.summary ? { summary: o.summary } : {}),
});
