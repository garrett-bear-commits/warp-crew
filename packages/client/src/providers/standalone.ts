// Standalone platform (§5.3 createStandalonePlatform): no SDK. Identity comes from a QA-minted
// token passed in options (Lab `qa_` identities or a mock token for the dev server); no payments
// (begin → error 'unsupported'); KV mirror in memory (break-glass reads it back); notifications
// ineligible; share via navigator.share when present; no screenshot requests; lifecycle from the
// document.
import {
  consoleErrorSink,
  documentLifecycle,
  type PlatformAdapter,
  type Player,
  type PurchaseOutcome,
} from './types.ts';

export interface StandaloneOptions {
  playerId: string;
  /** Provider-shaped token for playerId (QA-minted, or `mock.<playerId>.<iatMs>` against a mock verifier). */
  token: string;
  /** Obtain a newly issued token after a server-requested credential step-up. */
  refreshToken?: () => Promise<string | null>;
  registered?: boolean;
  displayName?: string;
  /** Optional token for a previous identity (identity-switch rehearsal); one use. */
  previous?: { playerId: string; token: string } | null;
  /** Injected navigator.share; undefined probes the global; null disables. */
  share?: ((data: { title?: string; text?: string; url?: string }) => Promise<void>) | null;
  markLoaded?: () => void;
}

export function createStandalonePlatform(o: StandaloneOptions): PlatformAdapter {
  const player: Player = {
    playerId: o.playerId,
    registered: o.registered ?? false,
    ...(o.displayName ? { displayName: o.displayName } : {}),
  };
  let previous = o.previous ?? null;
  let token = o.token;
  let refreshInFlight: Promise<string | null> | null = null;
  const kvStore = new Map<string, string>();
  let kvDirty = new Map<string, string | null>();
  const nav = (
    globalThis as {
      navigator?: { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    }
  ).navigator;
  const share =
    o.share === undefined
      ? nav && typeof nav.share === 'function'
        ? (d: { title?: string; text?: string; url?: string }) => nav.share!(d)
        : null
      : o.share;
  let loaded = false;

  return {
    name: 'standalone',
    identity: {
      ready: async () => {},
      isReady: () => true,
      getPlayer: () => player,
      login: async () => {},
      async refreshCredential() {
        if (!o.refreshToken) return null;
        if (!refreshInFlight) {
          const staleToken = token;
          refreshInFlight = o
            .refreshToken()
            .then((fresh) => {
              if (!fresh || fresh === staleToken) return null;
              token = fresh;
              return token;
            })
            .finally(() => {
              refreshInFlight = null;
            });
        }
        return refreshInFlight;
      },
      tokenFor: (id) => (id === o.playerId ? token : null),
      previousToken() {
        const p = previous;
        previous = null;
        return p;
      },
      onIdentityChanged: () => () => {},
    },
    kv: {
      set(key, value) {
        kvDirty.set(key, value);
      },
      delete(key) {
        kvDirty.set(key, null);
      },
      async flush() {
        for (const [k, v] of kvDirty) {
          if (v === null) kvStore.delete(k);
          else kvStore.set(k, v);
        }
        kvDirty = new Map();
      },
      readBreakGlass: async (key) => kvStore.get(key) ?? null,
    },
    payments: {
      products: async () => [],
      begin: async (): Promise<PurchaseOutcome> => ({
        kind: 'error',
        message: 'purchases are unavailable on the standalone platform',
      }),
      complete: async () => ({ kind: 'invalid_token', message: 'purchases are unavailable' }),
      recoverIncompleteBatch: async () => ({
        outcome: 'drained',
        completed: [],
        retryable: [],
        invalid: [],
        pages: [],
      }),
      recoverIncomplete: async () => {},
    },
    notifications: {
      eligible: () => false,
      scheduleLadder: async (items) => ({
        scheduled: [],
        failed: items.map((i) => ({ id: i.id, reason: 'ineligible' })),
      }),
      unschedule: async () => {},
    },
    share: {
      available: () => share !== null,
      async share(payload) {
        if (!share) return false;
        try {
          await share(payload);
          return true;
        } catch {
          return false;
        }
      },
    },
    screenshots: { available: () => false, setProvider() {} },
    analytics: { track() {}, markFirstMilestone() {} },
    loading: {
      markLoaded() {
        if (loaded) return;
        loaded = true;
        o.markLoaded?.();
      },
      progress() {},
    },
    lifecycle: documentLifecycle(),
    entryPayload: () => ({}),
    errors: consoleErrorSink(),
  };
}
