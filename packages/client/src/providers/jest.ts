// Minimal Jest HTML5 SDK mirror, reviewed 2026-08-20. Official sources:
// https://docs.jest.com/sdk/html5, https://docs.jest.com/sdk/html5/player,
// https://docs.jest.com/sdk/html5/platform-login, https://docs.jest.com/sdk/html5/app-lifecycle,
// https://docs.jest.com/sdk/html5/notifications, https://docs.jest.com/sdk/html5/payments,
// https://docs.jest.com/sdk/html5/loading-screen, https://docs.jest.com/sdk/html5/analytics,
// https://docs.jest.com/sdk/html5/entry-payload. Review this mirror at least once per quarter and
// before every Jest launch. Signed data is carried to the server; browser code never decides grants.
import type { IntegrityEvent } from '@foundation/contracts';
import { createClock } from '../clock/index.ts';
import {
  consoleErrorSink,
  documentLifecycle,
  PlatformIncompatibleError,
  type ErrorSink,
  type IdentityClient,
  type IncompletePurchase,
  type LadderItem,
  type PlatformAdapter,
  type Player,
  type Product,
  type PurchaseCompletionOutcome,
  type PurchaseOutcome,
  type PurchaseRecoveryFailure,
  type PurchaseRecoveryPageOutcome,
  type PurchaseRecoveryReport,
  type RecoveryBatch,
  type ScheduleResult,
} from './types.ts';

type JP = { playerId: string; registered: boolean };
type JPurchase = {
  purchaseToken: string;
  productSku: string;
  credits: number;
  createdAt: number;
  completedAt: number | null;
  price: number;
  currency: string;
  sandbox?: true;
};
type JNotification = {
  identifier?: string;
  scheduledAt?: Date;
  scheduledInDays?: number | undefined;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assetReference?: string;
  body: string;
  title?: string;
  ctaText: string;
  entryPayload?: Record<string, string>;
};
export interface JestSdkLike {
  init(options?: { autoLoginReminders?: boolean }): Promise<void>;
  getPlayer(): JP;
  getPlayerSigned(): Promise<{ player: JP; playerSigned: string }>;
  login(options?: { entryPayload?: Record<string, unknown> }): Promise<void>;
  data: {
    set(data: Record<string, unknown>): void;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    flush(): Promise<void>;
    get(key: string): unknown;
  };
  lifecycle: {
    onHide(listener: () => void): () => void;
    onShow(listener: () => void): () => void;
    onExitRequested(listener: () => void | Promise<void>): () => void;
  };
  getEntryPayload(): Record<string, unknown>;
  captureEvent(name: string, properties?: Record<string, unknown>): void;
  markFirstMilestone(): void;
  setLoadingProgress(progress: number): void;
  markGameLoaded(): void;
  notifications: {
    scheduleNotification(item: JNotification): void;
    unscheduleNotification(item: { identifier: string }): void;
  };
  payments: {
    getProducts(): Promise<
      Array<{
        sku: string;
        name: string;
        description: string | null;
        price: number;
        currency: string;
      }>
    >;
    beginPurchase(input: {
      productSku: string;
    }): Promise<
      | { result: 'success'; purchase: JPurchase; purchaseSigned: string }
      | { result: 'cancel' }
      | { result: 'error'; error: string }
    >;
    completePurchase(input: {
      purchaseToken: string;
    }): Promise<
      { result: 'success' } | { result: 'error'; error: 'internal_error' | 'invalid_token' }
    >;
    getIncompletePurchases(): Promise<{
      purchases: JPurchase[];
      purchasesSigned: string;
      hasMore: boolean;
    }>;
  };
  share?(payload: { title?: string; text?: string; url?: string }): Promise<void>;
}
export interface JestPlatformOptions {
  sdk?: Partial<JestSdkLike> | null;
  autoLoginReminders?: boolean;
  errors?: ErrorSink;
  initTimeoutMs?: number;
  timers?: { set(cb: () => void, ms: number): unknown; clear(h: unknown): void };
  /** Epoch milliseconds for integrity events; production composition roots should inject Clock.now. */
  now?: () => number;
}

const isPlayer = (x: unknown): x is JP =>
  !!x &&
  typeof x === 'object' &&
  typeof (x as JP).playerId === 'string' &&
  !!(x as JP).playerId &&
  typeof (x as JP).registered === 'boolean';
