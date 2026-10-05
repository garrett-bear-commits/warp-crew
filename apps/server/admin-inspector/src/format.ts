// Pure display formatting. "Now" is always a server time from a response (ADR-009): the page
// never reads the wall clock, so relative times are relative to the response that carried them.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function finite(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms);
}

/** "2026-10-01 14:03:22 UTC" (epoch ms; '' when absent). */
export function absTime(ms: unknown): string {
  if (!finite(ms)) return '';
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", "in 4 h" relative to a server `now`. */
export function relTime(at: unknown, now: unknown): string {
  if (!finite(at)) return '';
  if (!finite(now)) return absTime(at);
  const diff = now - at;
  const span = Math.abs(diff);
  let text: string;
  if (span < 45_000) return 'just now';
  if (span < 90_000) text = '1 min';
  else if (span < 45 * MINUTE) text = `${Math.round(span / MINUTE)} min`;
  else if (span < 90 * MINUTE) text = '1 h';
  else if (span < 22 * HOUR) text = `${Math.round(span / HOUR)} h`;
  else if (span < 36 * HOUR) text = '1 day';
  else if (span < 26 * DAY) text = `${Math.round(span / DAY)} days`;
  else if (span < 320 * DAY) {
    const months = Math.max(1, Math.round(span / (30 * DAY)));
    text = `${months} mo`;
  } else {
    const years = Math.max(1, Math.round(span / (365 * DAY)));
    text = `${years} y`;
  }
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** 1520 → "1,520". */
export function fmtInt(n: unknown): string {
  if (!finite(n)) return '';
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 1536 → "1.5 KB". */
export function fmtBytes(n: unknown): string {
  if (!finite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Epoch ms from a `datetime-local` value (the operator's local time); null when empty/invalid. */
export function epochFromLocalInput(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** "save_reason" → "save reason". */
export function humanize(key: string): string {
  return key.replace(/_/g, ' ');
}
