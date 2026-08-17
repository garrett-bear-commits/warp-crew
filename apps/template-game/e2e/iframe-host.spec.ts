// (i) URL-hosted build inside a jest.com-shaped cross-site iframe (ADR-010, §9): partitioned or
// blocked storage is the normal case; the game boots, plays and reaches "Saved to cloud".
import { expect, test } from '@playwright/test';
import { freshPlayer, gameUrl, HOST, playerGet } from './helpers.ts';

test('the game runs inside the cross-site host iframe and saves to the cloud', async ({ page }) => {
  const player = freshPlayer();
  await page.goto(`${HOST}/?game=${encodeURIComponent(gameUrl(player))}`);
  const frame = page.frameLocator('#game');
  await expect(frame.getByTestId('app')).toHaveAttribute('data-booted', '1', { timeout: 30_000 });
  const mode = await frame.getByTestId('diag-storage-mode').textContent();
  test.info().annotations.push({ type: 'storage-mode-in-iframe', description: mode ?? '' });
  expect(['local', 'memory']).toContain(mode);
  const click = frame.getByTestId('click');
  for (let i = 0; i < 8; i++) await click.click();
  await expect(frame.getByTestId('counter')).toHaveText('8');
  await frame.getByTestId('save-now').click();
  await expect(frame.getByTestId('sync-pill')).toContainText('Saved to cloud', { timeout: 15_000 });
  const cur = await playerGet<{ snapshot: { progress: number } }>(
    player,
    '/v1/saves/current?meta=1',
  );
  expect(cur.body.snapshot.progress).toBe(8);
});
