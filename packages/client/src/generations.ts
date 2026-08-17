// Generation adoption + broadcast (§1 "Generations are the only way backwards. A newer generation
// always wins on the client", §5.2 Generations). Adoption is a pure envelope transform: set the
// generation, reset the ratchet floor (keyed playerId+generation), drop old-generation queued ops
// (pending push, clientSeq), clear the acked seq. Broadcast uses BroadcastChannel when available so
// sibling tabs adopt too; otherwise a no-op.
import type { CacheEnvelope } from './storage/envelope.ts';

export interface GenerationMessage {
  type: 'generation';
  gameId: string;
  playerId: string;
  generation: number;
  at: number;
}

export interface GenerationBus {
  announce(playerId: string, generation: number, at: number): void;
  onGenerationChanged(cb: (m: GenerationMessage) => void): () => void;
  close(): void;
  readonly available: boolean;
}

/** Minimal BroadcastChannel shape (injectable). */
export interface ChannelLike {
  postMessage(m: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export function createGenerationBus(opts: {
  gameId: string;
  /** Channel factory; default probes globalThis.BroadcastChannel. */
  channel?: ((name: string) => ChannelLike) | null;
}): GenerationBus {
  const name = `foundation:${opts.gameId}:generations`;
  const factory =
    opts.channel === undefined
      ? (() => {
          const g = globalThis as { BroadcastChannel?: new (n: string) => ChannelLike };
          return typeof g.BroadcastChannel === 'function'
            ? (n: string) => new g.BroadcastChannel!(n)
            : null;
        })()
      : opts.channel;
  const subs = new Set<(m: GenerationMessage) => void>();
  let ch: ChannelLike | null = null;
  try {
    ch = factory ? factory(name) : null;
  } catch {
    ch = null;
  }
  if (ch) {
    ch.onmessage = (ev) => {
      const d = ev.data as Partial<GenerationMessage> | null;
      if (
        d &&
        d.type === 'generation' &&
        d.gameId === opts.gameId &&
        typeof d.playerId === 'string' &&
        typeof d.generation === 'number'
      ) {
        for (const s of subs) s(d as GenerationMessage);
      }
    };
  }
  return {
    available: ch !== null,
    announce(playerId, generation, at) {
      if (!ch) return;
      try {
        ch.postMessage({
          type: 'generation',
          gameId: opts.gameId,
          playerId,
          generation,
          at,
        } satisfies GenerationMessage);
      } catch {
        /* a closed channel is a no-op */
      }
    },
    onGenerationChanged(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    close() {
      try {
        ch?.close();
      } catch {
        /* ignore */
      }
      ch = null;
    },
  };
}

/**
 * Adopt a generation into an envelope: newer generation → state replaced by `state` (server head
 * or a fresh state), floor reset, pending dropped, acked seq reset. Same/older generation → the
 * envelope is returned unchanged (callers must never move backwards without a generation bump).
 */
export function adoptGeneration<S>(
  env: CacheEnvelope<S>,
  next: {
    generation: number;
    state: S;
    progress: number;
    seq: number;
    savedAt: number;
    sessionId?: string;
  },
): CacheEnvelope<S> {
  if (next.generation < env.generation) return env;
  const out: CacheEnvelope<S> = {
    ...env,
    generation: next.generation,
    state: next.state,
    progress: next.progress,
    savedAt: next.savedAt,
    dirty: false,
    lastAckedSeq: next.seq,
    clientSeq: 0,
    ratchetFloor: { playerId: env.playerId, generation: next.generation, progress: next.progress },
    lastVerdict: null,
  };
  delete out.pending;
  delete out.rngState;
  if (next.sessionId) out.sessionId = next.sessionId;
  return out;
}
