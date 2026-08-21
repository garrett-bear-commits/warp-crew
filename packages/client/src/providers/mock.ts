// Mock platform (§3 testkit, §5.3 createMockPlatform(pathologies)). Honours every knob in
// @foundation/testkit ProviderPathologies so the conformance suite can drive the adapter through
// every path a real provider must pass. Tokens are `mock.<playerId>.<iatMs>[.registered]` (see
// jest-verify mintMockToken); receipts are `mockreceipt.<base64url json>` (mintMockReceipt).
// Browser-safe: no node imports; base64url via btoa.
import type { IntegrityEvent } from '@foundation/contracts';
import type { Timers } from '../ids.ts';
import { realTimers } from '../ids.ts';
import { memoryStorage, type StorageLike } from '../storage/tiers.ts';
import {
  bufferedErrorSink,
  type ErrorSink,
  type IdentityClient,
  type LadderItem,
  type LifecycleProvider,
  type PlatformAdapter,
  type PlatformKV,
  type Player,
  type PurchaseOutcome,
} from './types.ts';

/**
 * Structural mirror of @foundation/testkit's ProviderPathologies (the testkit is node-flavoured
 * and stays a devDependency; test/unit/providers.test.ts asserts both types are identical).
 */
export interface ProviderPathologies {
  /** identity.ready() never resolves (SDK hangs). */
  identityNeverReady?: boolean;
  /** identity.ready() resolves after N ms. */
  identityDelayMs?: number;
  /** tokenFor() returns null (no token). */
  noToken?: boolean;
  /** getPlayer() flips to a different registered player after N ms (guest → account). */
  identitySwitchAfterMs?: { ms: number; playerId: string };
  /** payments.begin() resolves 'cancel'. */
  paymentsCancel?: boolean;
  /** payments.begin() resolves 'success' but omits purchaseSigned. */
  paymentsUnsignedSuccess?: boolean;
  /** payments.begin() throws. */
  paymentsThrow?: boolean;
  /** recoverIncomplete() yields N signed receipts. */
  incompletePurchases?: number;
  /** kv.set/flush reject. */
  kvWriteFails?: boolean;
  /** kv.readBreakGlass returns this value (or null). */
  kvBreakGlassValue?: string | null;
  /** notifications.eligible() false. */
  notificationsIneligible?: boolean;
  /** localStorage throws on access (blocked/partitioned). */
  storageBlocked?: boolean;
  /** localStorage quota exceeded on set. */
  storageQuotaExceeded?: boolean;
}

