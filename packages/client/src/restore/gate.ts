// The ONE restoring gate (§1 "Restore = write local → confirm → reload, with one restoring gate
// consulted by every writer including the teardown push"). Writers (autosave, push, beacon,
// KV mirror, journal spool) check `isRestoring()` and skip; a restore holds the gate for the
// whole write-local → confirm → reload sequence so no writer can clobber the restored slot.

export interface RestoreGate {
  isRestoring(): boolean;
  /** Run `fn` while holding the gate. Re-entrant holds nest; the gate opens when the outermost completes. */
  hold<T>(fn: () => Promise<T>): Promise<T>;
  onChange(cb: (restoring: boolean) => void): () => void;
}

export function createRestoreGate(): RestoreGate {
  let depth = 0;
  const subs = new Set<(restoring: boolean) => void>();
  const notify = (): void => {
    const r = depth > 0;
    for (const s of subs) s(r);
  };
  return {
    isRestoring: () => depth > 0,
    async hold(fn) {
      depth++;
      if (depth === 1) notify();
      try {
        return await fn();
      } finally {
        depth--;
        if (depth === 0) notify();
      }
    },
    onChange(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
