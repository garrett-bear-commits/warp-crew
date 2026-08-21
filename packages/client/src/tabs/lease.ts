// Cross-tab exclusive lease when Web Locks are missing. BroadcastChannel (or an injected bus)
// carries claims/heartbeats; the lexicographically smaller owner id wins a simultaneous claim.
// Not a localStorage check-then-set: ownership is only granted after a tie-break window and is
// lost on heartbeat expiry, explicit release, steal, or silent abandon.
import { mintId, realTimers, type Timers } from '../ids.ts';

export const TAB_LEASE_HEARTBEAT_MS = 25;
export const TAB_LEASE_TTL_MS = 80;
export const TAB_LEASE_PROBE_MS = 40;
export const TAB_LEASE_TIE_MS = 20;

export interface TabBus {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export function createMemoryTabBus(): TabBus {
  const listeners = new Set<(m: unknown) => void>();
  return {
    post(message) {
      for (const l of [...listeners]) l(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createBroadcastTabBus(channelName: string): TabBus | null {
  const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (typeof Ctor !== 'function') return null;
  const channel = new Ctor(channelName);
  return {
    post(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      const handler = (event: MessageEvent): void => {
        listener(event.data);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}

type LeaseType = 'claim' | 'heartbeat' | 'release' | 'steal';

interface LeaseMessage {
  v: 1;
  name: string;
  owner: string;
  type: LeaseType;
  until?: number;
}

function isLeaseMessage(value: unknown): value is LeaseMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    m.v === 1 &&
    typeof m.name === 'string' &&
    typeof m.owner === 'string' &&
    (m.type === 'claim' || m.type === 'heartbeat' || m.type === 'release' || m.type === 'steal')
  );
}

export interface TabLease {
  readonly ownerId: string;
  isHeld(): boolean;
  acquire(opts?: { steal?: boolean; wait?: boolean }): Promise<boolean>;
  release(): void;
  /** Stop heartbeats without announcing release — models a crashed tab. */
  abandon(): void;
  destroy(): void;
  onChange(cb: (held: boolean) => void): () => void;
}

export function createTabLease(opts: {
  name: string;
  bus: TabBus;
  now: () => number;
  timers?: Timers;
  ownerId?: string;
  heartbeatMs?: number;
  ttlMs?: number;
  probeMs?: number;
  tieMs?: number;
}): TabLease {
  const timers = opts.timers ?? realTimers();
  const ownerId = opts.ownerId ?? mintId();
  const heartbeatMs = opts.heartbeatMs ?? TAB_LEASE_HEARTBEAT_MS;
  const ttlMs = opts.ttlMs ?? TAB_LEASE_TTL_MS;
  const probeMs = opts.probeMs ?? TAB_LEASE_PROBE_MS;
  const tieMs = opts.tieMs ?? TAB_LEASE_TIE_MS;
  const subs = new Set<(held: boolean) => void>();
  const waiters = new Set<() => void>();
  let held = false;
  let destroyed = false;
  let remoteOwner: string | null = null;
  let remoteUntil = 0;
  let seenLowerClaim = false;
  let heartbeatHandle: unknown = null;
  let acquireTail: Promise<boolean> = Promise.resolve(false);

  const wake = (): void => {
    for (const w of [...waiters]) w();
  };

  const setHeld = (next: boolean): void => {
    if (held === next) return;
    held = next;
    for (const s of subs) s(held);
  };

  const post = (type: LeaseType, until?: number): void => {
    const message: LeaseMessage = { v: 1, name: opts.name, owner: ownerId, type };
    if (until !== undefined) message.until = until;
    opts.bus.post(message);
  };

  const stopHeartbeat = (): void => {
    if (heartbeatHandle !== null) {
      timers.clear(heartbeatHandle);
      heartbeatHandle = null;
    }
  };

  const beat = (): void => {
    if (!held || destroyed) return;
    post('heartbeat', opts.now() + ttlMs);
  };

  const startHeartbeat = (): void => {
    stopHeartbeat();
    beat();
    heartbeatHandle = timers.set(function tick() {
      beat();
      if (held && !destroyed) heartbeatHandle = timers.set(tick, heartbeatMs);
    }, heartbeatMs);
  };

  const drop = (): void => {
    stopHeartbeat();
    setHeld(false);
  };

  const take = (): void => {
    remoteOwner = null;
    remoteUntil = 0;
    seenLowerClaim = false;
    setHeld(true);
    startHeartbeat();
  };

  const remoteLive = (): boolean => remoteOwner !== null && remoteUntil > opts.now();

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (ms <= 0) {
        resolve();
        return;
      }
      const handle = timers.set(() => {
        waiters.delete(go);
        resolve();
      }, ms);
      const go = (): void => {
        timers.clear(handle);
        waiters.delete(go);
        resolve();
      };
      waiters.add(go);
    });

  const unsub = opts.bus.subscribe((raw) => {
    if (!isLeaseMessage(raw) || raw.name !== opts.name || raw.owner === ownerId) return;
    if (raw.type === 'release') {
      if (raw.owner === remoteOwner) {
        remoteOwner = null;
        remoteUntil = 0;
      }
      wake();
      return;
    }
    if (raw.type === 'steal') {
      if (held) drop();
      remoteOwner = raw.owner;
      remoteUntil = opts.now() + ttlMs;
      wake();
      return;
    }
    if (raw.type === 'claim') {
      if (raw.owner < ownerId) seenLowerClaim = true;
      if (!held) {
        remoteOwner = raw.owner;
        remoteUntil = Math.max(remoteUntil, opts.now() + ttlMs);
      } else if (raw.owner < ownerId) {
        drop();
        remoteOwner = raw.owner;
        remoteUntil = opts.now() + ttlMs;
      }
      wake();
      return;
    }
    if (raw.type === 'heartbeat') {
      const until = typeof raw.until === 'number' ? raw.until : opts.now() + ttlMs;
      remoteOwner = raw.owner;
      remoteUntil = until;
      if (held && raw.owner < ownerId) drop();
      wake();
    }
  });

  const tryClaim = async (steal: boolean): Promise<boolean> => {
    if (destroyed) return false;
    if (held) return true;
    if (steal) {
      post('steal');
      take();
      return true;
    }
    await sleep(probeMs);
    if (destroyed) return false;
    if (remoteLive()) return false;
    seenLowerClaim = false;
    post('claim');
    await sleep(tieMs);
    if (destroyed) return false;
    if (seenLowerClaim || remoteLive()) return false;
    take();
    return true;
  };

  const acquireOne = async (steal: boolean, wait: boolean): Promise<boolean> => {
    while (!destroyed) {
      if (await tryClaim(steal)) return true;
      if (!wait) return false;
      const waitMs = remoteLive() ? Math.max(1, remoteUntil - opts.now()) : ttlMs;
      await sleep(waitMs);
    }
    return false;
  };

  return {
    ownerId,
    isHeld: () => held,
    acquire(options = {}) {
      if (destroyed) return Promise.resolve(false);
      const steal = options.steal === true;
      const wait = options.wait !== false;
      const next = acquireTail.then(
        () => acquireOne(steal, wait),
        () => acquireOne(steal, wait),
      );
      acquireTail = next.then(
        () => held,
        () => false,
      );
      return next;
    },
    release() {
      if (!held) return;
      drop();
      post('release');
      wake();
    },
    abandon() {
      stopHeartbeat();
      setHeld(false);
      wake();
    },
    destroy() {
      destroyed = true;
      if (held) post('release');
      drop();
      unsub();
      wake();
    },
    onChange(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
