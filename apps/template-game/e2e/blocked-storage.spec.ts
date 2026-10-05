// (c) blocked storage (§5.2 "blocked ≠ empty", ADR-005): localStorage throws → memory tier,
// "Not saving on this device — cloud only", play still syncs, a storage_blocked integrity event
// is recorded (visible in the admin timeline), and the game keeps working after a reload
// (the server head is adopted because there is no local slot).
import { expect, test } from '@playwright/test';
import {
  adminGet,
  clickTimes,
  counterOf,
  freshPlayer,
  openGame,
  saveNow,
  waitBooted,
} from './helpers.ts';

const blockLocalStorage = (): void => {
  const thrower = {
    get(): never {
      throw new DOMException('storage blocked (test)', 'SecurityError');
    },
    configurable: true,
  };
  try {
    Object.defineProperty(window, 'localStorage', thrower);
  } catch {
    /* fall through */
  }
  let blocked = false;
  try {
    void window.localStorage;
  } catch {
    blocked = true;
  }
  if (!blocked) Object.defineProperty(Window.prototype, 'localStorage', thrower);
};

test('memory tier: cloud-only status, sync still works, storage_blocked recorded, reload keeps working', async ({
  page,
  context,
}) => {
  await context.addInitScript(blockLocalStorage);
  const player = freshPlayer();
  await openGame(page, player);
  expect(
    await page.evaluate(() => {
      try {
        void window.localStorage;
        return 'accessible';
      } catch {
        return 'blocked';
      }
    }),
  ).toBe('blocked');
  await expect(page.getByTestId('diag-storage-mode')).toHaveText('memory');
  await expect(page.getByTestId('sync-pill')).toContainText('cloud only');

  await clickTimes(page, 12);
  await saveNow(page);
  await expect(page.getByTestId('diag-verdict')).toHaveText('synced');

  // the integrity event rides the telemetry route and shows in the inspector timeline
  await expect
    .poll(
      async () => {
        const t = await adminGet<{ items: { kind: string; ref: string }[] }>(
          `/admin/v1/players/${player}/timeline`,
        );
        return t.body.items.filter((i) => i.kind === 'integrity' && i.ref === 'storage_blocked')
          .length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // reload: still blocked, no local slot → the server head is adopted, play continues
  await page.reload();
  await waitBooted(page);
  await expect(page.getByTestId('diag-storage-mode')).toHaveText('memory');
  await expect(page.getByTestId('diag-boot')).toContainText('adopt_remote');
  expect(await counterOf(page)).toBeGreaterThanOrEqual(12);
  await clickTimes(page, 3);
  await saveNow(page);
  expect(await counterOf(page)).toBeGreaterThanOrEqual(15);
});
