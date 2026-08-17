// (a) boot → play → "Saved to cloud" → a wiped device restores from the server head (§5.2 boot
// machine: empty cache is a normal boot path; the anchor is what the player gets back).
import { expect, test } from '@playwright/test';
import {
  clickTimes,
  counterOf,
  freshPlayer,
  openGame,
  playerGet,
  saveNow,
  waitBooted,
} from './helpers.ts';

test('new player: start_new → 20 clicks → Saved to cloud → cleared storage restores ≥ 20 from the anchor', async ({
  page,
  context,
}) => {
  const player = freshPlayer();
  await openGame(page, player);
  await expect(page.getByTestId('diag-boot')).toContainText('start_new');
  await expect(page.getByTestId('diag-storage-mode')).toHaveText('local');
  await expect(page.getByTestId('sync-pill')).toContainText('Saved on this device');

  await clickTimes(page, 20);
  await expect(page.getByTestId('counter')).toHaveText('20');
  await expect(page.getByTestId('gold')).toHaveText('20');
  await saveNow(page);
  await expect(page.getByTestId('diag-verdict')).toHaveText('synced');

  // the API sees the anchored head with the same mock identity
  const cur = await playerGet<{
    empty: boolean;
    generation: number;
    snapshot: { progress: number; disposition: string; summary?: Record<string, number> };
  }>(player, '/v1/saves/current?meta=1');
  expect(cur.status).toBe(200);
  expect(cur.body.empty).toBe(false);
  expect(cur.body.generation).toBe(0);
  expect(cur.body.snapshot.disposition).toBe('anchored');
  expect(cur.body.snapshot.progress).toBeGreaterThanOrEqual(20);
  expect(cur.body.snapshot.summary?.clicks).toBe(20);

  // wipe the device: no local slot, no lastKnownPlayerId → boot adopts the server head
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitBooted(page);
  await expect(page.getByTestId('diag-boot')).toContainText('adopt_remote');
  expect(await counterOf(page)).toBeGreaterThanOrEqual(20);
  await expect(page.getByTestId('diag-generation')).toHaveText('0');
});
