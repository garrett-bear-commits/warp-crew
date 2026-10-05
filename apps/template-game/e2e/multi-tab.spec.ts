// (h) multi-tab (§5.2 "Web Locks leader; follower read-only with 'Play here'"): the second tab on
// the same player is a follower; "Play here" steals the lock — it becomes the leader and the
// first tab becomes a follower. Only the leader writes (the follower's Save now is disabled).
import { expect, test } from '@playwright/test';
import { clickTimes, freshPlayer, openGame, saveNow } from './helpers.ts';

test('second tab is a follower with "Play here"; takeover flips the roles', async ({ context }) => {
  const player = freshPlayer();
  const first = await context.newPage();
  await openGame(first, player);
  await expect(first.getByTestId('leader-role')).toHaveAttribute('data-role', 'leader');
  await clickTimes(first, 4);
  await saveNow(first);

  const second = await context.newPage();
  await openGame(second, player);
  await expect(second.getByTestId('leader-role')).toHaveAttribute('data-role', 'follower', {
    timeout: 15_000,
  });
  await expect(second.getByTestId('play-here')).toBeVisible();
  await expect(second.getByTestId('click')).toBeDisabled();
  await expect(second.getByTestId('save-now')).toBeDisabled();
  await expect(second.getByTestId('follower-note')).toBeVisible();
  // the follower shows the same save (read from the slot the leader wrote)
  await expect(second.getByTestId('counter')).toHaveText('4');

  await second.getByTestId('play-here').click();
  await expect(second.getByTestId('leader-role')).toHaveAttribute('data-role', 'leader', {
    timeout: 15_000,
  });
  await expect(first.getByTestId('leader-role')).toHaveAttribute('data-role', 'follower', {
    timeout: 15_000,
  });
  await expect(first.getByTestId('play-here')).toBeVisible();
  await expect(second.getByTestId('click')).toBeEnabled();
  await clickTimes(second, 3);
  await expect(second.getByTestId('counter')).toHaveText('7');
  await saveNow(second);
  await expect(first.getByTestId('click')).toBeDisabled();
});
