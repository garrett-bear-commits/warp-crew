// (b) teardown path (§5.2 "server push on pagehide/visibilitychange→hidden via the beacon route,
// save first"): the server history gets a row with reason 'teardown'. Three deliveries: synthetic
// hidden/pagehide events, a real navigation away, and the fetch-keepalive fallback when
// navigator.sendBeacon is unavailable.
import { expect, test } from '@playwright/test';
import { clickTimes, freshPlayer, history, openGame } from './helpers.ts';

const fireTeardown = (): void => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
};

async function expectTeardownRow(player: string, minProgress: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await history(player);
        return rows.filter((r) => r.reason === 'teardown' && r.progress >= minProgress).length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const rows = await history(player);
  const row = rows.find((r) => r.reason === 'teardown')!;
  expect(row.disposition).toBe('anchored');
}

test('hidden + pagehide → a teardown write reaches the server (sendBeacon when available)', async ({
  page,
}) => {
  const player = freshPlayer();
  await openGame(page, player);
  await clickTimes(page, 7);
  const hasBeacon = await page.evaluate(() => typeof navigator.sendBeacon === 'function');
  test.info().annotations.push({ type: 'sendBeacon', description: String(hasBeacon) });
  await page.evaluate(fireTeardown);
  await expectTeardownRow(player, 7);
});

test('navigating away delivers the teardown write', async ({ page }) => {
  const player = freshPlayer();
  await openGame(page, player);
  await clickTimes(page, 5);
  await page.goto('about:blank');
  await expectTeardownRow(player, 5);
});

test('without navigator.sendBeacon the fetch keepalive fallback still delivers', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
  });
  const player = freshPlayer();
  await openGame(page, player);
  expect(await page.evaluate(() => typeof navigator.sendBeacon)).toBe('undefined');
  await clickTimes(page, 6);
  await page.evaluate(fireTeardown);
  await expectTeardownRow(player, 6);
});
