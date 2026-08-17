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
  const clock = new FakeClock(0);
  const timers = createFakeTimers(clock);
  it('absent SDK: every call no-ops safely; ready resolves; no identity', async () => {
    const p = createJestPlatform({ sdk: null, timers });
    await p.identity.ready();
    expect(p.identity.getPlayer()).toBeNull();
    expect(p.identity.tokenFor('x')).toBeNull();
    expect(await p.payments.products()).toEqual([]);
    expect(await p.payments.begin('sku')).toEqual({
      kind: 'error',
      message: 'payments unavailable',
    });
    expect(await p.payments.complete('t')).toBe(false);
    await p.payments.recoverIncomplete(async () => true);
    p.kv.set('k', 'v');
    p.kv.delete('k');
    await p.kv.flush();
    expect(await p.kv.readBreakGlass('k')).toBeNull();
    expect(p.notifications.eligible()).toBe(false);
    expect(
      await p.notifications.scheduleLadder([{ id: 'a', title: 't', body: 'b', delaySec: 1 }]),
    ).toEqual({ scheduled: [], failed: [{ id: 'a', reason: 'unavailable' }] });
    await p.notifications.unschedule('a');
    expect(p.share.available()).toBe(false);
    expect(await p.share.share({ text: 'x' })).toBe(false);
    p.analytics.track('e');
    p.loading.markLoaded();
    p.loading.progress(0.5);
    p.errors.report({ kind: 'game_error', at: 0 });
  });
  it('present SDK: init/getPlayer/getPlayerSigned/payments/kv/notifications are wired; throws are absorbed', async () => {
    const kv = new Map<string, string>();
    let changed: ((p: unknown) => void) | null = null;
    const sdk: JestSdkLike = {
      init: async () => {},
      getPlayer: () => ({ playerId: 'p1', registered: true, displayName: 'P' }),
      getPlayerSigned: async () => 'hs256.token.sig',
      onPlayerChanged: (cb) => {
        changed = cb;
      },
      payments: {
        getProducts: async () => [
          { sku: 'a', title: 'A', price: 1, currency: 'USD' },
          { bogus: true },
        ],
        beginPurchase: async (sku: string) =>
          sku === 'cancel' ? { cancelled: true } : { purchaseToken: 'tok' },
        purchaseSigned: async (t: string) => `signed:${t}`,
        completePurchase: async () => true,
        recoverIncomplete: async () => [{ purchaseToken: 'inc1', sku: 'a' }, { nope: 1 }],
      },
      kv: {
        set: (k: string, v: string) => {
          kv.set(k, v);
        },
        delete: (k: string) => {
          kv.delete(k);
        },
        flush: async () => {},
        get: async (k: string) => kv.get(k) ?? null,
      },
      notifications: {
        isEligible: () => true,
        scheduleLadder: async (items: { id: string }[]) => ({
          scheduled: items.map((i) => i.id),
          failed: [],
        }),
        unschedule: async () => {},
      },
      share: async () => {},
      analytics: {
        track: () => {
          throw new Error('sdk analytics broken');
        },
      },
      markLoaded: () => {},
    };
    const p = createJestPlatform({ sdk, timers });
    await p.identity.ready();
    expect(p.identity.getPlayer()).toEqual({ playerId: 'p1', registered: true, displayName: 'P' });
    expect(p.identity.tokenFor('p1')).toBe('hs256.token.sig');
    expect(await p.payments.products()).toEqual([
      { sku: 'a', title: 'A', price: 1, currency: 'USD' },
    ]);
    expect(await p.payments.begin('a')).toEqual({
      kind: 'success',
      purchaseToken: 'tok',
      purchaseSigned: 'signed:tok',
    });
    expect(await p.payments.begin('cancel')).toEqual({ kind: 'cancel' });
    const granted: string[] = [];
    const signed: string[] = [];
    await p.payments.recoverIncomplete(
      async (x) => {
        granted.push(x.purchaseToken);
        return true;
      },
      (s) => signed.push(s),
    );
    expect(granted).toEqual(['inc1']);
    expect(signed).toEqual(['signed:inc1']);
    p.kv.set('k', 'v');
    await p.kv.flush();
    expect(await p.kv.readBreakGlass('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 0));
    expect(p.notifications.eligible()).toBe(true);
    expect(
      await p.notifications.scheduleLadder([{ id: 'x', title: 't', body: 'b', delaySec: 5 }]),
    ).toEqual({ scheduled: ['x'], failed: [] });
    expect(p.share.available()).toBe(true);
    expect(await p.share.share({ text: 'hi' })).toBe(true);
    p.analytics.track('e'); // SDK throws → absorbed
    // identity switch from the SDK: previous token retained for one use
    const seen: string[] = [];
    p.identity.onIdentityChanged((prev, next) => seen.push(`${prev?.playerId}->${next.playerId}`));
    changed!({ playerId: 'p2', registered: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['p1->p2']);
    expect(p.identity.previousToken()).toEqual({ playerId: 'p1', token: 'hs256.token.sig' });
    expect(p.identity.previousToken()).toBeNull();
  });
  it('a hanging SDK init is bounded by initTimeoutMs', async () => {
    const sdk: JestSdkLike = {
      init: () => new Promise(() => {}),
      getPlayer: () => ({ playerId: 'z' }),
    };
    const p = createJestPlatform({ sdk, timers, initTimeoutMs: 100 });
    let ready = false;
    void p.identity.ready().then(() => {
      ready = true;
    });
    await timers.advance(50);
    expect(ready).toBe(false);
    await timers.advance(100);
    expect(ready).toBe(true);
    expect(p.identity.getPlayer()?.playerId).toBe('z');
  });
});
