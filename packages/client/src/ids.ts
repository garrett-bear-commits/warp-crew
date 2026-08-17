// Client-minted identifiers (§4.1 commandId, §5.2 sessionId). crypto.randomUUID when available;
// a getRandomValues-based v4 otherwise. Never Math.random for idempotency keys.

export function mintId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Injectable timers so every schedule in the adapter is deterministic under test. */
export interface Timers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export function realTimers(g: typeof globalThis = globalThis): Timers {
  return {
    set: (cb, ms) => g.setTimeout(cb, ms),
    clear: (h) => g.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
