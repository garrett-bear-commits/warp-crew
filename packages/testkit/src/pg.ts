// Real Postgres for integration tests (ADR-025). Uses DATABASE_URL_TEST when set, otherwise
// starts a postgres:16-alpine testcontainer. Each caller gets a fresh, uniquely named database.
import postgres, { type Sql } from 'postgres';
import { randomBytes } from 'node:crypto';

export interface TestDatabase {
  /** Superuser (owner) connection URL for the fresh database. */
  url: string;
  /** Superuser connection URL to the maintenance database (for DROP DATABASE). */
  adminUrl: string;
  name: string;
  /** Drop the database (called from afterAll). */
  drop(): Promise<void>;
}

let containerUrl: string | null = null;
let containerStop: (() => Promise<void>) | null = null;

async function baseUrl(): Promise<string> {
  const fromEnv = process.env.DATABASE_URL_TEST;
  if (fromEnv) return fromEnv;
  if (containerUrl) return containerUrl;
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const c = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('foundation_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  containerUrl = c.getConnectionUri();
  containerStop = () => c.stop().then(() => undefined);
  return containerUrl;
}

export function isPgAvailable(): boolean {
  return !!process.env.DATABASE_URL_TEST || process.env.PG_TESTCONTAINERS !== '0';
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Create a fresh database for one test file. */
export async function createTestDatabase(prefix = 't'): Promise<TestDatabase> {
  const admin = await baseUrl();
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  const sql = postgres(admin, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const url = withDb(admin, name);
  return {
    url,
    adminUrl: admin,
    name,
    async drop() {
      const s = postgres(admin, { max: 1, onnotice: () => {} });
      try {
        await s.unsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
        );
        await s.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await s.end({ timeout: 5 });
      }
    },
  };
}

export async function stopContainer(): Promise<void> {
  if (containerStop) await containerStop();
  containerStop = null;
  containerUrl = null;
}

export function connect(
  url: string,
  opts: { max?: number; role?: { user: string; password: string } } = {},
): Sql {
  let u = url;
  if (opts.role) {
    const parsed = new URL(url);
    parsed.username = opts.role.user;
    parsed.password = opts.role.password;
    u = parsed.toString();
  }
  return postgres(u, { max: opts.max ?? 4, onnotice: () => {} });
}
