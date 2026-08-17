// Real-Postgres harness (ADR-025): fresh database per file, migrations from empty, then the app
// connects as the `foundation_app` role so privilege boundaries are exercised in every test.
import {
  createTestDatabase,
  connect,
  enableAppRole,
  type TestDatabase,
} from '@foundation/testkit/pg';
import { createDb, type Db } from '../../src/db/index.ts';
import { migrateUp } from '../../src/db/migrate.ts';
import type { Sql } from 'postgres';

export const APP_ROLE = { user: 'foundation_app', password: 'foundation_app_test' };

export interface PgHarness {
  test: TestDatabase;
  /** superuser sql (setup/assertions) */
  root: Sql;
  /** application-role db (what the server uses) */
  db: Db;
  appUrl: string;
  close(): Promise<void>;
}

export async function setupPg(prefix = 'srv'): Promise<PgHarness> {
  const test = await createTestDatabase(prefix);
  await migrateUp(test.url);
  const root = connect(test.url, { max: 2 });
  await enableAppRole(test.url, test.name, APP_ROLE.password);
  const u = new URL(test.url);
  u.username = APP_ROLE.user;
  u.password = APP_ROLE.password;
  const appUrl = u.toString();
  const db = createDb(appUrl, {
    max: 8,
    lockTimeoutMs: 2000,
    statementTimeoutMs: 8000,
    applicationName: 'test-app',
  });
  return {
    test,
    root,
    db,
    appUrl,
    async close() {
      await db.end();
      await root.end({ timeout: 5 });
      await test.drop();
    },
  };
}