const toPlayer = (p: JP): Player => ({
  playerId: p.playerId,
  registered: p.registered,
});
const safeOff = (off: unknown): (() => void) => {
  let used = false;
  return () => {
    if (used) return;
    used = true;
    try {
      if (typeof off === 'function') off();
    } catch {
      // SDK unsubscribe is documented idempotent; a broken implementation cannot block teardown.
    }
  };
};
function absent(sdk: Partial<JestSdkLike> | null): string[] {
  // Every method below backs a configured template launch feature and is required in Jest mode.
  // `share` is the sole optional capability in this minimal mirror.
  if (!sdk) return ['JestSDK'];
  const out: string[] = [];
  const f = (x: unknown, n: string) => {
    if (typeof x !== 'function') out.push(n);
  };
  f(sdk.init, 'init');
  f(sdk.getPlayer, 'getPlayer');
  f(sdk.getPlayerSigned, 'getPlayerSigned');
  f(sdk.login, 'login');
  f(sdk.data?.set, 'data.set');
  f(sdk.data?.delete, 'data.delete');
  f(sdk.data?.flush, 'data.flush');
  f(sdk.data?.get, 'data.get');
  f(sdk.lifecycle?.onHide, 'lifecycle.onHide');
  f(sdk.lifecycle?.onShow, 'lifecycle.onShow');
  f(sdk.lifecycle?.onExitRequested, 'lifecycle.onExitRequested');
  f(sdk.getEntryPayload, 'getEntryPayload');
  f(sdk.captureEvent, 'captureEvent');
  f(sdk.markFirstMilestone, 'markFirstMilestone');
  f(sdk.setLoadingProgress, 'setLoadingProgress');
  f(sdk.markGameLoaded, 'markGameLoaded');
  f(sdk.notifications?.scheduleNotification, 'notifications.scheduleNotification');
  f(sdk.notifications?.unscheduleNotification, 'notifications.unscheduleNotification');
  f(sdk.payments?.getProducts, 'payments.getProducts');
  f(sdk.payments?.beginPurchase, 'payments.beginPurchase');
  f(sdk.payments?.completePurchase, 'payments.completePurchase');
  f(sdk.payments?.getIncompletePurchases, 'payments.getIncompletePurchases');
  return out;
}

