import { describe, expect, it } from 'vitest';
import type { ProviderPathologies as TestkitPathologies } from '@foundation/testkit';
import { FakeClock } from '@foundation/testkit';
import type { ProviderPathologies } from '../../src/providers/mock.ts';

// The mock's pathology knobs mirror the testkit's exactly (both directions assignable).
const _toTestkit: TestkitPathologies = {} as Required<ProviderPathologies>;
const _fromTestkit: Required<ProviderPathologies> = {} as Required<TestkitPathologies>;
void _toTestkit;
void _fromTestkit;
import {
  platformConformance,
  type ConformanceExpectations,
} from '../../src/providers/conformance.ts';
import { createMockPlatform, mintMockReceipt, mintMockToken } from '../../src/providers/mock.ts';
import { createStandalonePlatform } from '../../src/providers/standalone.ts';
import { createJestPlatform, type JestSdkLike } from '../../src/providers/jest.ts';
import { createStorage } from '../../src/storage/tiers.ts';
import { createFakeTimers } from '../helpers/fixtures.ts';

/** Every single-knob pathology plus a few combinations (§3 "mock provider pathologies"). */
const PATHOLOGY_SETS: Array<[string, ProviderPathologies]> = [
  ['none', {}],
  ['identityNeverReady', { identityNeverReady: true }],
  ['identityDelayMs', { identityDelayMs: 50 }],
  ['noToken', { noToken: true }],
  ['identitySwitchAfterMs', { identitySwitchAfterMs: { ms: 20, playerId: 'acct-9' } }],
  ['paymentsCancel', { paymentsCancel: true }],
  ['paymentsUnsignedSuccess', { paymentsUnsignedSuccess: true }],
  ['paymentsThrow', { paymentsThrow: true }],
  ['incompletePurchases', { incompletePurchases: 2 }],
  ['kvWriteFails', { kvWriteFails: true }],
  ['kvBreakGlassValue', { kvBreakGlassValue: 'fixed' }],
  ['kvBreakGlassValue null', { kvBreakGlassValue: null }],
  ['notificationsIneligible', { notificationsIneligible: true }],
  ['storageBlocked', { storageBlocked: true }],
  ['storageQuotaExceeded', { storageQuotaExceeded: true }],
  [
    'combo: delay + noToken + cancel + ineligible',
    { identityDelayMs: 10, noToken: true, paymentsCancel: true, notificationsIneligible: true },
  ],
  [
    'combo: switch + incomplete + kvWriteFails + blocked',
    {
      identitySwitchAfterMs: { ms: 5, playerId: 'acct-7' },
      incompletePurchases: 1,
      kvWriteFails: true,
      storageBlocked: true,
    },
  ],
];

function expectationsFor(p: ProviderPathologies): ConformanceExpectations {
  return {
    identityReady: p.identityNeverReady ? 'never' : 'resolves',
    hasToken: !p.noToken,
    identitySwitch: undefined,
    purchase: p.paymentsThrow
      ? 'error'
      : p.paymentsCancel
        ? 'cancel'
        : p.paymentsUnsignedSuccess
          ? 'unsigned'
          : 'success',
    incompletePurchases: p.incompletePurchases ?? 0,
    kvWriteFails: !!p.kvWriteFails,
    kvBreakGlass: p.kvBreakGlassValue !== undefined ? p.kvBreakGlassValue : 'echo',
    notificationsEligible: !p.notificationsIneligible,
  };
}