/** Browser-safe copy of jest-verify's mintMockToken (the verifier package is node-only). */
export function mintMockToken(playerId: string, iatMs: number, registered = false): string {
  return `mock.${playerId}.${iatMs}${registered ? '.registered' : ''}`;
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Browser-safe copy of jest-verify's mintMockReceipt. */
export function mintMockReceipt(payload: {
  aud: string;
  sub: string;
  purchase?: Record<string, unknown>;
  purchases?: Record<string, unknown>[];
}): string {
  return 'mockreceipt.' + b64url(JSON.stringify(payload));
}

export interface MockPlatformOptions {
  gameId: string;
  playerId?: string;
  registered?: boolean;
  /** Token iat source (ms). Injected clock in tests. */
  now?: () => number;
  timers?: Timers;
  products?: { sku: string; title: string; price?: number; currency?: string }[];
  /** Adds the authoritative signed `sandbox: true` fact independently of configured price. */
  sandboxPurchases?: boolean;
  /** Simulated visibility (tests flip it via the returned controls). */
  initiallyVisible?: boolean;
}

export interface MockPlatformControls {
  /** Storage shim honouring storageBlocked/storageQuotaExceeded; pass to createStorage. */
  localStorage: StorageLike | null;
  /** Fire an identity switch now (guest → registered). */
  switchIdentity(playerId: string, registered?: boolean): void;
  setVisible(visible: boolean): void;
  firePageHide(): void;
  /** KV mirror contents (write-only from the game's perspective). */
  kvStore: Map<string, string>;
  /** Everything reported to the error sink. */
  reported(): IntegrityEvent[];
  /** Notifications scheduled so far. */
  scheduled(): string[];
  /** Purchase tokens completed. */
  completed(): string[];
  loadedCount(): number;
  analytics(): { name: string; props?: Record<string, string | number | boolean> }[];
  /** Whether previousToken() has been consumed already (one use). */
  previousTokenConsumed(): boolean;
}

export function createMockPlatform(
  pathologies: ProviderPathologies = {},
  opts: MockPlatformOptions = { gameId: 'game' },
): PlatformAdapter & { controls: MockPlatformControls } {
  const timers = opts.timers ?? realTimers();
  const now = opts.now ?? (() => 0);
  const gameId = opts.gameId;
  let player: Player = {
    playerId: opts.playerId ?? 'guest-1',
    registered: opts.registered ?? false,
  };
  let prev: { playerId: string; token: string } | null = null;
  let prevConsumed = false;
  let ready = false;
  const identitySubs = new Set<(prev: Player | null, next: Player) => void>();
  const tokenFor = (playerId: string): string | null =>
    pathologies.noToken || playerId !== player.playerId
      ? null
      : mintMockToken(playerId, now(), player.registered);

  const readyPromise: Promise<void> = pathologies.identityNeverReady
    ? new Promise<void>(() => {})
    : pathologies.identityDelayMs
      ? new Promise<void>((res) => {
          timers.set(() => {
            ready = true;
            res();
          }, pathologies.identityDelayMs!);
        })
      : Promise.resolve().then(() => {
          ready = true;
        });

  const switchIdentity = (playerId: string, registered = true): void => {
    const before = player;
    prev = {
      playerId: before.playerId,
      token: mintMockToken(before.playerId, now(), before.registered),
    };
    prevConsumed = false;
    player = { playerId, registered };
    for (const cb of identitySubs) cb(before, player);
  };
  if (pathologies.identitySwitchAfterMs) {
    const sw = pathologies.identitySwitchAfterMs;
    timers.set(() => switchIdentity(sw.playerId, true), sw.ms);
  }

  const identity: IdentityClient = {
    ready: () => readyPromise,
    isReady: () => ready,
    getPlayer: () => (ready ? player : null),
    login: async () => {
      if (!player.registered) switchIdentity(player.playerId, true);
    },
    refreshCredential: async () => (ready ? tokenFor(player.playerId) : null),
    tokenFor,
    previousToken() {
      if (!prev || prevConsumed) return null;
      prevConsumed = true;
      return prev;
    },
    onIdentityChanged(cb) {
      identitySubs.add(cb);
      return () => {
        identitySubs.delete(cb);
      };
    },
  };

  const kvStore = new Map<string, string>();
  let kvDirty: Map<string, string | null> = new Map();
  const kv: PlatformKV = {
    set(key, value) {
      if (pathologies.kvWriteFails) return; // set never throws; the failure surfaces at flush
      kvDirty.set(key, value);
    },
    delete(key) {
      if (pathologies.kvWriteFails) return;
      kvDirty.set(key, null);
    },
    async flush() {
      if (pathologies.kvWriteFails) throw new Error('kv write failed');
      for (const [k, v] of kvDirty) {
        if (v === null) kvStore.delete(k);
        else kvStore.set(k, v);
      }
      kvDirty = new Map();
    },
    async readBreakGlass(key) {
      if (pathologies.kvBreakGlassValue !== undefined) return pathologies.kvBreakGlassValue;
      return kvStore.get(key) ?? null;
    },
  };

  const completed: string[] = [];
  const products = opts.products ?? [
    { sku: 'pack_small', title: 'Small pack', price: 0.99, currency: 'USD' },
  ];
  const purchaseData = (token: string, sku: string): Record<string, unknown> => ({
    purchaseToken: token,
    productSku: sku,
    createdAt: now(),
    completedAt: null,
    price: products.find((p) => p.sku === sku)?.price ?? 0,
    currency: products.find((p) => p.sku === sku)?.currency ?? 'USD',
    ...(opts.sandboxPurchases ? { sandbox: true } : {}),
  });
  const mintSigned = (token: string, sku: string): string =>
    mintMockReceipt({
      aud: gameId,
      sub: player.playerId,
      purchase: purchaseData(token, sku),
    });
  let purchaseCounter = 0;
  const payments = {
    async products() {
      return products.map((p) => ({ ...p }));
    },
    async begin(sku: string): Promise<PurchaseOutcome> {
      if (pathologies.paymentsThrow) throw new Error('payments provider failure');
      if (pathologies.paymentsCancel) return { kind: 'cancel' };
      const token = `mocktoken-${player.playerId}-${++purchaseCounter}`;
      if (pathologies.paymentsUnsignedSuccess) return { kind: 'success', purchaseToken: token };
      return { kind: 'success', purchaseToken: token, purchaseSigned: mintSigned(token, sku) };
    },
    async complete(token: string) {
      completed.push(token);
      return { kind: 'success' as const };
    },
    async recoverIncompleteBatch(
      grant: (batch: {
        purchases: { purchaseToken: string; sku: string; purchaseSigned?: string }[];
        purchasesSigned: string;
        hasMore: boolean;
      }) => Promise<readonly string[]>,
    ) {
      const n = pathologies.incompletePurchases ?? 0;
      const purchases = Array.from({ length: n }, (_, i) => {
        const token = `mockincomplete-${player.playerId}-${i + 1}`;
        const sku = products[0]?.sku ?? 'pack_small';
        return { purchaseToken: token, sku, purchaseSigned: mintSigned(token, sku) };
      });
      const tokens = new Set(
        await grant({
          purchases,
          purchasesSigned: mintMockReceipt({
            aud: gameId,
            sub: player.playerId,
            purchases: purchases.map((purchase) =>
              purchaseData(purchase.purchaseToken, purchase.sku),
            ),
          }),
          hasMore: false,
        }),
      );
      for (const purchase of purchases)
        if (tokens.has(purchase.purchaseToken)) completed.push(purchase.purchaseToken);
    },
    async recoverIncomplete(
      grant: (p: {
        purchaseToken: string;
        sku: string;
        purchaseSigned?: string;
      }) => Promise<boolean>,
      onSigned?: (jws: string) => void,
    ) {
      await payments.recoverIncompleteBatch(async (batch) => {
        if (batch.purchases.length) onSigned?.(batch.purchasesSigned);
        const tokens: string[] = [];
        for (const purchase of batch.purchases)
          if (await grant(purchase)) tokens.push(purchase.purchaseToken);
        return tokens;
      });
    },
  };

  const scheduledIds: string[] = [];
  const notifications = {
    eligible: () => !pathologies.notificationsIneligible,
    async scheduleLadder(items: LadderItem[]) {
      if (pathologies.notificationsIneligible)
        return { scheduled: [], failed: items.map((i) => ({ id: i.id, reason: 'ineligible' })) };
      const scheduled: string[] = [];
      const failed: { id: string; reason: string }[] = [];
      for (const it of items) {
        const exact = it.scheduledAt instanceof Date && Number.isFinite(it.scheduledAt.getTime());
        const fuzzy =
          Number.isInteger(it.scheduledInDays) &&
          (it.scheduledInDays ?? 0) >= 1 &&
          (it.scheduledInDays ?? 0) <= 7;
        const legacy = typeof it.delaySec === 'number' && it.delaySec >= 0;
        if (!it.id || (!legacy && exact === fuzzy)) failed.push({ id: it.id, reason: 'invalid' });
        else {
          scheduled.push(it.id);
          scheduledIds.push(it.id);
        }
      }
      return { scheduled, failed };
    },
    async unschedule(id: string) {
      const i = scheduledIds.indexOf(id);
      if (i >= 0) scheduledIds.splice(i, 1);
    },
  };

  let visible = opts.initiallyVisible ?? true;
  const visSubs = new Set<(v: boolean) => void>();
  const hideSubs = new Set<() => void>();
  const lifecycle: LifecycleProvider = {
    visible: () => visible,
    onHide(cb) {
      hideSubs.add(cb);
      return () => hideSubs.delete(cb);
    },
    onShow(cb) {
      const wrapped = (v: boolean): void => {
        if (v) cb();
      };
      visSubs.add(wrapped);
      return () => visSubs.delete(wrapped);
    },
    onExitRequested(cb) {
      const wrapped = (): void => {
        void cb();
      };
      hideSubs.add(wrapped);
      return () => hideSubs.delete(wrapped);
    },
    onVisibilityChange(cb) {
      visSubs.add(cb);
      return () => {
        visSubs.delete(cb);
      };
    },
    onPageHide(cb) {
      hideSubs.add(cb);
      return () => {
        hideSubs.delete(cb);
      };
    },
  };

  const errors = bufferedErrorSink();
  const events: { name: string; props?: Record<string, string | number | boolean> }[] = [];
  let loaded = 0;

  // storage pathologies: blocked → every access throws (createStorage falls back to memory);
  // quota → setItem throws QuotaExceededError.
  let localStorage: StorageLike | null;
  if (pathologies.storageBlocked) {
    const throwing = (): never => {
      const e = new Error('SecurityError: storage blocked');
      e.name = 'SecurityError';
      throw e;
    };
    localStorage = {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
      key: throwing,
      get length(): number {
        return throwing();
      },
    };
  } else if (pathologies.storageQuotaExceeded) {
    const mem = memoryStorage();
    localStorage = {
      ...mem,
      setItem() {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      },
      get length() {
        return mem.length;
      },
    };
  } else {
    localStorage = memoryStorage();
  }

  const sink: ErrorSink = errors;
  return {
    name: 'mock',
    identity,
    kv,
    payments,
    notifications,
    share: { available: () => true, share: async () => true },
    analytics: {
      track(name, props) {
        events.push(props ? { name, props } : { name });
      },
      markFirstMilestone() {
        events.push({ name: 'first_milestone' });
      },
    },
    loading: {
      markLoaded() {
        loaded++;
      },
      progress() {},
    },
    lifecycle,
    entryPayload: () => ({}),
    errors: sink,
    controls: {
      localStorage,
      switchIdentity,
      setVisible(v) {
        if (v === visible) return;
        visible = v;
        for (const cb of visSubs) cb(v);
      },
      firePageHide() {
        for (const cb of hideSubs) cb();
      },
      kvStore,
      reported: () => [...errors.drain()],
      scheduled: () => [...scheduledIds],
      completed: () => [...completed],
      loadedCount: () => loaded,
      analytics: () => [...events],
      previousTokenConsumed: () => prevConsumed,
    },
  };
}
