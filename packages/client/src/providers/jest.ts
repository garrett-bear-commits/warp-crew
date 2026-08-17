// Jest platform (§5.3 createJestPlatform, ADR-013 provider switch = one implementation). Wraps
// `window.JestSDK` DEFENSIVELY: every call no-ops safely (or degrades to the documented failure
// value) when the SDK or a method is absent, throws, or returns an unexpected shape. The SDK
// surface used here is the minimum the foundation needs: init / getPlayer / getPlayerSigned
// (HS256 token, no exp) / payments (products, beginPurchase → purchaseSigned, completePurchase,
// recoverIncomplete) / kv (set, delete, flush, get for break-glass) / notifications
// (isEligible, scheduleLadder, unschedule) / share / analytics.track / markLoaded.
import type { IntegrityEvent } from '@foundation/contracts';
import {
  consoleErrorSink,
  documentLifecycle,
  type ErrorSink,
  type IdentityClient,
  type IncompletePurchase,
  type LadderItem,
  type PlatformAdapter,
  type Player,
  type Product,
  type PurchaseOutcome,
  type ScheduleResult,
} from './types.ts';

/** The shape we read from the SDK. Every member is optional: presence is checked at call time. */
export interface JestSdkLike {
  init?(): Promise<unknown> | unknown;
  getPlayer?():
    | {
        playerId?: string;
        id?: string;
        registered?: boolean;
        isRegistered?: boolean;
        displayName?: string;
        name?: string;
      }
    | null
    | undefined;
  getPlayerSigned?():
    | Promise<string | { token?: string; signed?: string } | null | undefined>
    | string
    | null
    | undefined;
  onPlayerChanged?(cb: (player: unknown) => void): unknown;
  payments?: {
    getProducts?(): Promise<unknown> | unknown;
    beginPurchase?(sku: string): Promise<unknown> | unknown;
    completePurchase?(token: string): Promise<unknown> | unknown;
    recoverIncomplete?(): Promise<unknown> | unknown;
    purchaseSigned?(token: string): Promise<unknown> | unknown;
  };
  kv?: {
    set?(key: string, value: string): Promise<unknown> | unknown;
    delete?(key: string): Promise<unknown> | unknown;
    flush?(): Promise<unknown> | unknown;
    get?(key: string): Promise<unknown> | unknown;
  };
  notifications?: {
    isEligible?(): boolean | Promise<boolean>;
    scheduleLadder?(items: LadderItem[]): Promise<unknown> | unknown;
    schedule?(item: LadderItem): Promise<unknown> | unknown;
    unschedule?(id: string): Promise<unknown> | unknown;
  };
  share?(payload: { title?: string; text?: string; url?: string }): Promise<unknown> | unknown;
  analytics?: { track?(name: string, props?: Record<string, unknown>): unknown };
  markLoaded?(): unknown;
  setLoadingProgress?(fraction: number): unknown;
  errors?: { report?(e: unknown): unknown };
}

export interface JestPlatformOptions {
  /** Injected SDK (tests); undefined probes window.JestSDK; null = absent SDK. */
  sdk?: JestSdkLike | null;
  /** How long ready() waits for init before proceeding without identity (ms, default 10 s). */
  initTimeoutMs?: number;
  timers?: { set(cb: () => void, ms: number): unknown; clear(h: unknown): void };
  errors?: ErrorSink;
}

const asPromise = async <T>(v: Promise<T> | T): Promise<T> => v;

/** Call an optional SDK method; any throw/rejection becomes `fallback`. */
async function safe<T>(fn: (() => Promise<T> | T) | undefined, fallback: T): Promise<T> {
  if (typeof fn !== 'function') return fallback;
  try {
    return await asPromise(fn());
  } catch {
    return fallback;
  }
}

function toPlayer(raw: unknown): Player | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as {
    playerId?: unknown;
    id?: unknown;
    registered?: unknown;
    isRegistered?: unknown;
    displayName?: unknown;
    name?: unknown;
  };
  const id = typeof p.playerId === 'string' ? p.playerId : typeof p.id === 'string' ? p.id : null;
  if (!id) return null;
  const out: Player = {
    playerId: id,
    registered: p.registered === true || p.isRegistered === true,
  };
  const dn =
    typeof p.displayName === 'string'
      ? p.displayName
      : typeof p.name === 'string'
        ? p.name
        : undefined;
  if (dn) out.displayName = dn;
  return out;
}

function toToken(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as { token?: unknown; signed?: unknown };
    if (typeof o.token === 'string' && o.token) return o.token;
    if (typeof o.signed === 'string' && o.signed) return o.signed;
  }
  return null;
}

