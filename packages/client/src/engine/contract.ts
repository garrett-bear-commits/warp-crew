// Engine contract (§5.1, Appendix). The engine is pure: apply/step take an injected now/rng, two
// seeded streams (sim, cosmetic), the journal records inputs, and offline (onGap) never advances
// progressOf (§1 "Engine purity"). Everything the server may read out of a blob is `summary`.
import type { Summary as ContractSummary } from '@foundation/contracts';

/** Declared summary scalars — the only fields the server may read (§5.1). */
export type Summary = ContractSummary;

/** Seeded random stream. `next()` ∈ [0, 1). */
export interface Rng {
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Serialisable stream state so a snapshot can resume the same sequence. */
  state(): number;
  /** Restore a previously captured state. */
  restore(state: number): void;
}

/** mulberry32: small, fast, good enough for cosmetic and sim streams; deterministic per seed. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const nextU32 = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    next: () => nextU32() / 4294967296,
    int(maxExclusive) {
      if (!(maxExclusive > 0)) return 0;
      return nextU32() % Math.floor(maxExclusive);
    },
    state: () => a,
    restore(s) {
      a = s >>> 0;
    },
  };
}

/** Two independent streams derived from one seed (§1): sim decides outcomes, cosmetic never does. */
export function createRngStreams(seed: number): { sim: Rng; cosmetic: Rng } {
  const base = createSeededRng(seed);
  // derive two well-separated seeds so the streams never coincide even for seed 0
  const simSeed = Math.floor(base.next() * 4294967296) ^ 0x51ed270b;
  const cosmeticSeed = Math.floor(base.next() * 4294967296) ^ 0x2545f491;
  return { sim: createSeededRng(simSeed), cosmetic: createSeededRng(cosmeticSeed) };
}

/** Per-call context: server-anchored `now`, the sim stream, the current tick, catch-up flag. */
export interface Ctx {
  /** Server-anchored epoch ms (clock/index.ts). */
  now: number;
  /** Sim stream (outcome-bearing). */
  rng: Rng;
  tick: number;
  /** True while the loop is replaying missed ticks under the catch-up cap. */
  catchUp: boolean;
}

/** Effects are transient (bounded ring, dropped under catch-up); anything the player must acknowledge lives in state. */
export interface Effect {
  kind: string;
  tick: number;
  ttlTicks?: number;
  payload?: unknown;
}

/** What `newState` receives (Appendix). */
export interface NewStateInit {
  now: number;
  seed: number;
  rng: Rng;
  playerId?: string;
}

export interface Engine<S, A, E extends Effect = Effect> {
  newState(init: NewStateInit): S;
  /** Turn-based input (match-3, card, puzzle). May mutate in place; returns the state to publish. */
  apply(state: S, action: A, ctx: Ctx): { state: S; effects: E[] };
  /** Fixed-step sim (idle, TD, delve). */
  step?(state: S, dtTicks: number, ctx: Ctx): { state: S; effects: E[] };
  /** Re-checked every tick by the loop; a paused sim consumes no ticks. */
  isPaused?(state: S): boolean;
  /** Big-gap hand-off; MUST NOT raise progressOf (asserted by the loop). */
  onGap?(
    state: S,
    gap: { deviceSec: number; serverSec: number },
    ctx: Ctx,
  ): { state: S; effects: E[] };
  /** Wall-clock hand-offs (daily reset etc.), called before a push/autosave. */
  settle?(state: S, ctx: Ctx): S;
  /** Monotone ordinal, safe integer ≥ 0 (§1). Required. */
  progressOf(state: S): number;
  /** Declared summary scalars — the only fields the server may read. */
  summary?(state: S): Summary;
}

/** Bounded effect ring: drops the oldest when full, drops everything pushed under catch-up, expires by ttl. */
export interface EffectRing<E extends Effect> {
  push(effects: readonly E[], opts?: { catchUp?: boolean }): void;
  /** Take and remove every live effect (optionally only of the given kinds). */
  drain(kinds?: readonly string[]): E[];
  /** Peek without removing. */
  peek(): readonly E[];
  /** Drop effects whose tick + ttlTicks < currentTick. */
  expire(currentTick: number): void;
  size(): number;
  readonly capacity: number;
  /** Count of effects dropped (capacity or catch-up); diagnostics only. */
  dropped(): number;
  subscribe(cb: () => void): () => void;
}

export function createEffectRing<E extends Effect>(capacity = 64): EffectRing<E> {
  const buf: E[] = [];
  let droppedCount = 0;
  const subs = new Set<() => void>();
  const notify = (): void => {
    for (const s of subs) s();
  };
  return {
    capacity,
    push(effects, opts) {
      if (effects.length === 0) return;
      if (opts?.catchUp) {
        droppedCount += effects.length;
        return;
      }
      for (const e of effects) {
        if (buf.length >= capacity) {
          buf.shift();
          droppedCount++;
        }
        buf.push(e);
      }
      notify();
    },
    drain(kinds) {
      if (!kinds) {
        const out = buf.splice(0, buf.length);
        if (out.length) notify();
        return out;
      }
      const out: E[] = [];
      for (let i = buf.length - 1; i >= 0; i--) {
        const e = buf[i]!;
        if (kinds.includes(e.kind)) {
          out.unshift(e);
          buf.splice(i, 1);
        }
      }
      if (out.length) notify();
      return out;
    },
    peek: () => buf,
    expire(currentTick) {
      let removed = false;
      for (let i = buf.length - 1; i >= 0; i--) {
        const e = buf[i]!;
        if (e.ttlTicks !== undefined && e.tick + e.ttlTicks < currentTick) {
          buf.splice(i, 1);
          removed = true;
        }
      }
      if (removed) notify();
    },
    size: () => buf.length,
    dropped: () => droppedCount,
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
