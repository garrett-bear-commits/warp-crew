// (g) money + leaderboard + generations: a mock sandbox purchase is recorded and never mints
// (ADR-007), a draft season is activated by the admin, a run is started/played/submitted with a
// summary-bounded score, restart opens a new generation with the entitlement, and the old
// generation can never come back (its writes are refused stale_generation).
import { expect, test } from '@playwright/test';
import {
  API,
  admin,
  clickTimes,
  counterOf,
  freshPlayer,
  openGame,
  playerCall,
  playerGet,
  saveNow,
  serverNow,
  uuid,
  waitBooted,
} from './helpers.ts';

const BASE_SEASON = {
  board: 'clicks',
  rulesVersion: 'v1',
  scoreMin: 0,
  scoreMax: 100_000,
  maxElapsedMs: 600_000,
  quarantineTopN: 0,
};

/** The lab API is shared by both browser projects: close whatever season is active on the board. */
async function closeActiveSeason(): Promise<void> {
  const r = await fetch(`${API}/v1/leaderboards/clicks/top`);
  const top = (await r.json()) as { seasonKey?: string; status: string };
  if (top.seasonKey && top.status !== 'closed')
    await admin('/admin/v1/leaderboards/seasons', {
      ...BASE_SEASON,
      seasonKey: top.seasonKey,
      status: 'closed',
      reason: 'e2e cleanup',
    });
}

test.beforeEach(closeActiveSeason);
test.afterEach(closeActiveSeason);

test('sandbox purchase → season → run → restart → old generation refused', async ({ page }) => {
  const player = freshPlayer();
  await openGame(page, player);

  // purchase through the mock payments (price 0 → sandbox): recorded, granted 0
  await page.getByTestId('buy-gems_100').click();
  await expect(page.getByTestId('purchase-outcome')).toContainText('recorded (sandbox)');
  await expect(page.getByTestId('purchase-outcome')).toContainText('granted 0');
  await expect(page.getByTestId('purchase-count')).toHaveText('1');
  await expect(page.getByTestId('gems')).toHaveText('0');
  const mine = await playerGet<{
    purchases: { sku: string; classification: string; granted: number }[];
    entitlement: number;
  }>(player, '/v1/purchases/mine');
  expect(mine.body.purchases).toEqual([
    expect.objectContaining({ sku: 'gems_100', classification: 'sandbox', granted: 0 }),
  ]);
  expect(mine.body.entitlement).toBe(0);

  // season: draft first (no runs), then active
  const seasonKey = `s-${player.slice(-8)}`;
  const base = { ...BASE_SEASON, seasonKey };
  const draft = await admin('/admin/v1/leaderboards/seasons', {
    ...base,
    status: 'draft',
    reason: 'e2e draft',
  });
  expect(draft.status).toBe(200);
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-outcome')).toContainText('start failed');
  const now = await serverNow();
  const active = await admin('/admin/v1/leaderboards/seasons', {
    ...base,
    status: 'active',
    startsAt: now - 1000,
    endsAt: now + 3_600_000,
    reason: 'e2e go',
  });
  expect(active.status).toBe(200);

  // start → play → submit {score, summary:{clicks}} → outcome/visibility/rank
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-outcome')).toContainText('run started');
  await clickTimes(page, 9);
  await page.getByTestId('run-submit').click();
  await expect(page.getByTestId('run-outcome')).toContainText('accepted');
  await expect(page.getByTestId('run-outcome')).toContainText('visible');
  await expect(page.getByTestId('run-outcome')).toContainText('rank 1');
  await expect(page.getByTestId('run-outcome')).toContainText('score 9');
  await expect(page.getByTestId('board-top')).toContainText('— 9');
  await expect(page.getByTestId('board-me')).toContainText('best 9');
  await expect(page.getByTestId('board-status')).toContainText('active');
  // display name (moderated names come back changed)
  await page.getByTestId('name-input').fill('Clicky');
  await page.getByTestId('name-set').click();
  await expect(page.getByTestId('name-outcome')).toContainText('Clicky');
  await expect(page.getByTestId('board-top')).toContainText('Clicky');

  // restart: new generation, entitlement (Σpaid − Σrefunded = 0 for sandbox) shown
  await saveNow(page);
  const before = await counterOf(page);
  expect(before).toBeGreaterThanOrEqual(9);
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('restart-outcome')).toContainText('restarted: generation 1');
  await expect(page.getByTestId('restart-entitlement')).toHaveText('0');
  await expect(page.getByTestId('diag-generation')).toHaveText('1');
  await expect(page.getByTestId('lineage-generation')).toHaveText('1');
  await expect(page.getByTestId('counter')).toHaveText('0');
  await expect(page.getByTestId('gold')).toHaveText('0');
  await clickTimes(page, 2);
  await saveNow(page);
  const cur = await playerGet<{ generation: number; lineage: { kind: string } }>(
    player,
    '/v1/saves/current?meta=1',
  );
  expect(cur.body.generation).toBe(1);
  expect(cur.body.lineage.kind).toBe('restart');

  // the old generation cannot come back: a deeper generation-0 write is refused as data
  const stale = await playerCall<{ disposition: string; reason?: string; generation: number }>(
    player,
    'PUT',
    '/v1/saves',
    {
      generation: 0,
      clientSeq: 500,
      baseSeq: 0,
      sessionId: uuid(),
      progress: 999,
      savedAt: await serverNow(),
      schemaVersion: 2,
      buildVersion: '1.0.0-e2e',
      enc: 'json',
      reason: 'timer',
      blob: JSON.stringify({
        schemaVersion: 2,
        state: {
          v: 2,
          counter: 999,
          gold: 999,
          gems: 0,
          clicks: 999,
          upgrades: { auto: 0, click: 0 },
          cosmetics: [],
          settledAt: 0,
        },
      }),
    },
  );
  expect(stale.status).toBe(200);
  expect(stale.body.disposition).toBe('stored_refused');
  expect(stale.body.reason).toBe('stale_generation');
  expect(stale.body.generation).toBe(1);
  await page.reload();
  await waitBooted(page);
  await expect(page.getByTestId('diag-generation')).toHaveText('1');
  expect(await counterOf(page)).toBe(2);
});
