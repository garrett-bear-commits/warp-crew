// The ONLY module in the server allowed to read the wall clock (ADR-009). Everything else takes a
// `now()` from ServerClock so tests can pin time.
export interface ServerClock {
  now(): number;
}

export const systemClock: ServerClock = {
  now: () => Date.now(),
};

export function fixedClock(
  ms: number,
): ServerClock & { set(ms: number): void; advance(ms: number): void } {
  let t = ms;
  return { now: () => t, set: (v) => (t = v), advance: (d) => (t += d) };
}
