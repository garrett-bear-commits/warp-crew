// This instance's API responses over the ops window: outcomes that never become a command row
// (raw 500s, and the 401 and 429 refusals made before a command runs), so the ops check can rate
// them. Per instance, not the fleet: replicas behind one balancer see similar shares.

export interface HttpOutcomes {
  total: number;
  serverErrors: number;
  unauthorized: number;
  rateLimited: number;
}

export interface HttpStats {
  record(status: number, now: number): void;
  snapshot(now: number): HttpOutcomes;
}

const MINUTE = 60_000;

export function createHttpStats(windowMs = 15 * MINUTE): HttpStats {
  const buckets = new Map<number, HttpOutcomes>();
  const prune = (now: number): void => {
    // A minute partly inside the window stays: the window is accurate to a minute.
    const oldest = Math.floor((now - windowMs) / MINUTE);
    for (const minute of buckets.keys()) if (minute < oldest) buckets.delete(minute);
  };
  return {
    record(status, now) {
      const minute = Math.floor(now / MINUTE);
      const b = buckets.get(minute) ?? {
        total: 0,
        serverErrors: 0,
        unauthorized: 0,
        rateLimited: 0,
      };
      b.total++;
      if (status >= 500) b.serverErrors++;
      else if (status === 401) b.unauthorized++;
      else if (status === 429) b.rateLimited++;
      buckets.set(minute, b);
      prune(now);
    },
    snapshot(now) {
      prune(now);
      const sum: HttpOutcomes = { total: 0, serverErrors: 0, unauthorized: 0, rateLimited: 0 };
      for (const b of buckets.values()) {
        sum.total += b.total;
        sum.serverErrors += b.serverErrors;
        sum.unauthorized += b.unauthorized;
        sum.rateLimited += b.rateLimited;
      }
      return sum;
    },
  };
}
