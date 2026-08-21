import { describe, expect, it, vi } from 'vitest';
import type {
  ApiResult,
  PaymentsProvider,
  PurchaseCompletionOutcome,
  PurchaseRecoveryReport,
  RecoveryBatch,
} from '@foundation/client';
import type {
  ConfigResponse,
  PurchaseVerifyResult,
  PurchasesMineResponse,
} from '@foundation/contracts';
import {
  canBeginCheckout,
  isCheckoutReadyNow,
  type DirectPurchaseApi,
  type RecoveryPurchaseApi,
  recoverPurchasesOnStartup,
  verifyAndCompletePurchase,
} from '../../src/purchases.ts';
import { formatProductPrice } from '../../src/ui/Shop.tsx';

const purchase = {
  id: 1,
  sku: 'gems_100',
  packKey: 'handful',
  classification: 'paid' as const,
  granted: 100,
  grantKey: 'purchase:tok-1',
  price: 0.99,
  currency: 'USD',
  sandbox: false,
  createdAt: 1,
  completedAt: null,
  recordedAt: 2,
};

describe('template purchase coordination', () => {
  it('keeps checkout fail-closed until server readiness and live config are known', () => {
    const ready = { checkoutEnabled: true, purchasesDisabled: false };
    expect(canBeginCheckout(null, true, false)).toBe(false);
    expect(canBeginCheckout(ready, false, false)).toBe(false);
    expect(canBeginCheckout({ ...ready, checkoutEnabled: false }, true, false)).toBe(false);
    expect(canBeginCheckout({ ...ready, purchasesDisabled: true }, true, false)).toBe(false);
    expect(canBeginCheckout(ready, true, true)).toBe(false);
    expect(canBeginCheckout(ready, true, false)).toBe(true);
  });

  it('revalidates server and live readiness immediately before opening checkout', async () => {
    let mineResult: ApiResult<PurchasesMineResponse> = {
      ok: true as const,
      status: 200,
      body: {
        purchases: [],
        pendingAdjustments: [],
        entitlement: 0,
        purchasesDisabled: false,
        checkoutEnabled: true,
        serverNow: 1,
        requestId: 'mine',
      },
    };
    const mine = vi.fn(async (): Promise<ApiResult<PurchasesMineResponse>> => mineResult);
    const configBody: ConfigResponse = {
      gameId: 'template',
      env: 'lab' as const,
      contractVersion: '1',
      minBuildVersion: '1.0.0',
      maintenance: false,
      killSwitches: { skus: [], commands: [] },
      contentVersions: [],
      schedules: [],
      serverNow: 1,
      requestId: 'config',
    };
    let configResult: ApiResult<ConfigResponse> = {
      ok: true,
      status: 200,
      body: configBody,
    };
    const config = vi.fn(async (): Promise<ApiResult<ConfigResponse>> => configResult);
    const api = { purchases: { mine }, liveops: { config } };

    await expect(isCheckoutReadyNow(api, 'gems_100', '1.0.0')).resolves.toBe(true);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledWith(true);

    configResult = {
      ok: false,
      status: 0,
      error: null,
      networkError: 'offline',
    };
    await expect(isCheckoutReadyNow(api, 'gems_100', '1.0.0')).resolves.toBe(false);

    configResult = { ok: true, status: 200, body: configBody };
    mineResult = {
      ok: false,
      status: 503,
      error: null,
    };
    await expect(isCheckoutReadyNow(api, 'gems_100', '1.0.0')).resolves.toBe(false);
  });

  it('refuses checkout preflight for maintenance, build, command, and SKU controls', async () => {
    const mine = async () => ({
      ok: true as const,
      status: 200,
      body: {
        purchases: [],
        pendingAdjustments: [],
        entitlement: 0,
        purchasesDisabled: false,
        checkoutEnabled: true,
        serverNow: 1,
        requestId: 'mine',
      },
    });
    const base = {
      gameId: 'template',
      env: 'lab' as const,
      contractVersion: '1',
      minBuildVersion: '1.0.0',
      maintenance: false,
      killSwitches: { skus: [] as string[], commands: [] as string[] },
      contentVersions: [],
      schedules: [],
      serverNow: 1,
      requestId: 'config',
    };
    const readiness = (body: typeof base) =>
      isCheckoutReadyNow(
        {
          purchases: { mine },
          liveops: { config: async () => ({ ok: true as const, status: 200, body }) },
        },
        'gems_100',
        '1.0.0',
      );

    await expect(readiness({ ...base, maintenance: true })).resolves.toBe(false);
    await expect(readiness({ ...base, minBuildVersion: '2.0.0' })).resolves.toBe(false);
    await expect(
      readiness({
        ...base,
        killSwitches: { skus: [], commands: ['purchases.verify'] },
      }),
    ).resolves.toBe(false);
    await expect(
      readiness({ ...base, killSwitches: { skus: ['gems_100'], commands: [] } }),
    ).resolves.toBe(false);
  });

  it('formats only provider-supplied price and ISO currency', () => {
    expect(formatProductPrice({ sku: 's', title: 'Pack', price: 9.99, currency: 'USD' })).toMatch(
      /9\.99/,
    );
    expect(formatProductPrice({ sku: 's', title: 'Pack', price: 9.99 })).toBeNull();
    expect(
      formatProductPrice({ sku: 's', title: 'Pack', price: Number.NaN, currency: 'USD' }),
    ).toBeNull();
  });

  it('completes only when the server marks the durable record ready', async () => {
    const complete = vi.fn(async (): Promise<PurchaseCompletionOutcome> => ({ kind: 'success' }));
    const api = directApi({
      purchaseToken: 'tok-1',
      outcome: 'recorded',
      purchase,
      completion: 'withhold',
    });

    await expect(
      verifyAndCompletePurchase(api, paymentProvider({ complete }), {
        commandId: 'command-1',
        purchaseToken: 'tok-1',
        purchaseSigned: 'signed-1',
      }),
    ).resolves.toMatchObject({ kind: 'withheld', purchase });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'success' } as const, 'completed'],
    [{ kind: 'retryable_error', message: 'internal_error' } as const, 'pending_completion'],
    [{ kind: 'invalid_token', message: 'invalid_token' } as const, 'terminal_completion_error'],
  ])('preserves the provider completion outcome %j', async (completion, expected) => {
    const complete = vi.fn(async () => completion);
    const api = directApi({
      purchaseToken: 'tok-1',
      outcome: 'recorded',
      purchase,
      completion: 'ready',
    });

    await expect(
      verifyAndCompletePurchase(api, paymentProvider({ complete }), {
        commandId: 'command-1',
        purchaseToken: 'tok-1',
        purchaseSigned: 'signed-1',
      }),
    ).resolves.toMatchObject({ kind: expected, purchase });
    expect(complete).toHaveBeenCalledWith('tok-1');
  });

  it('never completes an unsigned checkout token that disagrees with the verified receipt', async () => {
    const complete = vi.fn(async (): Promise<PurchaseCompletionOutcome> => ({ kind: 'success' }));
    const api = directApi({
      purchaseToken: 'verified-token',
      outcome: 'recorded',
      purchase,
      completion: 'ready',
    });

    await expect(
      verifyAndCompletePurchase(api, paymentProvider({ complete }), {
        commandId: 'command-1',
        purchaseToken: 'different-unsigned-token',
        purchaseSigned: 'signed-1',
      }),
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'verified provider token did not match checkout',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('submits each signed recovery page once and returns only server-ready tokens for completion', async () => {
    const batch: RecoveryBatch = {
      purchases: [
        { purchaseToken: 'tok-ready', sku: 'gems_100' },
        { purchaseToken: 'tok-held', sku: 'gems_550' },
        { purchaseToken: 'tok-rejected', sku: 'gems_1200' },
      ],
      purchasesSigned: 'signed-page',
      hasMore: false,
    };
    let ready: readonly string[] = [];
    const recoverIncompleteBatch = vi.fn(
      async (
        grant: (page: RecoveryBatch) => Promise<readonly string[]>,
      ): Promise<PurchaseRecoveryReport> => {
        ready = await grant(batch);
        return recoveryReport({ completed: [...ready] });
      },
    );
    const verifyBatch: RecoveryPurchaseApi['verifyBatch'] = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      body: {
        outcome: 'processed' as const,
        results: [
          {
            purchaseToken: 'tok-ready',
            outcome: 'recorded' as const,
            completion: 'ready' as const,
            purchase,
          },
          {
            purchaseToken: 'tok-held',
            outcome: 'duplicate' as const,
            completion: 'withhold' as const,
            purchase: {
              id: 2,
              sku: 'gems_550',
              packKey: 'pouch',
              classification: 'paid' as const,
              granted: 0,
              price: 4.99,
              currency: 'USD',
              sandbox: false,
              createdAt: 1,
              completedAt: null,
              recordedAt: 2,
            },
          },
          {
            purchaseToken: 'tok-rejected',
            outcome: 'rejected' as const,
            reason: 'unsupported',
            completion: 'withhold' as const,
          },
        ],
        serverNow: 1,
        requestId: 'r',
      },
    }));

    const result = await recoverPurchasesOnStartup(
      { verifyBatch },
      paymentProvider({ recoverIncompleteBatch }),
      () => 'command-batch',
    );

    expect(verifyBatch).toHaveBeenCalledWith({
      commandId: 'command-batch',
      purchasesSigned: 'signed-page',
    });
    expect(ready).toEqual(['tok-ready']);
    expect(result).toEqual({
      pagesVerified: 1,
      ready: 1,
      withheld: 1,
      rejected: 1,
      recoveryOutcome: 'drained',
      completed: 1,
      completionRetryable: 0,
      completionInvalid: 0,
      grantKeys: ['purchase:tok-1'],
      errors: [],
    });
  });

  it('leaves a recovery page untouched when server verification fails', async () => {
    let ready: readonly string[] = ['unexpected'];
    const recoverIncompleteBatch = vi.fn(
      async (
        grant: (page: RecoveryBatch) => Promise<readonly string[]>,
      ): Promise<PurchaseRecoveryReport> => {
        ready = await grant({
          purchases: [{ purchaseToken: 'tok', sku: 'gems_100' }],
          purchasesSigned: 'signed-page',
          hasMore: false,
        });
        return recoveryReport();
      },
    );
    const result = await recoverPurchasesOnStartup(
      {
        verifyBatch: async () => ({
          ok: false as const,
          status: 503,
          error: null,
          networkError: 'offline',
        }),
      },
      paymentProvider({ recoverIncompleteBatch }),
      () => 'command-batch',
    );

    expect(ready).toEqual([]);
    expect(result.errors).toEqual(['verify-batch: offline']);
  });

  it('surfaces retryable and terminal provider completion failures', async () => {
    const recoverIncompleteBatch = vi.fn(async (): Promise<PurchaseRecoveryReport> =>
      recoveryReport({
        retryable: [{ purchaseToken: 'retry', message: 'internal_error' }],
        invalid: [{ purchaseToken: 'invalid', message: 'invalid_token' }],
      }),
    );

    const result = await recoverPurchasesOnStartup(
      { verifyBatch: vi.fn() },
      paymentProvider({ recoverIncompleteBatch }),
      () => 'command-batch',
    );

    expect(result).toMatchObject({
      recoveryOutcome: 'drained',
      completed: 0,
      completionRetryable: 1,
      completionInvalid: 1,
      errors: ['completion: 1 retryable', 'completion: 1 invalid'],
    });
  });
});

function directApi(body: Omit<PurchaseVerifyResult, 'serverNow' | 'requestId'>): DirectPurchaseApi {
  return {
    verify: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      body: { ...body, serverNow: 1, requestId: 'r' },
    })),
  };
}

function paymentProvider(overrides: Partial<PaymentsProvider>): PaymentsProvider {
  return {
    products: async () => [],
    begin: async () => ({ kind: 'cancel' }),
    complete: async () => ({ kind: 'success' }),
    recoverIncompleteBatch: async () => recoveryReport(),
    recoverIncomplete: async () => {},
    ...overrides,
  };
}

function recoveryReport(overrides: Partial<PurchaseRecoveryReport> = {}): PurchaseRecoveryReport {
  return {
    outcome: 'drained',
    completed: [],
    retryable: [],
    invalid: [],
    pages: [],
    ...overrides,
  };
}
