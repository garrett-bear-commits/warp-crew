// Multi-tab leader election (§5.2 Multi-tab, §1 "Only the leader tab writes"). Web Locks: the
// leader holds an exclusive lock for the page lifetime; followers are read-only with a "Play here"
// takeover (`steal`). Fallback when the API is unavailable: this tab is the leader (the ratchet —
// not the lock — is the save-path safety mechanism). Retention mutation does not trust that
// fallback; without Web Locks it fails closed.

export interface LockRequestOptions {
  mode?: 'exclusive' | 'shared';
  ifAvailable?: boolean;
  steal?: boolean;
  signal?: AbortSignal;
}

/** navigator.locks shape (injectable). */
export interface LocksLike {
  request<T>(
    name: string,
    options: LockRequestOptions,
    cb: (lock: unknown | null) => Promise<T> | T,
  ): Promise<T>;
}

export type LeaderRole = 'leader' | 'follower' | 'unknown';

export interface LeaderElection {
  role(): LeaderRole;
  isLeader(): boolean;
  /** Try to become leader without stealing (ifAvailable). Resolves once decided. */
  request(): Promise<LeaderRole>;
  /** "Play here": steal the lock from the current leader. */
  takeover(): Promise<LeaderRole>;
  /** Release the lock (teardown). */
  release(): void;
  onChange(cb: (role: LeaderRole) => void): () => void;
  /** True when the Web Locks API is available (else the fallback made this tab the leader). */
  readonly available: boolean;
}

export function createLeaderElection(opts: {
  name: string;
  /** Injected locks API; undefined probes navigator.locks; null forces the fallback. */
  locks?: LocksLike | null;
}): LeaderElection {
  const locks: LocksLike | null =
    opts.locks === undefined
      ? (((globalThis as { navigator?: { locks?: LocksLike } }).navigator?.locks as
          LocksLike | undefined) ?? null)
      : opts.locks;
  const subs = new Set<(r: LeaderRole) => void>();
  let role: LeaderRole = locks ? 'unknown' : 'leader';
  let releaseHeld: (() => void) | null = null;

  const setRole = (r: LeaderRole): void => {
    if (r === role) return;
    role = r;
    for (const s of subs) s(r);
  };

  /** Hold the lock until release(); resolves the outer promise once we hold it. */
  const hold = (steal: boolean): Promise<LeaderRole> =>
    new Promise<LeaderRole>((resolve) => {
      let settled = false;
      const done = (r: LeaderRole): void => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      const options: LockRequestOptions = steal
        ? { mode: 'exclusive', steal: true }
        : { mode: 'exclusive', ifAvailable: true };
      locks!
        .request(opts.name, options, (lock) => {
          if (!lock) {
            // ifAvailable and someone else holds it → follower
            setRole('follower');
            done('follower');
            return undefined;
          }
          setRole('leader');
          done('leader');
          return new Promise<void>((res) => {
            releaseHeld = res;
          });
        })
        .then(
          () => {
            // the callback finished: we released (release() already flipped the role)
            if (role === 'leader') setRole('follower');
          },
          () => {
            // AbortError: the lock was stolen by another tab ("Play here" there) — we follow
            releaseHeld = null;
            if (role === 'leader') setRole('follower');
            done('follower');
          },
        );
    });

  return {
    available: locks !== null,
    role: () => role,
    isLeader: () => role === 'leader',
    async request() {
      if (!locks) return 'leader';
      if (role === 'leader') return 'leader';
      return hold(false);
    },
    async takeover() {
      if (!locks) return 'leader';
      if (role === 'leader') return 'leader';
      return hold(true);
    },
    release() {
      const r = releaseHeld;
      releaseHeld = null;
      if (r) r();
      if (locks) setRole('follower');
    },
    onChange(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
