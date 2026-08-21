// LOCAL MOCK EVIDENCE — this is an in-page fixture with the current official Jest HTML5 method
// and payload shapes. It is deliberately not a real Jest SDK or a preview/activation check.
import { expect, test, type Page } from '@playwright/test';
import type { PlatformAdapter, RecoveryBatch } from '@foundation/client';
import { E2E_JEST_GAME_PORT } from './const.ts';

const JEST_GAME = `http://localhost:${E2E_JEST_GAME_PORT}`;

/** Install a local official-shape SDK before the app module can run. */
async function installOfficialShapeFixture(page: Page, stablePlayerId: string): Promise<void> {
  await page.route('https://cdn.jest.com/sdk/latest/jestsdk.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* local official-shape fixture; no real Jest SDK */',
    }),
  );
  await page.addInitScript((playerId) => {
    type Call = { name: string; args: unknown[] };
    type Listener = () => void | Promise<void>;
    type Player = { playerId: string; registered: boolean };

    const calls: Call[] = [];
    const hidden = new Set<Listener>();
    const shown = new Set<Listener>();
    const exiting = new Set<Listener>();
    const data = new Map<string, string>();
    const player: Player = {
      // Jest player ids are stable across launches; the fixture must preserve that invariant so
      // cold-launch behavior can exercise per-player local state.
      playerId,
      registered: true,
    };
    const mockReceipt = (payload: {
      purchase?: Record<string, unknown>;
      purchases?: Array<Record<string, unknown>>;
    }): string => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ aud: 'template', sub: player.playerId, ...payload }),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `mockreceipt.${btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')}`;
    };
    const firstRecoveryPage = [
      {
        purchaseToken: 'recovery-token-1',
        productSku: 'gems_100',
        credits: 100,
        createdAt: 1_724_160_000_000,
        completedAt: null,
        price: 0.99,
        currency: 'USD',
        sandbox: true,
      },
    ];
    const secondRecoveryPage = [
      {
        purchaseToken: 'recovery-token-2',
        productSku: 'gems_550',
        credits: 550,
        createdAt: 1_724_160_000_001,
        completedAt: null,
        price: 4.99,
        currency: 'USD',
        sandbox: true,
      },
    ];
    const incompletePages = [
      {
        purchases: firstRecoveryPage,
        purchasesSigned: mockReceipt({ purchases: firstRecoveryPage }),
        hasMore: true,
      },
      {
        purchases: secondRecoveryPage,
        purchasesSigned: mockReceipt({ purchases: secondRecoveryPage }),
        hasMore: false,
      },
    ];
    let incompletePage = 0;
    let checkoutSeq = 0;
    const record = (name: string, ...args: unknown[]): void => {
      calls.push({ name, args });
    };
    const subscribe = (set: Set<Listener>, name: string, listener: Listener): (() => void) => {
      record(name, listener);
      set.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set.delete(listener);
        record(`${name}.unsubscribe`);
      };
    };
    const invoke = (set: Set<Listener>): void => {
      for (const listener of [...set]) void listener();
    };
    const signed = (): string =>
      `mock.${player.playerId}.${Date.now()}.${player.registered ? 'registered' : ''}`;

    // These are the exact currently documented namespaces/results consumed by createJestPlatform.
    const sdk = {
      init(options?: { autoLoginReminders?: boolean }): Promise<void> {
        record('init', options);
        return Promise.resolve();
      },
      getPlayer(): Player {
        record('getPlayer');
        return { ...player };
      },
      async getPlayerSigned(): Promise<{ player: Player; playerSigned: string }> {
        record('getPlayerSigned');
        return { player: { ...player }, playerSigned: signed() };
      },
      async login(options?: { entryPayload?: Record<string, unknown> }): Promise<void> {
        record('login', options);
        player.registered = true;
      },
      data: {
        set(key: string, value: string): void {
          record('data.set', key, value);
          data.set(key, value);
        },
        delete(key: string): void {
          record('data.delete', key);
          data.delete(key);
        },
        async flush(): Promise<void> {
          record('data.flush');
        },
        get(key: string): string | undefined {
          record('data.get', key);
          return data.get(key);
        },
      },
      lifecycle: {
        onHide(listener: Listener): () => void {
          return subscribe(hidden, 'lifecycle.onHide', listener);
        },
        onShow(listener: Listener): () => void {
          return subscribe(shown, 'lifecycle.onShow', listener);
        },
        onExitRequested(listener: Listener): () => void {
          return subscribe(exiting, 'lifecycle.onExitRequested', listener);
        },
      },
      getEntryPayload(): Record<string, unknown> {
        record('getEntryPayload');
        return {
          source: 'local-official-shape-fixture',
          notification_template: 'template_return_d1_v1',
          notification_offset: 'D1',
        };
      },
      captureEvent(name: string, properties?: Record<string, unknown>): void {
        record('captureEvent', name, properties);
      },
      markFirstMilestone(): void {
        record('markFirstMilestone');
      },
      setLoadingProgress(progress: number): void {
        record('setLoadingProgress', progress);
      },
      markGameLoaded(): void {
        record('markGameLoaded');
      },
      notifications: {
        scheduleNotification(item: Record<string, unknown>): void {
          record('notifications.scheduleNotification', item);
        },
        unscheduleNotification(item: { identifier: string }): void {
          record('notifications.unscheduleNotification', item);
        },
      },
      payments: {
        async getProducts(): Promise<
          Array<{ sku: string; name: string; description: string; price: number; currency: string }>
        > {
          record('payments.getProducts');
          return [
            {
              sku: 'gems_100',
              name: 'Handful of gems',
              description: 'A local official-shape product',
              price: 0.99,
              currency: 'USD',
            },
            {
              sku: 'gems_550',
              name: 'Pouch of gems',
              description: 'A second local official-shape product',
              price: 4.99,
              currency: 'USD',
            },
          ];
        },
        async beginPurchase(input: { productSku: string }): Promise<unknown> {
          record('payments.beginPurchase', input);
          checkoutSeq += 1;
          const purchase = {
            purchaseToken: `official-shape-paid-${checkoutSeq}`,
            productSku: input.productSku,
            credits: 100,
            createdAt: 1_724_160_000_002,
            completedAt: null,
            price: 0.99,
            currency: 'USD',
          };
          return {
            result: 'success',
            purchase,
            purchaseSigned: mockReceipt({ purchase }),
          };
        },
        async completePurchase(input: { purchaseToken: string }): Promise<unknown> {
          record('payments.completePurchase', input);
          return { result: 'success' };
        },
        async getIncompletePurchases(): Promise<unknown> {
          record('payments.getIncompletePurchases');
          const result = incompletePages[Math.min(incompletePage, incompletePages.length - 1)]!;
          incompletePage += 1;
          return result;
        },
      },
    };

    const w = window as unknown as {
      JestSDK: typeof sdk;
      __jestOfficialShape: {
        calls: Call[];
        emit(kind: 'hide' | 'show' | 'exit'): void;
        resetIncompletePages(): void;
      };
    };
    w.JestSDK = sdk;
    w.__jestOfficialShape = {
      calls,
      emit(kind) {
        if (kind === 'hide') invoke(hidden);
        else if (kind === 'show') invoke(shown);
        else invoke(exiting);
      },
      resetIncompletePages() {
        incompletePage = 0;
      },
    };
  }, stablePlayerId);
}