describe('provider conformance — mock under every pathology', () => {
  for (const [name, pathologies] of PATHOLOGY_SETS) {
    describe(`mock[${name}]`, () => {
      const clock = new FakeClock(1_000);
      const timers = createFakeTimers(clock);
      // identitySwitchAfterMs is auto-triggered by the mock; the manual switch case uses controls
      const auto = pathologies.identitySwitchAfterMs;
      const manual: ProviderPathologies = { ...pathologies };
      delete manual.identitySwitchAfterMs;
      const platform = createMockPlatform(auto ? manual : pathologies, {
        gameId: 'game',
        playerId: 'guest-1',
        now: clock.now,
        timers,
      });
      const exp = expectationsFor(pathologies);
      if (auto)
        exp.identitySwitch = {
          to: auto.playerId,
          trigger: () => platform.controls.switchIdentity(auto.playerId, true),
        };
      const cases = platformConformance(platform, exp, {
        wait: (ms) => timers.advance(ms),
        readyBudgetMs: 200,
      });
      for (const c of cases) it(c.name, async () => expect(await c.run()).toBe(true));
      it('storage pathologies drive the tier: blocked → memory, quota → degraded local', () => {
        const tier = createStorage({ localStorage: platform.controls.localStorage });
        if (pathologies.storageBlocked) expect(tier.mode).toBe('memory');
        else if (pathologies.storageQuotaExceeded) {
          expect(tier.mode).toBe('local');
          const r = tier.set('k', 'v');
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.reason).toBe('quota');
        } else expect(tier.set('k', 'v').ok).toBe(true);
      });
    });
  }
  it('auto identity switch fires after N ms with a one-use previous token', async () => {
    const clock = new FakeClock(0);
    const timers = createFakeTimers(clock);
    const p = createMockPlatform(
      { identitySwitchAfterMs: { ms: 100, playerId: 'acct-1' } },
      { gameId: 'g', playerId: 'guest', now: clock.now, timers },
    );
    await p.identity.ready();
    const seen: string[] = [];
    p.identity.onIdentityChanged((prev, next) => seen.push(`${prev?.playerId}->${next.playerId}`));
    await timers.advance(150);
    expect(seen).toEqual(['guest->acct-1']);
    expect(p.identity.previousToken()?.token).toBe(mintMockToken('guest', 100));
    expect(p.identity.previousToken()).toBeNull();
    expect(p.identity.tokenFor('acct-1')).toBe(mintMockToken('acct-1', 150, true));
  });
  it('mock tokens and receipts have the jest-verify mock shapes', () => {
    expect(mintMockToken('p', 5)).toBe('mock.p.5');
    expect(mintMockToken('p', 5, true)).toBe('mock.p.5.registered');
    const r = mintMockReceipt({
      aud: 'g',
      sub: 'p',
      purchase: { purchaseToken: 't', productSku: 's', createdAt: 1, completedAt: 2 },
    });
    expect(r.startsWith('mockreceipt.')).toBe(true);
    const json = JSON.parse(
      atob(r.slice('mockreceipt.'.length).replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(json.purchase.purchaseToken).toBe('t');
  });
});

describe('provider conformance — standalone', () => {
  const platform = createStandalonePlatform({
    playerId: 'qa_1',
    token: 'mock.qa_1.0',
    registered: true,
    share: null,
  });
  const cases = platformConformance(
    platform,
    {
      identityReady: 'resolves',
      hasToken: true,
      identitySwitch: undefined,
      purchase: 'unsupported',
      incompletePurchases: 0,
      kvWriteFails: false,
      kvBreakGlass: 'echo',
      notificationsEligible: false,
    },
    { wait: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) },
  );
  for (const c of cases) it(c.name, async () => expect(await c.run()).toBe(true));
  it('previous token (rehearsal) is one-use; markLoaded once', () => {
    let loaded = 0;
    const p = createStandalonePlatform({
      playerId: 'a',
      token: 't',
      previous: { playerId: 'g', token: 'tg' },
      markLoaded: () => loaded++,
      share: null,
    });
    expect(p.identity.previousToken()).toEqual({ playerId: 'g', token: 'tg' });
    expect(p.identity.previousToken()).toBeNull();
    p.loading.markLoaded();
    p.loading.markLoaded();
    expect(loaded).toBe(1);
  });
});