export function createJestPlatform(options: JestPlatformOptions = {}): PlatformAdapter {
  const sdk =
    options.sdk === undefined
      ? ((globalThis as { window?: { JestSDK?: Partial<JestSdkLike> } }).window?.JestSDK ?? null)
      : options.sdk;
  const errors = options.errors ?? consoleErrorSink();
  const now = options.now ?? createClock().now;
  let ready = false;
  let incompat: PlatformIncompatibleError | null = null;
  let player: Player | null = null;
  let token: string | null = null;
  let previous: { playerId: string; token: string } | null = null;
  const listeners = new Set<(before: Player | null, after: Player) => void>();
  const fail = (missing: readonly string[]): PlatformIncompatibleError => {
    if (!incompat) {
      incompat = new PlatformIncompatibleError(missing);
      errors.report({
        kind: 'platform_incompatible',
        at: now(),
        message: incompat.message,
        detail: { missing: missing.join(',').slice(0, 256) },
      });
    }
    return incompat;
  };
  const report = (message: string): void =>
    errors.report({ kind: 'game_error', at: now(), message });
  const signed = async (id: string): Promise<{ player: Player; credential: string }> => {
    const r = await (sdk!.getPlayerSigned as JestSdkLike['getPlayerSigned'])();
    if (!r || !isPlayer(r.player) || typeof r.playerSigned !== 'string' || !r.playerSigned)
      throw fail(['getPlayerSigned() result']);
    if (r.player.playerId !== id) throw fail(['getPlayerSigned().player.playerId']);
    return { player: toPlayer(r.player), credential: r.playerSigned };
  };
  const reread = async (stable?: string): Promise<void> => {
    const raw = (sdk!.getPlayer as JestSdkLike['getPlayer'])();
    if (!isPlayer(raw)) throw fail(['getPlayer() result']);
    if (stable && raw.playerId !== stable) throw fail(['login stable playerId']);
    const result = await signed(raw.playerId);
    if (result.player.registered !== raw.registered)
      throw fail(['getPlayer()/getPlayerSigned() player']);
    const before = player;
    const oldToken = token;
    player = toPlayer(raw);
    token = result.credential;
    if (
      before &&
      (before.playerId !== player.playerId || before.registered !== player.registered)
    ) {
      if (before.playerId !== player.playerId && oldToken)
        previous = { playerId: before.playerId, token: oldToken };
      for (const l of listeners) l(before, player);
    }
  };
  const boot = (async (): Promise<void> => {
    const first = absent(sdk);
    if (first.length) throw fail(first);
    const timers = options.timers ?? {
      set: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout: { handle?: unknown } = {};
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        timers.clear(timeout.handle);
        fn();
      };
      timeout.handle = timers.set(
        () => finish(() => reject(fail(['init() timeout']))),
        options.initTimeoutMs ?? 10_000,
      );
      void (sdk!.init as JestSdkLike['init'])(
        options.autoLoginReminders === undefined
          ? undefined
          : { autoLoginReminders: options.autoLoginReminders },
      ).then(
        () => finish(resolve),
        () => finish(() => reject(fail(['init()']))),
      );
    });
    const second = absent(sdk);
    if (second.length) throw fail(second);
    await reread();
    ready = true;
  })();
  // Construction starts SDK initialization immediately so the host can begin work before the game
  // client reaches identity.ready(). Mark the shared promise handled now; ready() still returns the
  // original promise and therefore preserves the typed rejection for its caller.
  void boot.catch(() => undefined);
  const identity: IdentityClient = {
    ready: () => boot,
    isReady: () => ready,
    getPlayer: () => player,
    async login(entryPayload) {
      await boot;
      const id = player?.playerId;
      await (sdk!.login as JestSdkLike['login'])(entryPayload ? { entryPayload } : undefined);
      await reread(id);
    },
    async refreshCredential() {
      await boot;
      if (!player) return null;
      const fresh = await signed(player.playerId);
      token = fresh.credential;
      return token;
    },
    tokenFor: (id) => (player?.playerId === id ? token : null),
    previousToken: () => {
      const out = previous;
      previous = null;
      return out;
    },
    onIdentityChanged: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const hook = (
    key: keyof JestSdkLike['lifecycle'],
    cb: () => void | Promise<void>,
  ): (() => void) => {
    let cancelled = false;
    let registeredOff: () => void = () => {};
    const register = (): void => {
      if (cancelled) return;
      try {
        registeredOff = safeOff((sdk!.lifecycle![key] as (c: typeof cb) => () => void)(cb));
      } catch {
        report(`Jest lifecycle ${key} failed`);
      }
    };
    if (ready) register();
    else void boot.then(register, () => undefined);
    return safeOff(() => {
      cancelled = true;
      registeredOff();
    });
  };
  let platformVisible = documentLifecycle().visible();
  const onHide = (cb: () => void): (() => void) =>
    hook('onHide', () => {
      platformVisible = false;
      cb();
    });
  const onShow = (cb: () => void): (() => void) =>
    hook('onShow', () => {
      platformVisible = true;
      cb();
    });
  let loaded = false;
  const complete = async (purchaseToken: string): Promise<PurchaseCompletionOutcome> => {
    try {
      const result = await (
        sdk!.payments!.completePurchase as JestSdkLike['payments']['completePurchase']
      )({ purchaseToken });
      if (result.result === 'success') return { kind: 'success' };
      return result.error === 'invalid_token'
        ? { kind: 'invalid_token', message: result.error }
        : { kind: 'retryable_error', message: result.error };
    } catch (error) {
      return {
        kind: 'retryable_error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const recoverBatch = async (
    grant: (batch: RecoveryBatch) => Promise<readonly string[]>,
  ): Promise<PurchaseRecoveryReport> => {
    const recovery: PurchaseRecoveryReport = {
      outcome: 'page_cap',
      completed: [],
      retryable: [],
      invalid: [],
      pages: [],
    };
    const seen = new Set<string>();
    // A page cursor can overlap without being an exact repeated page. Once a token has a terminal
    // completion verdict, do not complete it again during this recovery traversal. Full signed
    // pages still go to grant and remain in page outcomes so their evidence stays verifiable.
    // Retryable completion failures deliberately remain eligible when the token reappears.
    const terminal = new Set<string>();
    const retryableByToken = new Map<string, PurchaseRecoveryFailure>();
    const invalidByToken = new Map<string, PurchaseRecoveryFailure>();
    const finish = (): PurchaseRecoveryReport => {
      recovery.retryable = [...retryableByToken.values()];
      recovery.invalid = [...invalidByToken.values()];
      return recovery;
    };
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await (
        sdk!.payments!.getIncompletePurchases as JestSdkLike['payments']['getIncompletePurchases']
      )();
      if (
        !page ||
        !Array.isArray(page.purchases) ||
        typeof page.purchasesSigned !== 'string' ||
        !page.purchasesSigned ||
        typeof page.hasMore !== 'boolean'
      )
        throw fail(['payments.getIncompletePurchases() result']);
      const purchasesByToken = new Map<string, IncompletePurchase>();
      for (const p of page.purchases) {
        if (!p || typeof p.purchaseToken !== 'string' || typeof p.productSku !== 'string')
          throw fail(['payments.getIncompletePurchases().purchases']);
        if (!purchasesByToken.has(p.purchaseToken))
          purchasesByToken.set(p.purchaseToken, {
            purchaseToken: p.purchaseToken,
            sku: p.productSku,
          });
      }
      const pagePurchases = [...purchasesByToken.values()];
      const fingerprint = JSON.stringify(
        [...new Set(pagePurchases.map((purchase) => purchase.purchaseToken))].sort(),
      );
      if (seen.has(fingerprint)) {
        report('Jest incomplete purchase page repeated');
        recovery.outcome = 'repeated_page';
        return finish();
      }
      seen.add(fingerprint);
      const purchases = pagePurchases;
      const requested = new Set(
        await grant({ purchases, purchasesSigned: page.purchasesSigned, hasMore: page.hasMore }),
      );
      const pageOutcome: PurchaseRecoveryPageOutcome = {
        page: pageNumber + 1,
        purchaseTokens: purchases.map((purchase) => purchase.purchaseToken),
        hasMore: page.hasMore,
        completed: [],
        retryable: [],
        invalid: [],
      };
      for (const p of purchases)
        if (requested.has(p.purchaseToken) && !terminal.has(p.purchaseToken)) {
          const outcome = await complete(p.purchaseToken);
          if (outcome.kind === 'success') {
            recovery.completed.push(p.purchaseToken);
            pageOutcome.completed.push(p.purchaseToken);
            terminal.add(p.purchaseToken);
            retryableByToken.delete(p.purchaseToken);
          } else {
            const failure = { purchaseToken: p.purchaseToken, message: outcome.message };
            if (outcome.kind === 'retryable_error') {
              pageOutcome.retryable.push(failure);
              retryableByToken.set(p.purchaseToken, failure);
            } else {
              pageOutcome.invalid.push(failure);
              terminal.add(p.purchaseToken);
              retryableByToken.delete(p.purchaseToken);
              invalidByToken.set(p.purchaseToken, failure);
              report('Jest purchase completion returned invalid_token');
            }
          }
        }
      recovery.pages.push(pageOutcome);
      if (!page.hasMore) {
        recovery.outcome = 'drained';
        return finish();
      }
    }
    report('Jest incomplete purchase recovery page cap reached');
    return finish();
  };
  return {
    name: 'jest',
    identity,
    kv: {
      set(k, v) {
        try {
          void (sdk!.data!.set as JestSdkLike['data']['set'])(k, v);
        } catch {
          report('Jest data.set failed');
        }
      },
      delete(k) {
        try {
          void (sdk!.data!.delete as JestSdkLike['data']['delete'])(k);
        } catch {
          report('Jest data.delete failed');
        }
      },
      flush: () => (sdk!.data!.flush as JestSdkLike['data']['flush'])(),
      async readBreakGlass(k) {
        const v = await (sdk!.data!.get as JestSdkLike['data']['get'])(k);
        return typeof v === 'string' ? v : null;
      },
    },
    payments: {
      async products(): Promise<Product[]> {
        const all = await (sdk!.payments!.getProducts as JestSdkLike['payments']['getProducts'])();
        return all
          .filter(
            (p) =>
              !!p &&
              typeof p.sku === 'string' &&
              typeof p.name === 'string' &&
              typeof p.price === 'number' &&
              Number.isFinite(p.price) &&
              p.price >= 0 &&
              typeof p.currency === 'string' &&
              /^[A-Z]{3}$/.test(p.currency),
          )
          .map((p) => ({
            sku: p.sku,
            title: p.name,
            price: p.price,
            currency: p.currency,
            ...(typeof p.description === 'string' ? { description: p.description } : {}),
          }));
      },
      async begin(sku): Promise<PurchaseOutcome> {
        try {
          const r = await (
            sdk!.payments!.beginPurchase as JestSdkLike['payments']['beginPurchase']
          )({ productSku: sku });
          if (r.result === 'cancel') return { kind: 'cancel' };
          if (r.result === 'error') return { kind: 'error', message: r.error };
          return r.purchase?.purchaseToken && r.purchaseSigned
            ? {
                kind: 'success',
                purchaseToken: r.purchase.purchaseToken,
                purchaseSigned: r.purchaseSigned,
              }
            : { kind: 'error', message: 'malformed purchase result' };
        } catch (e) {
          return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
        }
      },
      complete,
      recoverIncompleteBatch: recoverBatch,
      async recoverIncomplete(grant, onSigned) {
        await recoverBatch(async (batch) => {
          onSigned?.(batch.purchasesSigned);
          const readyTokens: string[] = [];
          for (const purchase of batch.purchases)
            if (await grant(purchase)) readyTokens.push(purchase.purchaseToken);
          return readyTokens;
        });
      },
    },
    notifications: {
      eligible: () => player?.registered === true,
      async scheduleLadder(items: LadderItem[]): Promise<ScheduleResult> {
        if (!player?.registered)
          return {
            scheduled: [],
            failed: items.map((x) => ({ id: x.id, reason: 'not_registered' })),
          };
        const scheduled: string[] = [];
        const failed: { id: string; reason: string }[] = [];
        for (const item of items) {
          const days =
            item.scheduledInDays ??
            (typeof item.delaySec === 'number'
              ? Math.max(1, Math.min(7, Math.ceil(item.delaySec / 86400)))
              : undefined);
          if (
            (!item.scheduledAt && days === undefined) ||
            (item.scheduledAt && days !== undefined)
          ) {
            failed.push({ id: item.id, reason: 'invalid_schedule' });
            continue;
          }
          try {
            await (
              sdk!.notifications!
                .scheduleNotification as JestSdkLike['notifications']['scheduleNotification']
            )({
              identifier: item.id,
              ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : { scheduledInDays: days }),
              ...(item.priority ? { priority: item.priority } : {}),
              ...(item.assetReference ? { assetReference: item.assetReference } : {}),
              body: item.body,
              ...(item.title ? { title: item.title } : {}),
              ctaText: item.ctaText ?? 'Play now',
              ...(item.entryPayload ? { entryPayload: item.entryPayload } : {}),
            });
            scheduled.push(item.id);
          } catch {
            failed.push({ id: item.id, reason: 'schedule_failed' });
          }
        }
        return { scheduled, failed };
      },
      async unschedule(id) {
        if (!player?.registered) return;
        try {
          await (
            sdk!.notifications!
              .unscheduleNotification as JestSdkLike['notifications']['unscheduleNotification']
          )({ identifier: id });
        } catch (error) {
          report('Jest unscheduleNotification failed');
          throw error;
        }
      },
    },
    share: {
      available: () => typeof sdk?.share === 'function',
      async share(payload) {
        try {
          if (!sdk?.share) return false;
          await sdk.share(payload);
          return true;
        } catch {
          return false;
        }
      },
    },
    analytics: {
      track(name, props) {
        try {
          (sdk!.captureEvent as JestSdkLike['captureEvent'])(name, props);
        } catch {
          report('Jest captureEvent failed');
        }
      },
      markFirstMilestone() {
        try {
          (sdk!.markFirstMilestone as JestSdkLike['markFirstMilestone'])();
        } catch {
          report('Jest markFirstMilestone failed');
        }
      },
    },
    loading: {
      markLoaded() {
        if (loaded) return;
        loaded = true;
        try {
          (sdk!.markGameLoaded as JestSdkLike['markGameLoaded'])();
        } catch {
          report('Jest markGameLoaded failed');
        }
      },
      progress(value) {
        try {
          (sdk!.setLoadingProgress as JestSdkLike['setLoadingProgress'])(
            Math.round(Math.max(0, Math.min(1, value)) * 100),
          );
        } catch {
          report('Jest setLoadingProgress failed');
        }
      },
    },
    lifecycle: {
      visible: () => platformVisible,
      onHide,
      onShow,
      onExitRequested: (cb) => hook('onExitRequested', cb),
      onVisibilityChange(cb) {
        const h = onHide(() => cb(false)),
          s = onShow(() => cb(true));
        return () => {
          h();
          s();
        };
      },
      onPageHide: (cb) => hook('onExitRequested', cb),
    },
    entryPayload() {
      try {
        const value = (sdk!.getEntryPayload as JestSdkLike['getEntryPayload'])();
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch {
        report('Jest getEntryPayload failed');
        return {};
      }
    },
    errors: { report: (event: IntegrityEvent) => errors.report(event) },
  };
}