type FixtureCall = { name: string; args: unknown[] };

async function fixtureCalls(page: Page): Promise<FixtureCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __jestOfficialShape: { calls: FixtureCall[] } }).__jestOfficialShape
        .calls,
  );
}

test('LOCAL MOCK EVIDENCE: Jest official-shape launch, lifecycle, analytics, notifications, payments', async ({
  page,
  browserName,
}) => {
  await installOfficialShapeFixture(page, `official-shape-${browserName}-1`);
  await page.goto(`${JEST_GAME}/?platform=jest`);
  await expect(page.getByTestId('app')).toHaveAttribute('data-booted', '1', { timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await fixtureCalls(page)).filter(
          (call) => call.name === 'notifications.scheduleNotification',
        ).length,
      { timeout: 15_000 },
    )
    .toBe(7);

  const beforePayments = await fixtureCalls(page);
  expect(beforePayments[0]?.name).toBe('init');
  expect(beforePayments.filter((call) => call.name === 'init')).toHaveLength(1);
  expect(beforePayments[0]?.args[0]).toEqual({ autoLoginReminders: true });

  // Startup recovery is a required contract and must be observable on every launch.
  const startupRecoveryCalls = beforePayments.filter(
    (call) => call.name === 'payments.getIncompletePurchases',
  );
  expect(startupRecoveryCalls.length).toBeGreaterThan(0);

  const scheduled = beforePayments
    .filter((call) => call.name === 'notifications.scheduleNotification')
    .map((call) => call.args[0] as Record<string, unknown>);
  expect(scheduled).toHaveLength(7);
  for (let i = 0; i < 7; i += 1) {
    expect(scheduled[i]).toEqual({
      identifier: `template:return:d${i + 1}`,
      scheduledInDays: i + 1,
      priority: i === 6 ? 'high' : 'medium',
      assetReference: 'template-return-v1',
      title: 'Template idle',
      body: expect.any(String),
      ctaText: 'Keep building',
      entryPayload: {
        source: 'retention_notification',
        notification_template: `template_return_d${i + 1}_v2_a`,
        notification_offset: `D${i + 1}`,
        plan_version: 'template_retention_v2',
        build_version: '1.0.0-dev',
        progress_bucket: '0',
        variant: 'a',
      },
    });
  }
  expect(
    beforePayments.filter((call) => call.name === 'notifications.unscheduleNotification'),
  ).toHaveLength(7);

  const identityAndData = await page.evaluate(async () => {
    const root = (
      window as unknown as { __templateGame: { client: { platform: PlatformAdapter } } }
    ).__templateGame;
    const before = root.client.platform.identity.getPlayer();
    await root.client.platform.identity.login({ source: 'local-official-shape' });
    const after = root.client.platform.identity.getPlayer();
    if (!before || !after) throw new Error('official-shape identity was not initialized');
    root.client.platform.kv.set('official-shape-key', 'official-shape-value');
    await root.client.platform.kv.flush();
    const breakGlass = await root.client.platform.kv.readBreakGlass('official-shape-key');
    return { before, after, breakGlass };
  });
  expect(identityAndData.before.playerId).toBe(identityAndData.after.playerId);
  expect(identityAndData.after.registered).toBe(true);
  expect(identityAndData.breakGlass).toBe('official-shape-value');
  const afterIdentityAndData = await fixtureCalls(page);
  expect(afterIdentityAndData.find((call) => call.name === 'login')?.args[0]).toEqual({
    entryPayload: { source: 'local-official-shape' },
  });
  expect(afterIdentityAndData.find((call) => call.name === 'data.set')?.args).toEqual([
    'official-shape-key',
    'official-shape-value',
  ]);
  expect(afterIdentityAndData.some((call) => call.name === 'data.flush')).toBe(true);
  expect(afterIdentityAndData.find((call) => call.name === 'data.get')?.args).toEqual([
    'official-shape-key',
  ]);

  await page.getByTestId('click').click();
  await expect(page.getByTestId('counter')).toHaveText('1');
  await expect
    .poll(
      async () => (await fixtureCalls(page)).filter((call) => call.name === 'captureEvent').length,
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        (await fixtureCalls(page)).filter((call) => call.name === 'markGameLoaded').length,
    )
    .toBe(1);
  const afterClick = await fixtureCalls(page);
  expect(afterClick.filter((call) => call.name === 'markGameLoaded')).toHaveLength(1);
  expect(afterClick.filter((call) => call.name === 'markFirstMilestone')).toHaveLength(1);
  expect(
    afterClick.filter((call) => call.name === 'captureEvent').map((call) => call.args[0]),
  ).toEqual(expect.arrayContaining(['first_click']));

  const lifecycle = await page.evaluate(async () => {
    const root = (
      window as unknown as { __templateGame: { client: { platform: PlatformAdapter } } }
    ).__templateGame;
    const fixture = (
      window as unknown as {
        __jestOfficialShape: { emit(kind: 'hide' | 'show' | 'exit'): void };
      }
    ).__jestOfficialShape;
    let hideCalls = 0;
    const offHide = root.client.platform.lifecycle.onHide(() => {
      hideCalls += 1;
    });
    fixture.emit('hide');
    const whileSubscribed = hideCalls;
    offHide();
    fixture.emit('hide');
    const afterUnsubscribe = hideCalls;
    fixture.emit('show');
    fixture.emit('exit');
    return { whileSubscribed, afterUnsubscribe };
  });
  expect(lifecycle.whileSubscribed).toBe(1);
  expect(lifecycle.afterUnsubscribe).toBe(1);
  const lifecycleCalls = await fixtureCalls(page);
  expect(lifecycleCalls.some((call) => call.name === 'lifecycle.onHide.unsubscribe')).toBe(true);
  expect(lifecycleCalls.some((call) => call.name === 'lifecycle.onShow')).toBe(true);
  expect(lifecycleCalls.some((call) => call.name === 'lifecycle.onExitRequested')).toBe(true);
  // A quick shell hide/show is not a meaningful return and must not reset the D1-D7 ladder.
  expect(
    lifecycleCalls.filter((call) => call.name === 'notifications.scheduleNotification'),
  ).toHaveLength(7);
  expect(
    lifecycleCalls.filter((call) => call.name === 'notifications.unscheduleNotification'),
  ).toHaveLength(7);

  // Exercise the provider boundary directly with official products, purchase unions, and two
  // paged recovery responses. This remains local/mock evidence; no real payment is attempted.
  const paymentResult = await page.evaluate(async () => {
    const root = (
      window as unknown as { __templateGame: { client: { platform: PlatformAdapter } } }
    ).__templateGame;
    const fixture = (
      window as unknown as {
        __jestOfficialShape: { resetIncompletePages(): void };
      }
    ).__jestOfficialShape;
    fixture.resetIncompletePages();
    const products = await root.client.platform.payments.products();
    const begin = await root.client.platform.payments.begin('gems_100');
    const completion = await root.client.platform.payments.complete('direct-provider-token-1');
    const recovered: string[] = [];
    await root.client.platform.payments.recoverIncompleteBatch(async (batch: RecoveryBatch) => {
      recovered.push(`${batch.purchasesSigned}:${batch.hasMore}`);
      return batch.purchases.map((purchase: { purchaseToken: string }) => purchase.purchaseToken);
    });
    root.client.platform.loading.progress(0.5);
    return { products, begin, completion, recovered };
  });
  expect(paymentResult.products[0]).toMatchObject({
    sku: 'gems_100',
    title: 'Handful of gems',
    price: 0.99,
    currency: 'USD',
  });
  expect(paymentResult.begin.kind).toBe('success');
  if (paymentResult.begin.kind !== 'success') throw new Error('expected successful begin');
  expect(paymentResult.begin.purchaseToken).toBe('official-shape-paid-1');
  expect(paymentResult.begin.purchaseSigned).toEqual(expect.stringMatching(/^mockreceipt\./));
  expect(paymentResult.completion).toEqual({ kind: 'success' });
  expect(paymentResult.recovered).toHaveLength(2);
  expect(paymentResult.recovered[0]).toMatch(/^mockreceipt\..+:true$/);
  expect(paymentResult.recovered[1]).toMatch(/^mockreceipt\..+:false$/);

  const allCalls = await fixtureCalls(page);
  const incompleteCalls = allCalls.filter(
    (call) => call.name === 'payments.getIncompletePurchases',
  );
  expect(incompleteCalls.length).toBeGreaterThanOrEqual(2);
  expect(incompleteCalls.every((call) => call.args.length === 0)).toBe(true);
  expect(allCalls.find((call) => call.name === 'payments.beginPurchase')?.args[0]).toEqual({
    productSku: 'gems_100',
  });
  expect(allCalls.find((call) => call.name === 'payments.completePurchase')?.args[0]).toEqual({
    purchaseToken: 'direct-provider-token-1',
  });
  expect(allCalls.some((call) => call.name === 'setLoadingProgress' && call.args[0] === 50)).toBe(
    true,
  );
  expect(allCalls.findIndex((call) => call.name === 'init')).toBe(0);
  expect(allCalls.slice(1).every((call) => call.name !== 'init')).toBe(true);

  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-booted', '1', { timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await fixtureCalls(page)).filter(
          (call) => call.name === 'notifications.scheduleNotification',
        ).length,
      { timeout: 15_000 },
    )
    .toBe(7);
  const coldLaunchSchedule = (await fixtureCalls(page))
    .filter((call) => call.name === 'notifications.scheduleNotification')
    .map((call) => call.args[0] as Record<string, unknown>);
  expect(coldLaunchSchedule[0]).toMatchObject({
    body: 'There is more progress ready to unlock.',
    entryPayload: {
      notification_template: 'template_return_d1_v2_b',
      plan_version: 'template_retention_v2',
      variant: 'b',
    },
  });

  // Paid UI checkout: fresh preflight, one server-verified grant, provider complete exactly once.
  await expect(page.getByTestId('buy-gems_100')).toBeEnabled();
  await page.getByTestId('buy-gems_100').click();
  await expect(page.getByTestId('purchase-outcome')).toContainText('completed (paid)');
  await expect(page.getByTestId('gems')).toHaveText('200');
  await expect(page.locator('[data-testid=purchase][data-class=paid]')).toHaveCount(1);
  const afterPaidCheckout = await fixtureCalls(page);
  const checkoutBegins = afterPaidCheckout.filter((call) => call.name === 'payments.beginPurchase');
  const checkoutCompletes = afterPaidCheckout.filter(
    (call) => call.name === 'payments.completePurchase',
  );
  expect(checkoutBegins).toHaveLength(1);
  expect(checkoutCompletes).toEqual([
    { name: 'payments.completePurchase', args: [{ purchaseToken: 'official-shape-paid-1' }] },
  ]);

  // A previously healthy snapshot is not enough to open the provider sheet. The click path must
  // re-read server/live readiness and fail closed if that preflight becomes unavailable.
  const beginCallsBeforeFailedPreflight = (await fixtureCalls(page)).filter(
    (call) => call.name === 'payments.beginPurchase',
  ).length;
  await expect(page.getByTestId('buy-gems_100')).toBeEnabled();
  await page.route('**/v1/config', (route) => route.abort('failed'));
  await page.getByTestId('buy-gems_100').click();
  await expect(page.getByTestId('purchase-outcome')).toHaveText(
    'checkout is not currently available',
  );
  expect(
    (await fixtureCalls(page)).filter((call) => call.name === 'payments.beginPurchase'),
  ).toHaveLength(beginCallsBeforeFailedPreflight);
  await page.getByTestId('config-refresh').click();
  await expect(page.getByTestId('diag-config-error')).not.toHaveText('—');
  await expect(page.getByTestId('buy-gems_100')).toBeDisabled();
});