export function createJestPlatform(
  opts: JestPlatformOptions = {},
): PlatformAdapter & { refreshToken(): Promise<string | null> } {
  const sdk: JestSdkLike | null =
    opts.sdk === undefined
      ? (((globalThis as { window?: { JestSDK?: JestSdkLike } }).window?.JestSDK as
          JestSdkLike | undefined) ?? null)
      : opts.sdk;
  const timers = opts.timers ?? {
    set: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const errors = opts.errors ?? consoleErrorSink();
  const initTimeoutMs = opts.initTimeoutMs ?? 10_000;

  let ready = false;
  let player: Player | null = null;
  let token: string | null = null;
  let previous: { playerId: string; token: string } | null = null;
  const identitySubs = new Set<(prev: Player | null, next: Player) => void>();

  const refreshToken = async (): Promise<string | null> => {
    if (!sdk) return null;
    const raw = await safe(sdk.getPlayerSigned?.bind(sdk), null as unknown);
    token = toToken(raw);
    return token;
  };

  const readyPromise: Promise<void> = (async () => {
    if (!sdk) {
      ready = true;
      return;
    }
    // bounded init: a hanging SDK must not hang the game forever (identity stays null → no_token)
    await Promise.race([
      safe(sdk.init?.bind(sdk), undefined),
      new Promise<void>((res) => {
        timers.set(res, initTimeoutMs);
      }),
    ]);
    player = toPlayer(await safe(() => sdk.getPlayer?.(), null));
    await refreshToken();
    if (typeof sdk.onPlayerChanged === 'function') {
      try {
        sdk.onPlayerChanged((raw) => {
          const next = toPlayer(raw);
          if (!next) return;
          const before = player;
          if (before && token) previous = { playerId: before.playerId, token };
          player = next;
          void refreshToken().then(() => {
            for (const cb of identitySubs) cb(before, next);
          });
        });
      } catch {
        /* optional */
      }
    }
    ready = true;
  })();

  const identity: IdentityClient = {
    ready: () => readyPromise,
    isReady: () => ready,
    getPlayer: () => player,
    tokenFor: (id) => (player && id === player.playerId ? token : null),
    previousToken() {
      const p = previous;
      previous = null;
      return p;
    },
    onIdentityChanged(cb) {
      identitySubs.add(cb);
      return () => {
        identitySubs.delete(cb);
      };
    },
  };

  const kv = {
    set(key: string, value: string) {
      void safe(() => sdk?.kv?.set?.(key, value), undefined);
    },
    delete(key: string) {
      void safe(() => sdk?.kv?.delete?.(key), undefined);
    },
    async flush() {
      await safe(() => sdk?.kv?.flush?.(), undefined);
    },
    async readBreakGlass(key: string) {
      const v = await safe(() => sdk?.kv?.get?.(key), null as unknown);
      return typeof v === 'string' ? v : null;
    },
  };

  const payments = {
    async products(): Promise<Product[]> {
      const raw = await safe(() => sdk?.payments?.getProducts?.(), null as unknown);
      if (!Array.isArray(raw)) return [];
      const out: Product[] = [];
      for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const p = r as {
          sku?: unknown;
          id?: unknown;
          title?: unknown;
          name?: unknown;
          price?: unknown;
          currency?: unknown;
          priceText?: unknown;
          description?: unknown;
        };
        const sku = typeof p.sku === 'string' ? p.sku : typeof p.id === 'string' ? p.id : null;
        if (!sku) continue;
        const prod: Product = {
          sku,
          title: typeof p.title === 'string' ? p.title : typeof p.name === 'string' ? p.name : sku,
        };
        if (typeof p.price === 'number') prod.price = p.price;
        if (typeof p.currency === 'string') prod.currency = p.currency;
        if (typeof p.priceText === 'string') prod.priceText = p.priceText;
        if (typeof p.description === 'string') prod.description = p.description;
        out.push(prod);
      }
      return out;
    },
    async begin(sku: string): Promise<PurchaseOutcome> {
      if (!sdk?.payments?.beginPurchase) return { kind: 'error', message: 'payments unavailable' };
      let raw: unknown;
      try {
        raw = await asPromise(sdk.payments.beginPurchase(sku));
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      if (!raw || typeof raw !== 'object') return { kind: 'cancel' };
      const r = raw as {
        purchaseToken?: unknown;
        token?: unknown;
        purchaseSigned?: unknown;
        signed?: unknown;
        cancelled?: unknown;
        canceled?: unknown;
        status?: unknown;
      };
      if (
        r.cancelled === true ||
        r.canceled === true ||
        r.status === 'cancelled' ||
        r.status === 'canceled'
      )
        return { kind: 'cancel' };
      const purchaseToken =
        typeof r.purchaseToken === 'string'
          ? r.purchaseToken
          : typeof r.token === 'string'
            ? r.token
            : null;
      if (!purchaseToken) return { kind: 'error', message: 'purchase without a token' };
      let signed =
        typeof r.purchaseSigned === 'string'
          ? r.purchaseSigned
          : typeof r.signed === 'string'
            ? r.signed
            : undefined;
      if (!signed && sdk.payments.purchaseSigned) {
        const s = await safe(() => sdk.payments!.purchaseSigned!(purchaseToken), null as unknown);
        signed = toToken(s) ?? undefined;
      }
      return signed
        ? { kind: 'success', purchaseToken, purchaseSigned: signed }
        : { kind: 'success', purchaseToken };
    },
    async complete(t: string) {
      const r = await safe(() => sdk?.payments?.completePurchase?.(t), false as unknown);
      return r === true || (r !== false && r !== undefined && r !== null);
    },
    async recoverIncomplete(
      grant: (p: IncompletePurchase) => Promise<boolean>,
      onSigned?: (jws: string) => void,
    ) {
      const raw = await safe(() => sdk?.payments?.recoverIncomplete?.(), null as unknown);
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const p = item as {
          purchaseToken?: unknown;
          token?: unknown;
          sku?: unknown;
          productSku?: unknown;
          purchaseSigned?: unknown;
          signed?: unknown;
        };
        const purchaseToken =
          typeof p.purchaseToken === 'string'
            ? p.purchaseToken
            : typeof p.token === 'string'
              ? p.token
              : null;
        if (!purchaseToken) continue;
        const sku =
          typeof p.sku === 'string' ? p.sku : typeof p.productSku === 'string' ? p.productSku : '';
        let signed =
          typeof p.purchaseSigned === 'string'
            ? p.purchaseSigned
            : typeof p.signed === 'string'
              ? p.signed
              : undefined;
        if (!signed && sdk?.payments?.purchaseSigned) {
          const s = await safe(() => sdk.payments!.purchaseSigned!(purchaseToken), null as unknown);
          signed = toToken(s) ?? undefined;
        }
        if (signed) onSigned?.(signed);
        const rec: IncompletePurchase = signed
          ? { purchaseToken, sku, purchaseSigned: signed }
          : { purchaseToken, sku };
        try {
          if (await grant(rec)) await payments.complete(purchaseToken);
        } catch {
          /* leave incomplete for the next attempt */
        }
      }
    },
  };

  let eligibleCache = false;
  void safe(() => sdk?.notifications?.isEligible?.(), false).then((v) => {
    eligibleCache = v === true;
  });
  const notifications = {
    eligible: () => eligibleCache,
    async scheduleLadder(items: LadderItem[]): Promise<ScheduleResult> {
      if (!sdk?.notifications)
        return { scheduled: [], failed: items.map((i) => ({ id: i.id, reason: 'unavailable' })) };
      if (sdk.notifications.scheduleLadder) {
        const raw = await safe(() => sdk.notifications!.scheduleLadder!(items), null as unknown);
        if (
          raw &&
          typeof raw === 'object' &&
          Array.isArray((raw as { scheduled?: unknown }).scheduled)
        ) {
          const r = raw as { scheduled: unknown[]; failed?: unknown[] };
          return {
            scheduled: r.scheduled.filter((x): x is string => typeof x === 'string'),
            failed: Array.isArray(r.failed)
              ? r.failed
                  .filter(
                    (f): f is { id: string; reason?: string } =>
                      !!f &&
                      typeof f === 'object' &&
                      typeof (f as { id?: unknown }).id === 'string',
                  )
                  .map((f) => ({ id: f.id, reason: f.reason ?? 'failed' }))
              : [],
          };
        }
        return raw === null
          ? { scheduled: [], failed: items.map((i) => ({ id: i.id, reason: 'failed' })) }
          : { scheduled: items.map((i) => i.id), failed: [] };
      }
      const scheduled: string[] = [];
      const failed: { id: string; reason: string }[] = [];
      for (const it of items) {
        const ok = await safe(() => sdk.notifications!.schedule?.(it), null as unknown);
        if (ok === null) failed.push({ id: it.id, reason: 'failed' });
        else scheduled.push(it.id);
      }
      return { scheduled, failed };
    },
    async unschedule(id: string) {
      await safe(() => sdk?.notifications?.unschedule?.(id), undefined);
    },
  };

  let loaded = false;
  return {
    name: 'jest',
    identity,
    kv,
    payments,
    notifications,
    share: {
      available: () => typeof sdk?.share === 'function',
      async share(payload) {
        if (typeof sdk?.share !== 'function') return false;
        const r = await safe(() => sdk.share!(payload), false as unknown);
        return r !== false;
      },
    },
    analytics: {
      track(name, props) {
        void safe(() => sdk?.analytics?.track?.(name, props), undefined);
      },
    },
    loading: {
      markLoaded() {
        if (loaded) return;
        loaded = true;
        void safe(() => sdk?.markLoaded?.(), undefined);
      },
      progress(f) {
        void safe(() => sdk?.setLoadingProgress?.(f), undefined);
      },
    },
    lifecycle: documentLifecycle(),
    errors: {
      report(event: IntegrityEvent) {
        errors.report(event);
        void safe(() => sdk?.errors?.report?.(event), undefined);
      },
    },
    refreshToken,
  };
}
