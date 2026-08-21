// Provider interfaces (§4.3 Providers, §5.3, Appendix). One implementation each: Jest, mock,
// standalone. Browser-side only — verifiers live in @foundation/jest-verify (node) and are never
// imported here. The PlatformAdapter is the single switch point when the platform changes.
import type { IntegrityEvent } from '@foundation/contracts';

export interface Player {
  playerId: string;
  registered: boolean;
  displayName?: string;
}

/** Appendix: IdentityClient (browser). */
export interface IdentityClient {
  ready(): Promise<void>;
  isReady(): boolean;
  getPlayer(): Player | null;
  /** Opens the platform's registration/sign-in UI, then refreshes the player and credential. */
  login(entryPayload?: Record<string, unknown>): Promise<void>;
  /** Obtains a fresh provider credential for the current player. */
  refreshCredential(): Promise<string | null>;
  /** Signed provider token bound to playerId, or null when none is available (verdict no_token). */
  tokenFor(playerId: string): string | null;
  /** The provider retains the previous identity's token for ONE use (identity switch push, §5.2). */
  previousToken(): { playerId: string; token: string } | null;
  onIdentityChanged(cb: (prev: Player | null, next: Player) => void): () => void;
}

export interface Product {
  sku: string;
  title: string;
  description?: string;
  price?: number;
  currency?: string;
  priceText?: string;
}

export type PurchaseOutcome =
  | { kind: 'success'; purchaseToken: string; purchaseSigned?: string }
  | { kind: 'cancel' }
  | { kind: 'error'; message: string };

/** Preserve the provider's completion verdict: retryable transport/internal errors differ from terminal token failures. */
export type PurchaseCompletionOutcome =
  | { kind: 'success' }
  | { kind: 'retryable_error'; message: string }
  | { kind: 'invalid_token'; message: string };

export interface IncompletePurchase {
  purchaseToken: string;
  sku: string;
  purchaseSigned?: string;
}

/** Called by recoverIncomplete for each incomplete purchase; return true once the server recorded it. */
export type GrantFn = (purchase: IncompletePurchase) => Promise<boolean>;
export type RecoveryBatch = {
  purchases: IncompletePurchase[];
  purchasesSigned: string;
  hasMore: boolean;
};
/** Return only provider tokens durably recorded by the server; only those are completed. */
export type GrantBatchFn = (batch: RecoveryBatch) => Promise<readonly string[]>;

/** Appendix: PaymentsProvider. */
export interface PaymentsProvider {
  products(): Promise<Product[]>;
  begin(sku: string): Promise<PurchaseOutcome>;
  complete(token: string): Promise<PurchaseCompletionOutcome>;
  recoverIncompleteBatch(grant: GrantBatchFn): Promise<void>;
  recoverIncomplete(grant: GrantFn, onSigned?: (jws: string) => void): Promise<void>;
}

/** Appendix: PlatformKV — write-only mirror on the normal path; readBreakGlass only from the human-initiated recover flow. */
export interface PlatformKV {
  set(key: string, value: string): void;
  delete(key: string): void;
  flush(): Promise<void>;
  readBreakGlass(key: string): Promise<string | null>;
}

interface NotificationBase {
  id: string;
  body: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assetReference?: string;
  entryPayload?: Record<string, string>;
  /** Comeback ladder slot (≥ 3 variants per slot, §11). */
  slot?: string;
}

/** Current Jest notification shape, plus one isolated legacy branch for older game adapters. */
export type LadderItem =
  | (NotificationBase & {
      title?: string;
      ctaText: string;
      scheduledAt: Date;
      scheduledInDays?: never;
      delaySec?: never;
    })
  | (NotificationBase & {
      title?: string;
      ctaText: string;
      scheduledAt?: never;
      scheduledInDays: number;
      delaySec?: never;
    })
  | (NotificationBase & {
      title: string;
      ctaText?: string;
      scheduledAt?: never;
      scheduledInDays?: never;
      /** @deprecated Convert this legacy delay to scheduledInDays at the provider boundary. */
      delaySec: number;
    });

export interface ScheduleResult {
  scheduled: string[];
  failed: { id: string; reason: string }[];
}

/** Appendix: NotificationsProvider. */
export interface NotificationsProvider {
  eligible(): boolean;
  scheduleLadder(items: LadderItem[]): Promise<ScheduleResult>;
  unschedule(id: string): Promise<void>;
}

