/** Deterministic clock for tests. Every server/client module takes a `now()` — never Date.now. */
export class FakeClock {
  #now: number;
  constructor(start = 1_755_475_200_000) {
    this.#now = start;
  }
  now = (): number => this.#now;
  set(ms: number): void {
    this.#now = ms;
  }
  advance(ms: number): number {
    this.#now += ms;
    return this.#now;
  }
  advanceSeconds(s: number): number {
    return this.advance(s * 1000);
  }
  advanceDays(d: number): number {
    return this.advance(d * 86_400_000);
  }
}
