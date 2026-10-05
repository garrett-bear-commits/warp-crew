// (j) restore panel (§5.2 Restore): history from the server; "restore to point" opens a new
// generation seeded from that seq (generation bump, counter back to P1); "restore forward-only"
// adopts a deeper historic blob under the restoring gate; "Recover from platform copy" reads
// the KV mirror once (not deeper here → not_deeper).
import { expect, test } from '@playwright/test';
import {
  clickTimes,
  counterOf,
  freshPlayer,
  history,
  openGame,
  playerCall,
  saveNow,
  serverNow,
  uuid,
  withReload,
} from './helpers.ts';

test('restore to point → generation 1 at P1', async ({ page }) => {
  const player = freshPlayer();
  await openGame(page, player);
  await clickTimes(page, 5);
  const seq1 = await saveNow(page);
  await clickTimes(page, 6);
  const seq2 = await saveNow(page);
  expect(seq2).toBeGreaterThan(seq1);
  expect(await counterOf(page)).toBe(11);

  await page.getByTestId('restore-open').click();
  const table = page.getByTestId('restore-history');
  await expect(table).toBeVisible();
  await expect(table).toHaveAttribute('data-generation', '0');
  await expect(page.locator(`[data-testid=history-row][data-seq="${seq1}"]`)).toHaveAttribute(
    'data-progress',
    '5',
  );
  await expect(page.locator(`[data-testid=history-row][data-seq="${seq2}"]`)).toHaveAttribute(
    'data-progress',
    '11',
  );

  // the restore reloads the page after write → confirm
  await withReload(page, () => page.getByTestId(`restore-to-point-${seq1}`).click());
  await expect(page.getByTestId('diag-generation')).toHaveText('1');
  await expect(page.getByTestId('counter')).toHaveText('5');
  await expect(page.getByTestId('lineage-generation')).toHaveText('1');
  const rows = await history(player);
  expect(rows.every((r) => r.generation === 1)).toBe(true);
  expect(rows[0]!.progress).toBe(5);
  // play on in the new generation and it syncs
  await clickTimes(page, 1);
  await saveNow(page);
  await expect(page.getByTestId('diag-verdict')).toHaveText('synced');
});

test('restore forward-only adopts a deeper historic blob; the KV break-glass path reports not_deeper', async ({
  page,
}) => {
  const player = freshPlayer();
  await openGame(page, player);
  await clickTimes(page, 3);
  await saveNow(page);
  await page.getByTestId('restore-break-glass').click();
  await expect(page.getByTestId('restore-outcome')).toContainText('not_deeper');

  // another device wrote a deeper snapshot: it shows in history and can be restored forward-only
  const now = await serverNow();
  const deep = await playerCall<{ disposition: string; seq: number }>(player, 'PUT', '/v1/saves', {
    generation: 0,
    clientSeq: 50,
    baseSeq: 0,
    sessionId: uuid(),
    progress: 40,
    savedAt: now,
    schemaVersion: 2,
    buildVersion: '1.0.0-e2e',
    enc: 'json',
    reason: 'timer',
    blob: JSON.stringify({
      schemaVersion: 2,
      state: {
        v: 2,
        counter: 40,
        gold: 40,
        gems: 0,
        clicks: 40,
        upgrades: { auto: 0, click: 0 },
        cosmetics: [],
        settledAt: now,
      },
    }),
  });
  expect(deep.body.disposition).toBe('anchored');
  await page.getByTestId('restore-open').click();
  await expect(
    page.locator(`[data-testid=history-row][data-seq="${deep.body.seq}"]`),
  ).toHaveAttribute('data-progress', '40');
  await withReload(page, () => page.getByTestId(`restore-forward-${deep.body.seq}`).click());
  await expect(page.getByTestId('counter')).toHaveText('40');
  await expect(page.getByTestId('diag-generation')).toHaveText('0');
  await expect(page.getByTestId('diag-progress')).toHaveText('40');
});
