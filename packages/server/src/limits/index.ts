// Rate limits (§4.2): fixed windows per bucket. PG store required in GAME_ENV=prod; the memory
// store is dev/lab only and config validation refuses it in prod.
import type { Sql } from 'postgres';
import type { ServerClock } from '../clock/index.ts';

export interface LimitBucket {
  limit: number;
  windowMs: number;
}

export interface LimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  hit(key: string, bucket: string): Promise<LimitVerdict>;
  /** Drop expired windows (job). */
  sweep(): Promise<number>;
}

export const DEFAULT_BUCKETS: Record<string, LimitBucket> = {
  // per player writes
  'saves.write': { limit: 120, windowMs: 60_000 },
  'saves.beacon': { limit: 30, windowMs: 60_000 },
  lineage: { limit: 10, windowMs: 60_000 },
  purchases: { limit: 30, windowMs: 60_000 },
  grants: { limit: 60, windowMs: 60_000 },
  codes: { limit: 10, windowMs: 60_000 },
  journal: { limit: 20, windowMs: 60_000 },
  telemetry: { limit: 20, windowMs: 60_000 },
  boards: { limit: 60, windowMs: 60_000 },
  inbox: { limit: 60, windowMs: 60_000 },
  achievements: { limit: 60, windowMs: 60_000 },
  admin: { limit: 600, windowMs: 60_000 },
  // per-IP ceilings (~10× per player) and auth failures
  'ip.write': { limit: 1200, windowMs: 60_000 },
  'ip.authfail': { limit: 60, windowMs: 60_000 },
};

export function createMemoryLimiter(
  clock: ServerClock,
  buckets: Record<string, LimitBucket> = DEFAULT_BUCKETS,
): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async hit(key, bucket) {
      const b = buckets[bucket] ?? { limit: 60, windowMs: 60_000 };
      const now = clock.now();
      const start = Math.floor(now / b.windowMs) * b.windowMs;
      const k = `${key}@${start}`;
      const w = windows.get(k) ?? { start, count: 0 };
      w.count++;
      windows.set(k, w);
      const allowed = w.count <= b.limit;
      return {
        allowed,
        remaining: Math.max(0, b.limit - w.count),
        retryAfterMs: allowed ? 0 : start + b.windowMs - now,
      };
    },
    async sweep() {
      const now = clock.now();
      let n = 0;
      for (const [k, w] of windows) {
        if (now - w.start > 2 * 60 * 60_000) {
          windows.delete(k);
          n++;
        }
      }
      return n;
    },
  };
}

export function createPgLimiter(
  sql: Sql,
  clock: ServerClock,
  buckets: Record<string, LimitBucket> = DEFAULT_BUCKETS,
): RateLimiter {
  return {
    async hit(key, bucket) {
      const b = buckets[bucket] ?? { limit: 60, windowMs: 60_000 };
      const now = clock.now();
      const start = Math.floor(now / b.windowMs) * b.windowMs;
      const rows = await sql<{ count: number }[]>`
        INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${new Date(start)}, 1)
        ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
        RETURNING count`;
      const count = rows[0]?.count ?? 1;
      const allowed = count <= b.limit;
      return {
        allowed,
        remaining: Math.max(0, b.limit - count),
        retryAfterMs: allowed ? 0 : start + b.windowMs - now,
      };
    },
    async sweep() {
      const cutoff = new Date(clock.now() - 2 * 60 * 60_000);
      const r = await sql`DELETE FROM rate_limits WHERE window_start < ${cutoff}`;
      return r.count;
    },
  };
}