describe('jest platform — defensive SDK wrapper', () => {
  it('login re-reads registration and credential while preserving the stable player id', async () => {
    let registered = false;
    let credential = 'guest-jws';
    const sdk = {
      init: async () => {},
      getPlayer: () => ({ playerId: 'stable-1', registered }),
      getPlayerSigned: async () => ({
        player: { playerId: 'stable-1', registered },
        playerSigned: credential,
      }),
      login: async () => {
        registered = true;
        credential = 'registered-jws';
      },
      data: { set: () => {}, delete: () => {}, flush: async () => {}, get: async () => null },
      lifecycle: {
        onHide: () => () => {},
        onShow: () => () => {},
        onExitRequested: () => () => {},
      },
      getEntryPayload: () => ({}),
      captureEvent: () => {},
      markFirstMilestone: () => {},
      setLoadingProgress: () => {},
      markGameLoaded: () => {},
      notifications: {
        scheduleNotification: async () => {},
        unscheduleNotification: async () => {},
      },
      payments: {
        getProducts: async () => [],
        beginPurchase: async () => ({ result: 'cancel' as const }),
        completePurchase: async () => ({ result: 'success' as const }),
        getIncompletePurchases: async () => ({
          purchases: [],
          purchasesSigned: 'empty-page',
          hasMore: false,
        }),
      },
    } as unknown as JestSdkLike;
    const platform = createJestPlatform({ sdk });
    await platform.identity.ready();
    const transitions: unknown[] = [];
    platform.identity.onIdentityChanged((before, after) => transitions.push([before, after]));

    await platform.identity.login({ source: 'test' });

    expect(platform.identity.getPlayer()).toEqual({ playerId: 'stable-1', registered: true });
    expect(platform.identity.tokenFor('stable-1')).toBe('registered-jws');
    expect(platform.identity.previousToken()).toBeNull();
    expect(transitions).toEqual([
      [
        { playerId: 'stable-1', registered: false },
        { playerId: 'stable-1', registered: true },
      ],
    ]);
  });

  it('mock login upgrades a guest in place', async () => {
    const platform = createMockPlatform({}, { gameId: 'game', playerId: 'guest-stable' });
    await platform.identity.ready();
    const seen: string[] = [];
    platform.identity.onIdentityChanged((before, after) =>
      seen.push(`${before?.playerId}:${before?.registered}->${after.playerId}:${after.registered}`),
    );
    await platform.identity.login();
    expect(platform.identity.getPlayer()).toEqual({
      playerId: 'guest-stable',
      registered: true,
    });
    expect(seen).toEqual(['guest-stable:false->guest-stable:true']);
  });

  it('uses the documented player-signed object after init and refreshes the generic credential', async () => {
    const calls: string[] = [];
    const sdk = {
      init: async (options: { autoLoginReminders?: boolean }) => {
        calls.push(`init:${options.autoLoginReminders}`);
      },
      getPlayerSigned: async () => {
        calls.push('getPlayerSigned');
        return {
          player: { playerId: 'p1', registered: false },
          playerSigned: 'jws.p1',
        };
      },
      getPlayer: () => {
        calls.push('getPlayer');
        return { playerId: 'p1', registered: false };
      },
      login: async () => {
        calls.push('login');
      },
      data: { set: () => {}, delete: () => {}, flush: async () => {}, get: async () => null },
      lifecycle: {
        onHide: () => () => {},
        onShow: () => () => {},
        onExitRequested: () => () => {},
      },
      getEntryPayload: () => ({}),
      captureEvent: () => {},
      markFirstMilestone: () => {},
      setLoadingProgress: () => {},
      markGameLoaded: () => {},
      notifications: {
        scheduleNotification: async () => {},
        unscheduleNotification: async () => {},
      },
      payments: {
        getProducts: async () => [],
        beginPurchase: async () => ({ result: 'cancel' as const }),
        completePurchase: async () => ({ result: 'success' as const }),
        getIncompletePurchases: async () => ({ purchases: [], hasMore: false }),
      },
    } as unknown as JestSdkLike;
    const p = createJestPlatform({ sdk, autoLoginReminders: false });

    await p.identity.ready();
    expect(calls.slice(0, 3)).toEqual(['init:false', 'getPlayer', 'getPlayerSigned']);
    expect(p.identity.tokenFor('p1')).toBe('jws.p1');
    await (p.identity as unknown as { login(): Promise<void> }).login();
    expect(calls).toContain('login');
    expect(
      await (
        p.identity as unknown as { refreshCredential(): Promise<string | null> }
      ).refreshCredential(),
    ).toBe('jws.p1');
  });

  it('fails visibly with a typed platform incompatibility when required SDK methods are absent', async () => {
    const reported: { kind: string; message?: string }[] = [];
    const p = createJestPlatform({
      sdk: { init: async () => {} },
      errors: { report: (event) => reported.push(event) },
    });

    await expect(p.identity.ready()).rejects.toMatchObject({ name: 'PlatformIncompatibleError' });
    expect(reported).toContainEqual(
      expect.objectContaining({
        kind: 'platform_incompatible',
        message: expect.stringContaining('getPlayer'),
      }),
    );
  });

  it('fails visibly when the documented signed-player object is malformed', async () => {
    const reported: { kind: string; message?: string }[] = [];
    const sdk = {
      init: async () => {},
      getPlayer: () => ({ playerId: 'p1', registered: false }),
      getPlayerSigned: async () => ({
        player: { playerId: 'p1', registered: false },
        // The real contract requires playerSigned; aliases such as token/signed are not accepted.
        signed: 'stale-alias',
      }),
      login: async () => {},
      data: { set: () => {}, delete: () => {}, flush: async () => {}, get: () => undefined },
      lifecycle: {
        onHide: () => () => {},
        onShow: () => () => {},
        onExitRequested: () => () => {},
      },
      getEntryPayload: () => ({}),
      captureEvent: () => {},
      markFirstMilestone: () => {},
      setLoadingProgress: () => {},
      markGameLoaded: () => {},
      notifications: { scheduleNotification: () => {}, unscheduleNotification: () => {} },
      payments: {
        getProducts: async () => [],
        beginPurchase: async () => ({ result: 'cancel' as const }),
        completePurchase: async () => ({ result: 'success' as const }),
        getIncompletePurchases: async () => ({
          purchases: [],
          purchasesSigned: 'empty-page',
          hasMore: false,
        }),
      },
    } as unknown as JestSdkLike;
    const platform = createJestPlatform({
      sdk,
      errors: { report: (event) => reported.push(event) },
    });

    await expect(platform.identity.ready()).rejects.toMatchObject({
      name: 'PlatformIncompatibleError',
      missing: ['getPlayerSigned() result'],
    });
    expect(reported).toContainEqual(
      expect.objectContaining({
        kind: 'platform_incompatible',
        message: expect.stringContaining('getPlayerSigned() result'),
      }),
    );
  });

  it('turns a hanging init into a visible incompatibility without calling another SDK method', async () => {
    const clock = new FakeClock(0);
    const timers = createFakeTimers(clock);
    const calls: string[] = [];
    const sdk = {
      init: () => {
        calls.push('init');
        return new Promise<void>(() => {});
      },
      getPlayer: () => {
        calls.push('getPlayer');
        return { playerId: 'p1', registered: false };
      },
      getPlayerSigned: async () => ({
        player: { playerId: 'p1', registered: false },
        playerSigned: 'jws',
      }),
      login: async () => {},
      data: { set: () => {}, delete: () => {}, flush: async () => {}, get: () => undefined },
      lifecycle: {
        onHide: () => () => {},
        onShow: () => () => {},
        onExitRequested: () => () => {},
      },
      getEntryPayload: () => ({}),
      captureEvent: () => {},
      markFirstMilestone: () => {},
      setLoadingProgress: () => {},
      markGameLoaded: () => {},
      notifications: { scheduleNotification: () => {}, unscheduleNotification: () => {} },
      payments: {
        getProducts: async () => [],
        beginPurchase: async () => ({ result: 'cancel' as const }),
        completePurchase: async () => ({ result: 'success' as const }),
        getIncompletePurchases: async () => ({
          purchases: [],
          purchasesSigned: 'empty-page',
          hasMore: false,
        }),
      },
    } as unknown as JestSdkLike;
    const platform = createJestPlatform({ sdk, timers, initTimeoutMs: 100, now: clock.now });
    const ready = platform.identity.ready();
    const rejected = expect(ready).rejects.toMatchObject({
      name: 'PlatformIncompatibleError',
      missing: ['init() timeout'],
    });

    await timers.advance(100);

    await rejected;
    expect(calls).toEqual(['init']);
  });

  it('maps documented data, lifecycle, entry, analytics, loading, notifications, and payment shapes', async () => {
    const calls: unknown[] = [];
    const unsubs: Array<() => void> = [];
    const sdk = {
      init: async () => {},
      getPlayer: () => ({ playerId: 'p1', registered: true }),
      getPlayerSigned: async () => ({
        player: { playerId: 'p1', registered: true },
        playerSigned: 'jws.p1',
      }),
      login: async () => {},
      data: {
        set: (key: string, value: string) => calls.push(['set', key, value]),
        delete: (key: string) => calls.push(['delete', key]),
        flush: async () => calls.push(['flush']),
        get: async (key: string) => (calls.push(['get', key]), 'value'),
      },
      lifecycle: {
        onHide: (cb: () => void) => (
          calls.push(['onHide']),
          unsubs.push(cb),
          () => calls.push(['offHide'])
        ),
        onShow: (cb: () => void) => (
          calls.push(['onShow']),
          unsubs.push(cb),
          () => calls.push(['offShow'])
        ),
        onExitRequested: (cb: () => void) => (
          calls.push(['onExitRequested']),
          unsubs.push(cb),
          () => calls.push(['offExit'])
        ),
      },
      getEntryPayload: () => ({ source: 'notification' }),
      captureEvent: (name: string, props?: Record<string, unknown>) =>
        calls.push(['captureEvent', name, props]),
      markFirstMilestone: () => calls.push(['markFirstMilestone']),
      setLoadingProgress: (progress: number) => calls.push(['progress', progress]),
      markGameLoaded: () => calls.push(['markGameLoaded']),
      notifications: {
        scheduleNotification: async (item: unknown) => calls.push(['scheduleNotification', item]),
        unscheduleNotification: async (item: unknown) =>
          calls.push(['unscheduleNotification', item]),
      },
      payments: {
        getProducts: async () => [{ sku: 's', name: 'Starter', price: 1, currency: 'USD' }],
        beginPurchase: async (arg: unknown) =>
          arg && typeof arg === 'object' && (arg as { productSku?: string }).productSku === 's'
            ? {
                result: 'success' as const,
                purchase: { purchaseToken: 'tok', productSku: 's' },
                purchaseSigned: 'signed',
              }
            : { result: 'error' as const, error: 'invalid_product' },
        completePurchase: async (arg: unknown) =>
          (arg as { purchaseToken?: string }).purchaseToken === 'tok'
            ? { result: 'success' as const }
            : { result: 'error' as const, error: 'invalid_token' as const },
        getIncompletePurchases: async () => ({ purchases: [], hasMore: false }),
      },
    } as unknown as JestSdkLike;
    const p = createJestPlatform({ sdk });
    await p.identity.ready();

    p.kv.set('k', 'v');
    p.kv.delete('k');
    await p.kv.flush();
    expect(await p.kv.readBreakGlass('k')).toBe('value');
    expect((p as unknown as { entryPayload(): Record<string, unknown> }).entryPayload()).toEqual({
      source: 'notification',
    });
    p.analytics.track('played', { level: 1 });
    (p.analytics as unknown as { markFirstMilestone(): void }).markFirstMilestone();
    p.loading.progress(0.126);
    p.loading.markLoaded();
    p.loading.markLoaded();
    const lifecycle = p.lifecycle as unknown as {
      onHide(cb: () => void): () => void;
      onShow(cb: () => void): () => void;
      onExitRequested(cb: () => void): () => void;
    };
    const offHide = lifecycle.onHide(() => {});
    const offShow = lifecycle.onShow(() => {});
    const offExit = lifecycle.onExitRequested(() => {});
    expect(p.lifecycle.visible()).toBe(true);
    unsubs[0]!();
    expect(p.lifecycle.visible()).toBe(false);
    unsubs[1]!();
    expect(p.lifecycle.visible()).toBe(true);
    offHide();
    offShow();
    offExit();
    await p.notifications.scheduleLadder([
      { id: 'return-1', title: 'Return', body: 'Your game is waiting', delaySec: 86_400 },
    ]);
    await p.notifications.unschedule('return-1');
    expect(await p.payments.begin('s')).toEqual({
      kind: 'success',
      purchaseToken: 'tok',
      purchaseSigned: 'signed',
    });
    expect(await p.payments.complete('tok')).toEqual({ kind: 'success' });
    expect(await p.payments.complete('bad')).toEqual({
      kind: 'invalid_token',
      message: 'invalid_token',
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['set', 'k', 'v'],
        ['delete', 'k'],
        ['flush'],
        ['get', 'k'],
        ['captureEvent', 'played', { level: 1 }],
        ['markFirstMilestone'],
        ['progress', 13],
        ['markGameLoaded'],
        ['onHide'],
        ['onShow'],
        ['onExitRequested'],
        ['offHide'],
        ['offShow'],
        ['offExit'],
        [
          'scheduleNotification',
          expect.objectContaining({ identifier: 'return-1', scheduledInDays: 1 }),
        ],
        ['unscheduleNotification', { identifier: 'return-1' }],
      ]),
    );
  });

  it('recovers pages through signed batches and completes only tokens the batch verifier made durable', async () => {
    const completions: string[] = [];
    let page = 0;
    const sdk = {
      init: async () => {},
      getPlayer: () => ({ playerId: 'p', registered: true }),
      getPlayerSigned: async () => ({
        player: { playerId: 'p', registered: true },
        playerSigned: 'jws',
      }),
      login: async () => {},
      data: { set: () => {}, delete: () => {}, flush: async () => {}, get: async () => null },
      lifecycle: {
        onHide: () => () => {},
        onShow: () => () => {},
        onExitRequested: () => () => {},
      },
      getEntryPayload: () => ({}),
      captureEvent: () => {},
      markFirstMilestone: () => {},
      setLoadingProgress: () => {},
      markGameLoaded: () => {},
      notifications: {
        scheduleNotification: async () => {},
        unscheduleNotification: async () => {},
      },
      payments: {
        getProducts: async () => [],
        beginPurchase: async () => ({ result: 'cancel' as const }),
        completePurchase: async ({ purchaseToken }: { purchaseToken: string }) => (
          completions.push(purchaseToken),
          { result: 'success' as const }
        ),
        getIncompletePurchases: async () =>
          page++ === 0
            ? {
                purchases: [
                  { purchaseToken: 'a', productSku: 'one' },
                  { purchaseToken: 'b', productSku: 'two' },
                ],
                purchasesSigned: 'batch-1',
                hasMore: true,
              }
            : {
                purchases: [{ purchaseToken: 'c', productSku: 'three' }],
                purchasesSigned: 'batch-2',
                hasMore: false,
              },
      },
    } as unknown as JestSdkLike;
    const p = createJestPlatform({ sdk });
    await p.identity.ready();
    const batches: string[] = [];
    await p.payments.recoverIncompleteBatch(async (batch) => {
      batches.push(batch.purchasesSigned);
      return batch.purchasesSigned === 'batch-1' ? ['a'] : ['c'];
    });
    expect(batches).toEqual(['batch-1', 'batch-2']);
    expect(completions).toEqual(['a', 'c']);
  });
});
