// Storage tiers (§5.2, ADR-005): localStorage primary (sync, teardown-safe) → memory shim.
// Under URL hosting the origin is cross-site to jest.com, so blocked/partitioned storage is a
// normal case: every access is wrapped, and "blocked ≠ empty" — the mode is reported so the
// player can be told "Not saving on this device — cloud only".

export type StorageMode = 'local' | 'memory';

export type StorageSetResult =
  { ok: true } | { ok: false; reason: 'quota' | 'blocked'; message?: string };

export interface StorageTier {
  /** Primary tier in use. `memory` when localStorage is unavailable (blocked/partitioned/throws). */
  readonly mode: StorageMode;
  get(key: string): string | null;
  /** Writes through to the primary tier and always to the memory overlay (so a session survives a quota failure). */
  set(key: string, value: string): StorageSetResult;
  remove(key: string): void;
  /** Keys visible in the primary tier (prefix filter). Memory overlay keys included. */
  keys(prefix?: string): string[];
  /** True after any set failed with quota (persisted state may be stale on disk). */
  degraded(): boolean;
  /** Last error message from the primary tier, diagnostics only. */
  lastError(): string | null;
}

/** Minimal Storage shape (localStorage-like). Injectable for tests and the mock platform. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface CreateStorageOptions {
  /** Explicit primary tier; `null` forces the memory shim; undefined probes globalThis.localStorage. */
  localStorage?: StorageLike | null;
  /** Probe key written+removed to detect a storage that exists but throws on write (default 'foundation:probe'). */
  probeKey?: string;
}

/** Access globalThis.localStorage under try/catch — a SecurityError is a normal case. */
export function probeLocalStorage(g: typeof globalThis = globalThis): StorageLike | null {
  try {
    const ls = (g as { localStorage?: StorageLike }).localStorage;
    if (!ls) return null;
    // touching length can throw for partitioned/blocked storage
    void ls.length;
    return ls;
  } catch {
    return null;
  }
}

export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number; message?: string };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message ?? '')
  );
}

export function createStorage(opts: CreateStorageOptions = {}): StorageTier {
  const overlay = memoryStorage();
  const probeKey = opts.probeKey ?? 'foundation:probe';
  let primary: StorageLike | null =
    opts.localStorage === undefined ? probeLocalStorage() : opts.localStorage;
  let mode: StorageMode = primary ? 'local' : 'memory';
  let degraded = false;
  let lastError: string | null = null;

  // A storage that exists but throws on write (private mode in old WebKit) is treated as blocked.
  if (primary) {
    try {
      primary.setItem(probeKey, '1');
      primary.removeItem(probeKey);
    } catch (e) {
      if (isQuotaError(e)) {
        // full but readable: keep it as the primary for reads; writes will report quota
        degraded = true;
        lastError = 'quota on probe';
      } else {
        lastError = e instanceof Error ? e.message : String(e);
        primary = null;
        mode = 'memory';
      }
    }
  }

  return {
    get mode() {
      return mode;
    },
    get(key) {
      const o = overlay.getItem(key);
      if (o !== null) return o;
      if (!primary) return null;
      try {
        return primary.getItem(key);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
    set(key, value) {
      overlay.setItem(key, value);
      if (!primary) return { ok: false, reason: 'blocked' };
      try {
        primary.setItem(key, value);
        return { ok: true };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (isQuotaError(e)) {
          degraded = true;
          return { ok: false, reason: 'quota', message: lastError };
        }
        // storage became blocked mid-session: fall back to memory for the rest of the session
        primary = null;
        mode = 'memory';
        return { ok: false, reason: 'blocked', message: lastError };
      }
    },
    remove(key) {
      overlay.removeItem(key);
      if (!primary) return;
      try {
        primary.removeItem(key);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    },
    keys(prefix = '') {
      const out = new Set<string>();
      for (let i = 0; i < overlay.length; i++) {
        const k = overlay.key(i);
        if (k && k.startsWith(prefix)) out.add(k);
      }
      if (primary) {
        try {
          for (let i = 0; i < primary.length; i++) {
            const k = primary.key(i);
            if (k && k.startsWith(prefix)) out.add(k);
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      return Array.from(out);
    },
    degraded: () => degraded,
    lastError: () => lastError,
  };
}

/** Player-visible storage mode (§5.2 "storageMode() reported"). */
export function storageMode(tier: StorageTier): StorageMode {
  return tier.mode;
}

let persistRequested = false;
/**
 * navigator.storage.persist() once per page (§5.2). Guarded: absent API, rejected promise and
 * repeated calls are all no-ops. Returns the granted flag when known.
 */
export async function requestPersistentStorage(
  nav: { storage?: { persist?: () => Promise<boolean> } } | undefined = (
    globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }
  ).navigator,
): Promise<boolean | null> {
  if (persistRequested) return null;
  persistRequested = true;
  try {
    const persist = nav?.storage?.persist;
    if (typeof persist !== 'function') return null;
    return await persist.call(nav!.storage);
  } catch {
    return null;
  }
}

/** Test hook: allow persist() to be requested again in a fresh test. */
export function resetPersistGuard(): void {
  persistRequested = false;
}
