// client/clock (§5.2 Clock, ADR-009). The ONLY module in the client allowed to read Date.now /
// performance.now. `now()` is server-anchored via a median, RTT-filtered offset built from
// serverNow samples; `deviceNow()` is the wall clock; `mark()/sinceMark()` are monotonic (hiddenMs);
// offline credit = min(deviceGap, serverGap + tolerance).

export interface ClockSample {
  /** Estimated server − device offset for this sample (ms). */
  offset: number;
  /** Round-trip time (ms) used to weight/filter the sample. */
  rtt: number;
}

export interface Clock {
  /** Server-anchored integer epoch ms: round(deviceNow() + offset()). Equal to deviceNow() until the first sample. */
  now(): number;
  /** Device wall clock (epoch ms). Only for device gaps and display, never for credit on its own. */
  deviceNow(): number;
  /** Feed one response: when the request was sent, when the response arrived (device ms), serverNow (ms). */
  observe(sentAt: number, receivedAt: number, serverNow: number): void;
  /** Current server − device offset (ms); 0 until the first sample. */
  offset(): number;
  /** Number of samples currently retained. */
  samples(): number;
  /** True once at least one server sample has been observed. */
  anchored(): boolean;
  /** Monotonic mark (ms since an arbitrary origin, never goes backwards). */
  mark(): number;
  /** Elapsed monotonic ms since a mark. */
  sinceMark(mark: number): number;
}

export interface ClockOptions {
  /** Injected wall clock (tests). Default Date.now. */
  deviceNow?: () => number;
  /** Injected monotonic source (tests). Default performance.now when available, else deviceNow. */
  monotonic?: () => number;
  /** Retained samples for the median (default 9). */
  maxSamples?: number;
}

/**
 * Median of the offsets whose RTT is at or below the median RTT (a cheap Christian/NTP-style
 * filter: slow, queued responses do not drag the anchor). Pure; exported for tests.
 */
export function medianOffset(samples: readonly ClockSample[]): number {
  if (samples.length === 0) return 0;
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  const medianRtt = rtts[Math.floor((rtts.length - 1) / 2)]!;
  const kept = samples.filter((s) => s.rtt <= medianRtt).map((s) => s.offset);
  const pool = (kept.length ? kept : samples.map((s) => s.offset)).sort((a, b) => a - b);
  const mid = Math.floor(pool.length / 2);
  return pool.length % 2 === 1 ? pool[mid]! : (pool[mid - 1]! + pool[mid]!) / 2;
}

/** offline/streak/timer credit = min(deviceGap, serverGap + tolerance), never negative (§1, ADR-009). */
export function offlineCredit(
  deviceGapMs: number,
  serverGapMs: number,
  toleranceMs: number,
): number {
  const d = Number.isFinite(deviceGapMs) ? Math.max(0, deviceGapMs) : 0;
  const s = Number.isFinite(serverGapMs) ? Math.max(0, serverGapMs) : 0;
  const t = Number.isFinite(toleranceMs) ? Math.max(0, toleranceMs) : 0;
  return Math.min(d, s + t);
}

export function createClock(opts: ClockOptions = {}): Clock {
  const deviceNow = opts.deviceNow ?? (() => Date.now());
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  const monotonicSource =
    opts.monotonic ??
    (perf && typeof perf.now === 'function' ? () => perf.now() : () => deviceNow());
  const maxSamples = Math.max(1, opts.maxSamples ?? 9);
  const samples: ClockSample[] = [];
  let offset = 0;
  let lastMono = -Infinity;
  const mono = (): number => {
    // never let a monotonic reading go backwards even if the source misbehaves
    const m = monotonicSource();
    if (m < lastMono) return lastMono;
    lastMono = m;
    return m;
  };
  return {
    // integer epoch ms: the wire contract's EpochMs is an integer and a median offset built from
    // rtt/2 estimates is fractional
    now: () => Math.round(deviceNow() + offset),
    deviceNow,
    observe(sentAt, receivedAt, serverNow) {
      if (![sentAt, receivedAt, serverNow].every(Number.isFinite)) return;
      const rtt = Math.max(0, receivedAt - sentAt);
      // the server stamped serverNow roughly half-way through the round trip
      const est = serverNow + rtt / 2;
      samples.push({ offset: est - receivedAt, rtt });
      if (samples.length > maxSamples) samples.shift();
      offset = medianOffset(samples);
    },
    offset: () => offset,
    samples: () => samples.length,
    anchored: () => samples.length > 0,
    mark: mono,
    sinceMark: (m) => Math.max(0, mono() - m),
  };
}
