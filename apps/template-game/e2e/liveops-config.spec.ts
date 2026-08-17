// (f) live-ops without a rebuild (ADR-012, §12 P3 gate: "one config publish without rebuild, one
// flag at 50 %, one scheduled sale"): idle.rate ×2 shows after a config re-fetch; a 50 % rollout of
// sale.summer splits fresh players (sticky per player) and a flagged player sees the banner with
// the scheduled sale; a SKU kill switch hides the pack; minBuild 9.9.9 → 426 → update banner.
import { expect, test } from '@playwright/test';
import { admin, freshPlayer, openGame, playerGet, serverNow, uuid } from './helpers.ts';

const publishFlag = (body: Record<string, unknown>) => admin('/admin/v1/liveops/flags', body);

async function resetLiveops(): Promise<void> {
  await publishFlag({
    key: 'idle.rate',
    enabled: false,
    value: 1,
    rolloutPercent: 100,
    reason: 'reset',
  });
  await publishFlag({
    key: 'sale.summer',
    enabled: false,
    value: false,
    rolloutPercent: 0,
    reason: 'reset',
  });
  const now = await serverNow();
  await admin('/admin/v1/liveops/schedules', {
    id: 'summer-sale',
    kind: 'sale',
    startsAt: now - 60_000,
    endsAt: now + 60_000,
    payload: { discount: 30 },
    active: false,
    reason: 'reset',
  });
  await admin('/admin/v1/liveops/kill-switches', {
    target: 'sku',
    id: 'gems_100',
    enabled: false,
    reason: 'reset',
  });
  await admin('/admin/v1/liveops/min-build', { minBuildVersion: '0.0.0', reason: 'reset' });
}

test.afterEach(async () => {
  await resetLiveops();
});

test('config publish without rebuild: idle.rate ×2, sale.summer at 50 %, scheduled sale, SKU kill switch, minBuild 426', async ({
  page,
}) => {
  const player = freshPlayer();
  await openGame(page, player);
  await expect(page.getByTestId('idle-rate')).toHaveText('×1');
  await expect(page.getByTestId('diag-flags')).toContainText('"idle.rate":1');

  // idle.rate = 2 at 100 % → the UI shows ×2 after the next config fetch (no rebuild)
  const f = await publishFlag({
    key: 'idle.rate',
    enabled: true,
    value: 2,
    rolloutPercent: 100,
    reason: 'e2e: double idle',
  });
  expect(f.status).toBe(200);
  await page.getByTestId('config-refresh').click();
  await expect(page.getByTestId('idle-rate')).toHaveText('×2');
  await expect(page.getByTestId('diag-flags')).toContainText('"idle.rate":2');

  // sale.summer at 50 %: sticky per player, splits a population of fresh ids
  await publishFlag({
    key: 'sale.summer',
    enabled: true,
    value: true,
    rolloutPercent: 50,
    reason: 'e2e: summer sale at 50%',
  });
  const now = await serverNow();
  const sched = await admin('/admin/v1/liveops/schedules', {
    id: 'summer-sale',
    kind: 'sale',
    startsAt: now - 1000,
    endsAt: now + 3_600_000,
    payload: { discount: 30 },
    active: true,
    reason: 'e2e sale',
  });
  expect(sched.status).toBe(200);
  const ids = Array.from({ length: 20 }, () => `roll-${uuid()}`);
  const flagged: string[] = [];
  for (const id of ids) {
    const c = await playerGet<{ flags: Record<string, unknown> }>(id, '/v1/config');
    expect(c.status).toBe(200);
    if (c.body.flags['sale.summer'] === true) flagged.push(id);
    // sticky: the same player always gets the same answer
    const c2 = await playerGet<{ flags: Record<string, unknown> }>(id, '/v1/config');
    expect(c2.body.flags['sale.summer']).toBe(c.body.flags['sale.summer']);
  }
  expect(flagged.length).toBeGreaterThanOrEqual(3);
  expect(flagged.length).toBeLessThanOrEqual(17);
  const notFlagged = ids.find((id) => !flagged.includes(id))!;

  // a flagged player sees the banner with the scheduled sale + discount; an unflagged one does not
  await openGame(page, flagged[0]!);
  await expect(page.getByTestId('sale-banner')).toBeVisible();
  await expect(page.getByTestId('sale-banner')).toContainText('30% off');
  await expect(page.getByTestId('sale-schedule')).toContainText('summer-sale');
  await expect(page.getByTestId('price-gems_100')).toHaveText('$0.69');
  await openGame(page, notFlagged);
  await expect(page.getByTestId('sale-banner')).toHaveCount(0);
  await expect(page.getByTestId('price-gems_100')).toHaveText('$0.99');

  // SKU kill switch hides the pack in the shop
  await expect(page.getByTestId('sku-gems_100')).toBeVisible();
  const ks = await admin('/admin/v1/liveops/kill-switches', {
    target: 'sku',
    id: 'gems_100',
    enabled: true,
    reason: 'e2e: pause pack',
  });
  expect(ks.status).toBe(200);
  await page.getByTestId('config-refresh').click();
  await expect(page.getByTestId('sku-gems_100')).toHaveCount(0);
  await expect(page.getByTestId('sku-gems_550')).toBeVisible();
  await expect(page.getByTestId('diag-kill-switches')).toContainText('gems_100');

  // minBuild 9.9.9 → the build announces 1.0.0-dev → 426 → forced update banner
  const mb = await admin('/admin/v1/liveops/min-build', {
    minBuildVersion: '9.9.9',
    reason: 'e2e: force update',
  });
  expect(mb.status).toBe(200);
  const old = await playerGet(player, '/v1/saves/current?meta=1', { build: '1.0.0-dev' });
  expect(old.status).toBe(426);
  await page.getByTestId('config-refresh').click();
  await expect(page.locator('.foundation-update-banner')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.foundation-update-banner')).toContainText('update is required');
  // reset → the next fetch clears the banner
  await admin('/admin/v1/liveops/min-build', { minBuildVersion: '0.0.0', reason: 'reset' });
  await page.getByTestId('config-refresh').click();
  await expect(page.locator('.foundation-update-banner')).toHaveCount(0);
});
