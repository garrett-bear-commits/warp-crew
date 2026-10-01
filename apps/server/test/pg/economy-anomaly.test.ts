import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, saveBody, type Harness } from './harness.ts';
import { templatePolicy } from '../../games/template/policy.ts';
import { recordingSentry } from './sentry-recorder.ts';

// 20 ordinary players and one far outlier in gold and clicks (z ≈ 4.5 on both).
async function seedPopulation(h: Harness): Promise<void> {
  for (let i = 0; i < 21; i++) {
    const outlier = i === 20;
    const blob = { v: 1, counter: 10, gold: outlier ? 1_000 : 0, clicks: outlier ? 1_000 : 0 };
    const r = await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders(`anomaly-${i}`),
      payload: saveBody({}, blob),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().disposition).toBe('anchored');
  }
}

async function flaggedKeys(h: Harness): Promise<string[]> {
  const rows = await h.root<{ key: string; player_key: string }[]>`
    SELECT detail->>'key' AS key, player_key FROM integrity_events
    WHERE kind = 'economy_anomaly' ORDER BY key`;
  expect(new Set(rows.map((r) => r.player_key))).toEqual(new Set(['anomaly-20']));
  return rows.map((r) => r.key);
}

const sentry = recordingSentry();
let every: Harness;
let declared: Harness;
beforeAll(async () => {
  every = await setupHarness({ prefix: 'anomaly-all', sentry });
  declared = await setupHarness({
    prefix: 'anomaly-declared',
    policy: { ...templatePolicy, anomalyKeys: ['gold'] },
  });
  await seedPopulation(every);
  await seedPopulation(declared);
});
afterAll(async () => {
  await every?.close();
  await declared?.close();
});

describe('economy.anomaly nightly z-score', () => {
  it('scores every numeric summary key when the policy declares none', async () => {
    const run = await every.server.jobs.runNow('economy.anomaly');
    expect(run).toMatchObject({
      ran: true,
      ok: true,
      detail: { outliers: 2, flagged: 2, byKey: { clicks: 1, gold: 1 } },
    });
    expect(await flaggedKeys(every)).toEqual(['clicks', 'gold']);
    expect(sentry.events).toEqual([
      expect.objectContaining({
        kind: 'message',
        message: 'economy anomaly: 2 new outliers',
        level: 'warning',
        fingerprint: ['economy-anomaly'],
      }),
    ]);
  });

  it('does not re-flag a player on the same key within a week, and stays quiet', async () => {
    sentry.events.length = 0;
    every.clock.advance(24 * 3_600_000);
    const again = await every.server.jobs.runNow('economy.anomaly');
    expect(again.detail).toMatchObject({ outliers: 2, flagged: 0, byKey: {} });
    expect(await flaggedKeys(every)).toEqual(['clicks', 'gold']);
    expect(sentry.events).toEqual([]);
    every.clock.advance(7 * 24 * 3_600_000);
    const week = await every.server.jobs.runNow('economy.anomaly');
    expect(week.detail).toMatchObject({ flagged: 2 });
    expect(await flaggedKeys(every)).toEqual(['clicks', 'clicks', 'gold', 'gold']);
  });

  it('scores only the declared anomaly keys', async () => {
    const run = await declared.server.jobs.runNow('economy.anomaly');
    expect(run).toMatchObject({ ran: true, ok: true, detail: { keys: 1, flagged: 1 } });
    expect(await flaggedKeys(declared)).toEqual(['gold']);
  });
});