export interface ShareProvider {
  available(): boolean;
  share(payload: { title?: string; text?: string; url?: string }): Promise<boolean>;
}

export interface AnalyticsProvider {
  track(name: string, props?: Record<string, string | number | boolean>): void;
  markFirstMilestone(): void;
}

export interface LoadingProvider {
  /** Called exactly once by LoadingGate; further calls are no-ops. */
  markLoaded(): void;
  progress(fraction: number): void;
}

export interface LifecycleProvider {
  visible(): boolean;
  onHide(cb: () => void): () => void;
  onShow(cb: () => void): () => void;
  onExitRequested(cb: () => void | Promise<void>): () => void;
  /** Browser-compatible alias for onHide/onShow. */
  onVisibilityChange(cb: (visible: boolean) => void): () => void;
  /** Browser-compatible alias for onExitRequested. */
  onPageHide(cb: () => void): () => void;
}

/** Client errors go through game_error integrity events with breadcrumbs (§8). */
export interface ErrorSink {
  report(event: IntegrityEvent): void;
}

export type PlatformName = 'jest' | 'mock' | 'standalone';

/** §5.3: one browser seam for identity, data, payments, notifications, analytics/loading, lifecycle, entry, and errors. */
export interface PlatformAdapter {
  readonly name: PlatformName;
  identity: IdentityClient;
  kv: PlatformKV;
  payments: PaymentsProvider;
  notifications: NotificationsProvider;
  share: ShareProvider;
  analytics: AnalyticsProvider;
  loading: LoadingProvider;
  lifecycle: LifecycleProvider;
  /** Metadata supplied when the player entered the platform game. */
  entryPayload(): Record<string, unknown>;
  errors: ErrorSink;
}

/** The configured Jest SDK cannot safely satisfy the foundation's required launch contract. */
export class PlatformIncompatibleError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Jest platform incompatible: missing or malformed ${missing.join(', ')}`);
    this.name = 'PlatformIncompatibleError';
    this.missing = missing;
  }
}

/** Lifecycle from a Document (injectable for tests). */
export function documentLifecycle(
  doc:
    Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined = (
    globalThis as { document?: Document }
  ).document,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = (
    globalThis as { window?: Window }
  ).window,
): LifecycleProvider {
  const onHide = (cb: () => void): (() => void) => {
    if (!doc) return () => {};
    const h = (): void => {
      if (doc.visibilityState === 'hidden') cb();
    };
    doc.addEventListener('visibilitychange', h);
    return () => doc.removeEventListener('visibilitychange', h);
  };
  const onShow = (cb: () => void): (() => void) => {
    if (!doc) return () => {};
    const h = (): void => {
      if (doc.visibilityState !== 'hidden') cb();
    };
    doc.addEventListener('visibilitychange', h);
    return () => doc.removeEventListener('visibilitychange', h);
  };
  const onExitRequested = (cb: () => void | Promise<void>): (() => void) => {
    if (!win) return () => {};
    const h = (): void => {
      void cb();
    };
    win.addEventListener('pagehide', h);
    return () => win.removeEventListener('pagehide', h);
  };
  return {
    visible: () => (doc ? doc.visibilityState !== 'hidden' : true),
    onHide,
    onShow,
    onExitRequested,
    onVisibilityChange(cb) {
      if (!doc) return () => {};
      const hideOff = onHide(() => cb(false));
      const showOff = onShow(() => cb(true));
      return () => {
        hideOff();
        showOff();
      };
    },
    onPageHide(cb) {
      if (!win) return () => {};
      return onExitRequested(cb);
    },
  };
}

/** Errors go to the console when the platform has no sink; never thrown. */
export function consoleErrorSink(): ErrorSink {
  return {
    report(event) {
      try {
        console.warn('[foundation] integrity event', event.kind, event.message ?? '');
      } catch {
        /* ignore */
      }
    },
  };
}

/** Sink that buffers events for the telemetry route (≤ 20 per call). */
export function bufferedErrorSink(
  max = 100,
): ErrorSink & { drain(): IntegrityEvent[]; size(): number } {
  const buf: IntegrityEvent[] = [];
  return {
    report(event) {
      if (buf.length >= max) buf.shift();
      buf.push(event);
    },
    drain: () => buf.splice(0, buf.length),
    size: () => buf.length,
  };
}
