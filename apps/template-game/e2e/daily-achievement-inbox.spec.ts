// (e) daily reward, achievement (client_claim progress → evaluate → grant → claim → toast),
// admin make-good letter with a grant, announcement, code campaign → redeem. Grants are the one
// reward primitive (§1); every reward reaches the engine as {type:'grant'}.
import { expect, test } from '@playwright/test';
import { admin, clickTimes, freshPlayer, goldOf, openGame, saveNow, serverNow } from './helpers.ts';

test('daily → achievement → make-good letter → announcement → code redeem', async ({ page }) => {
  const player = freshPlayer();
  await openGame(page, player);

  // daily reward: server-stamped claim → grant claimed → +50 gold (day 1 of the ladder)
  await page.getByTestId('daily-claim').click();
  await expect(page.getByTestId('daily-outcome')).toContainText('claimed day 1');
  await expect(page.getByTestId('gold')).toHaveText('50');
  await page.getByTestId('daily-claim').click();
  await expect(page.getByTestId('daily-outcome')).toContainText('already_claimed_today');

  // achievement first-hundred: progress ≥ 100 (client claim, read from the anchored save)
  await clickTimes(page, 100);
  await expect(page.getByTestId('counter')).toHaveText('101');
  await saveNow(page);
  const goldBefore = await goldOf(page);
  await page.getByTestId('achievements-evaluate').click();
  await expect(page.getByTestId('achievements-outcome')).toContainText('unlocked: first-hundred', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('achievement-first-hundred')).toHaveAttribute('data-unlocked', '1');
  await expect(page.getByTestId('toasts')).toContainText('Achievement unlocked: first-hundred');
  await expect(page.getByTestId('gold')).toHaveText(String(goldBefore + 100));
  await page.getByTestId('achievements-evaluate').click();
  await expect(page.getByTestId('achievements-outcome')).toContainText('nothing new');

  // admin make-good: grant + support letter referencing it
  const grantKey = `admin:mg-${player}`;
  const g = await admin('/admin/v1/grants', {
    playerKey: player,
    grantKey,
    rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }],
    reason: 'e2e make-good',
    title: 'Sorry about that',
  });
  expect(g.status).toBe(200);
  const letter = await admin('/admin/v1/letters', {
    playerKey: player,
    title: 'Sorry about the outage',
    body: 'Here is 100 gold.',
    grantKey,
    reason: 'outage',
    ticketRef: 'T-e2e',
  });
  expect(letter.status).toBe(200);
  const now = await serverNow();
  const ann = await admin('/admin/v1/announcements', {
    id: `welcome-${player.slice(-8)}`,
    title: 'Welcome to the acceptance run',
    body: 'Hello everyone',
    startsAt: now - 1000,
    reason: 'launch',
  });
  expect(ann.status).toBe(200);

  await page.getByTestId('inbox-refresh').click();
  const inbox = page.getByTestId('inbox');
  await expect(inbox).toContainText('Sorry about the outage');
  await expect(inbox).toContainText('Welcome to the acceptance run');
  // announcements are game-wide (earlier runs may have left more): count relative to now
  const unreadText = (await page.getByTestId('inbox-unread').textContent()) ?? '';
  const unread = Number(unreadText.split(' ')[0]);
  expect(unread).toBeGreaterThanOrEqual(2);
  const support = inbox.locator('.foundation-letter-support');
  await expect(support).toHaveCount(1);
  const goldBeforeClaim = await goldOf(page);
  await support.locator('.foundation-letter-claim').click();
  await expect(page.getByTestId('gold')).toHaveText(String(goldBeforeClaim + 100));
  await expect(support.locator('.foundation-letter-claim')).toHaveCount(0);
  await support.locator('.foundation-letter-read').click();
  await expect(page.getByTestId('inbox-unread')).toContainText(`${unread - 1} unread`);
  await expect(support).toHaveClass(/is-read/);

  // code campaign → redeem in the UI → reward applied
  const code = `E2E-${player.slice(-8).toUpperCase()}-GOLD`;
  const camp = await admin('/admin/v1/codes/campaigns', {
    campaignId: `camp-${player.slice(-8)}`,
    codes: [code],
    rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 25 }],
    maxRedemptionsPerCode: 5,
    registeredOnly: false,
    reason: 'e2e',
  });
  expect(camp.status).toBe(200);
  const goldBeforeCode = await goldOf(page);
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-redeem').click();
  await expect(page.getByTestId('code-outcome')).toContainText('redeemed');
  await expect(page.getByTestId('gold')).toHaveText(String(goldBeforeCode + 25));
  await page.getByTestId('code-redeem').click();
  await expect(page.getByTestId('code-outcome')).toContainText('already_redeemed');
});
