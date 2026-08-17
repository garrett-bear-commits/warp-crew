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

export interface IncompletePurchase {
  purchaseToken: string;
  sku: string;
  purchaseSigned?: string;
}

/** Called by recoverIncomplete for each incomplete purchase; return true once the server recorded it. */
export type GrantFn = (purchase: IncompletePurchase) => Promise<boolean>;

/** Appendix: PaymentsProvider. */
export interface PaymentsProvider {
  products(): Promise<Product[]>;
  begin(sku: string): Promise<PurchaseOutcome>;
  complete(token: string): Promise<boolean>;
  recoverIncomplete(grant: GrantFn, onSigned?: (jws: string) => void): Promise<void>;
}

/** Appendix: PlatformKV — write-only mirror on the normal path; readBreakGlass only from the human-initiated recover flow. */
export interface PlatformKV {
  set(key: string, value: string): void;
  delete(key: string): void;
  flush(): Promise<void>;
  readBreakGlass(key: string): Promise<string | null>;
}

export interface LadderItem {
  id: string;
  title: string;
  body: string;
  /** Delay from now in seconds. */
  delaySec: number;
  /** Comeback ladder slot (≥ 3 variants per slot, §11). */
  slot?: string;
}

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
}

export interface LoadingProvider {
  /** Called exactly once by LoadingGate; further calls are no-ops. */
  markLoaded(): void;
  progress(fraction: number): void;
}

export interface LifecycleProvider {
  visible(): boolean;
  onVisibilityChange(cb: (visible: boolean) => void): () => void;
  onPageHide(cb: () => void): () => void;
}

/** Client errors go through game_error integrity events with breadcrumbs (§8). */
export interface ErrorSink {
  report(event: IntegrityEvent): void;
}

export type PlatformName = 'jest' | 'mock' | 'standalone';

/** §5.3: PlatformAdapter = { identity, kv, payments, notifications, share, analytics, loading, lifecycle, errors }. */
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
  errors: ErrorSink;
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
  return {
    visible: () => (doc ? doc.visibilityState !== 'hidden' : true),
    onVisibilityChange(cb) {
      if (!doc) return () => {};
      const h = (): void => cb(doc.visibilityState !== 'hidden');
      doc.addEventListener('visibilitychange', h);
      return () => doc.removeEventListener('visibilitychange', h);
    },
    onPageHide(cb) {
      if (!win) return () => {};
      const h = (): void => cb();
      win.addEventListener('pagehide', h);
      return () => win.removeEventListener('pagehide', h);
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
