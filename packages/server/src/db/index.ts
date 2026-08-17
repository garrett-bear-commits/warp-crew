// postgres.js pool + transaction/lock helpers. Player lock = pg_advisory_xact_lock(1, hashtext(key));
// game lock = (2, hashtext('game')); jobs use class 3; the migrator uses class 4.
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { AppError } from '../errors.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Types = {};
/** Query surface shared by the pool and a transaction (tagged template + unsafe + json). */
export type Q = Sql<Types>;
/** A transaction handle: everything Q offers plus savepoints. */
export type Tx = TransactionSql<Types> & Sql<Types>;
export type Db = {
  sql: Sql<Types>;
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

export type LockSpec = { kind: 'player'; key: string } | { kind: 'game' } | { kind: 'none' };

export interface DbOptions {
  max?: number;
  ssl?: 'require' | 'prefer' | boolean;
  /** Bounds the wait on the commands unique index for concurrent duplicates (→ 503 retry_later). */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
}

export function createDb(url: string, opts: DbOptions = {}): Db {
  const sql = postgres(url, {
    max: opts.max ?? 8,
    ...(opts.ssl !== undefined ? { ssl: opts.ssl } : {}),
    onnotice: () => {},
    connection: {
      application_name: opts.applicationName ?? 'foundation',
      lock_timeout: opts.lockTimeoutMs ?? 3000,
      statement_timeout: opts.statementTimeoutMs ?? 15_000,
    },
  });
  return {
    sql,
    tx: <T>(fn: (tx: Tx) => Promise<T>) => sql.begin((tx) => fn(tx as unknown as Tx)) as Promise<T>,
    end: () => sql.end({ timeout: 5 }),
  };
}

export async function takeLock(tx: Tx, lock: LockSpec): Promise<void> {
  if (lock.kind === 'player') await tx`SELECT pg_advisory_xact_lock(1, hashtext(${lock.key}))`;
  else if (lock.kind === 'game') await tx`SELECT pg_advisory_xact_lock(2, hashtext('game'))`;
}

/** Open a transaction, take the declared lock, run fn. Lock/statement timeouts map to 503 retry_later. */
export async function withLock<T>(db: Db, lock: LockSpec, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.tx(async (tx) => {
      await takeLock(tx, lock);
      return fn(tx);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export function pgCode(e: unknown): string | undefined {
  return (e as { code?: string } | undefined)?.code;
}

export function mapPgError(e: unknown): unknown {
  const code = pgCode(e);
  // 55P03 lock_not_available, 57014 query_canceled (statement_timeout), 40P01 deadlock, 40001 serialization
  if (code === '55P03' || code === '57014' || code === '40P01' || code === '40001') {
    return new AppError('retry_later', 'database contention; retry later', { pgCode: code });
  }
  return e;
}
