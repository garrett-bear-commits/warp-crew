// @ts-nocheck
// Wall-clock progression. Time is trustedNow() against stored timestamps.
// Never frame-delta for progression. Animation dt is separate.

import { trustedNow } from './time.js';
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

export function wallClockProgress(job, now = trustedNow()) {
  const duration = Math.max(1, job.endAt - job.startedAt);
  const elapsed = Math.max(0, Math.min(now - job.startedAt, duration));
  return {
    elapsed,
    remaining: Math.max(0, job.endAt - now),
    progress: elapsed / duration,
    complete: now >= job.endAt,
  };
}

export function makeTimedJob({ id, kind, minutes, payload = {}, startedAt = trustedNow() }) {
  return {
    id,
    kind,
    minutes,
    payload,
    startedAt,
    endAt: startedAt + minutes * MS_PER_MINUTE,
  };
}

/** Linear regen: units gained since lastClaimAt, capped at max. */
export function regenAmount({ lastClaimAt, ratePerHour, max, current = 0, now = trustedNow() }) {
  if (lastClaimAt == null || ratePerHour <= 0) {
    return { gained: 0, nextAt: now + MS_PER_HOUR / Math.max(ratePerHour, 0.0001), elapsedMs: 0 };
  }
  const elapsedMs = Math.max(0, now - lastClaimAt);
  const gainedRaw = (elapsedMs / MS_PER_HOUR) * ratePerHour;
  const room = Math.max(0, max - current);
  const gained = Math.min(room, gainedRaw);
  const msPerUnit = MS_PER_HOUR / ratePerHour;
  const frac = gainedRaw % 1;
  const nextAt = now + (1 - frac) * msPerUnit;
  return { gained, nextAt, elapsedMs };
}

export function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
