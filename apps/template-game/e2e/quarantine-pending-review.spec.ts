// (d) quarantine + pending review (§7): a deeper quarantined write (schema_unknown) is never the
// anchor; GET /saves/current exposes pendingQuarantine so the client shows "pending review"; an
// admin promotion is a terminal, append-only review; the next head re-check adopts the promoted
// deeper state.
import { expect, test } from '@playwright/test';
import {
  admin,
  clickTimes,
  counterOf,
  freshPlayer,
  history,
  openGame,
  playerCall,
  playerGet,
  saveNow,
  serverNow,
  uuid,
  waitBooted,
} from './helpers.ts';

test('quarantined deeper write → "pending review" → admin promote → client adopts on re-check', async ({
  page,
}) => {
  const player = freshPlayer();
  await openGame(page, player);
  await clickTimes(page, 10);
  const seq = await saveNow(page);
  const cur = await playerGet<{ snapshot: { seq: number; sessionId: string; progress: number } }>(
    player,
    '/v1/saves/current?meta=1',
  );
  expect(cur.body.snapshot.progress).toBe(10);

  // a deeper write from "another build": schemaVersion 9 is unknown to the server → quarantined
  const now = await serverNow();
  const state = {
    v: 9,
    counter: 60,
    gold: 60,
    gems: 0,
    clicks: 60,
    upgrades: { auto: 0, click: 0 },
    cosmetics: [],
    settledAt: now,
  };
  const w = await playerCall<{ disposition: string; flags?: string[]; seq: number }>(
    player,
    'PUT',
    '/v1/saves',
    {
      generation: 0,
      clientSeq: 99,
      baseSeq: seq,
      sessionId: uuid(),
      progress: 60,
      savedAt: now,
      schemaVersion: 9,
      buildVersion: '9.0.0-future',
      enc: 'json',
      reason: 'timer',
      blob: JSON.stringify({ schemaVersion: 2, state }),
    },
  );
  expect(w.status).toBe(200);
  expect(w.body.disposition).toBe('stored_quarantined');
  expect(w.body.flags).toContain('schema_unknown');
  const qSeq = w.body.seq;

  // the anchor is unchanged; pendingQuarantine names the deeper row
  const head = await playerGet<{
    snapshot: { progress: number };
    pendingQuarantine?: { seq: number; progress: number; flags: string[] };
  }>(player, '/v1/saves/current?meta=1');
  expect(head.body.snapshot.progress).toBe(10);
  expect(head.body.pendingQuarantine).toMatchObject({ seq: qSeq, progress: 60 });

  // boot again → the UI shows the pending-review indicator, state stays at the anchor
  await page.reload();
  await waitBooted(page);
  await expect(page.getByTestId('pending-review')).toBeVisible();
  await expect(page.getByTestId('pending-review')).toHaveAttribute('data-seq', String(qSeq));
  await expect(page.getByTestId('pending-review')).toContainText('schema_unknown');
  expect(await counterOf(page)).toBe(10);

  // admin promotes (terminal review) → the promoted row is the anchor
  const review = await admin<{ outcome: string; anchorSeq?: number }>('/admin/v1/saves/reviews', {
    playerKey: player,
    seq: qSeq,
    action: 'promote',
    reason: 'e2e: schema 9 verified',
  });
  expect(review.status).toBe(200);
  expect(review.body.outcome).toBe('promoted');
  const again = await admin<{ outcome: string }>('/admin/v1/saves/reviews', {
    playerKey: player,
    seq: qSeq,
    action: 'reject',
    reason: 'flip',
  });
  expect([200, 409]).toContain(again.status);
  if (again.status === 200) expect(again.body.outcome).toBe('review_final');

  // head re-check → adopt the promoted deeper state
  await page.getByTestId('cloud-recheck').click();
  await expect(page.getByTestId('counter')).toHaveText('60', { timeout: 15_000 });
  await expect(page.getByTestId('pending-review')).toHaveCount(0);
  await expect(page.getByTestId('diag-boot')).toContainText('adopt_remote');
  await expect(page.getByTestId('diag-progress')).toHaveText('60');

  // and it stays after a reload (local slot now holds the promoted depth)
  await page.reload();
  await waitBooted(page);
  expect(await counterOf(page)).toBe(60);

  // this (older) build now writes schema 2 under a schema-9 anchor: schema_downgrade → the write is
  // stored, quarantined, never "saved to cloud" — the pill says "pending review" (§7)
  await clickTimes(page, 1);
  await page.getByTestId('save-now').click();
  await expect(page.getByTestId('diag-verdict')).toHaveText('synced_quarantined', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('sync-pill')).toContainText('pending review');
  const rows = await history(player);
  const q = rows.find((r) => r.progress === 61);
  expect(q).toMatchObject({ disposition: 'stored_quarantined' });
  expect(q!.flags).toContain('schema_downgrade');
  const anchor = await playerGet<{ snapshot: { progress: number; seq: number } }>(
    player,
    '/v1/saves/current?meta=1',
  );
  expect(anchor.body.snapshot.progress).toBe(60);
  expect(anchor.body.snapshot.seq).toBe(qSeq);
});
