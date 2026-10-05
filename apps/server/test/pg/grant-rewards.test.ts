// Support and cohort grants carry only rewards the game applies: the template game's vocabulary
// (games/template/grants.ts) is gems and gold, so the server refuses any other reward at mint
// (GamePolicy.grantRewardProblem) and a typo never mints a grant the game would refuse.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupHarness, saveBody, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness({ prefix: 'grant-rewards' });
});
afterAll(async () => h?.close());

const admin = (url: string, body: Record<string, unknown>) =>
  h.inject({
    method: 'POST',
    url,
    headers: h.adminHeaders(),
    payload: { commandId: h.uuid(), ...body },
  });
const pending = async (player: string) =>
  (
    await h.inject({ method: 'GET', url: '/v1/grants/pending', headers: h.playerHeaders(player) })
  ).json().grants as { grantKey: string; rewards: unknown[] }[];

describe('grant rewards at mint', () => {
  it('mints the rewards the game applies', async () => {
    const rewards = [
      { kind: 'premium_currency', amount: 100 },
      { kind: 'soft_currency', currency: 'gold', amount: 5_000 },
    ];
    const r = await admin('/admin/v1/grants', {
      playerKey: 'gr-ok',
      grantKey: 'ticket-1',
      rewards,
      reason: 'ticket 1',
    });
    expect(r.statusCode).toBe(200);
    expect(await pending('gr-ok')).toEqual([
      expect.objectContaining({ grantKey: 'ticket-1', rewards }),
    ]);
  });

  it('refuses a reward the game cannot apply, minting nothing', async () => {
    for (const [rewards, problem] of [
      [[{ kind: 'cosmetic', cosmeticId: 'crown' }], 'reward 1: unsupported kind "cosmetic"'],
      [
        [{ kind: 'soft_currency', currency: 'gems', amount: 50 }],
        'reward 1: unsupported currency "gems"',
      ],
      [[{ kind: 'item', itemId: 'potion', qty: 1 }], 'reward 1: unsupported item "potion"'],
      [[{ kind: 'premium_currency', amount: 100_001 }], 'more than 100000 gems'],
      [[{ kind: 'premium_currency', amount: 0 }], 'reward 1: gems must be at least 1'],
    ] as const) {
      const r = await admin('/admin/v1/grants', {
        playerKey: 'gr-typo',
        grantKey: `typo-${problem}`,
        rewards,
        reason: 'typo',
      });
      expect(r.statusCode, problem).toBe(400);
      expect(r.json(), problem).toMatchObject({
        error: 'validation_failed',
        message: `rewards: ${problem}`,
      });
    }
    expect(await pending('gr-typo')).toEqual([]);
  });

  it('checks a cohort grant before its dry run counts anyone', async () => {
    await h.inject({
      method: 'PUT',
      url: '/v1/saves',
      headers: h.playerHeaders('gr-cohort'),
      payload: saveBody({ progress: 5 }, { v: 1, counter: 5, gold: 1 }),
    });
    const body = {
      grantKeyPrefix: 'cohort:outage-1',
      predicate: { all: [{ fact: 'progress', op: 'gte', value: 0 }] },
      reason: 'outage',
    };
    const typo = await admin('/admin/v1/grants/cohort', {
      ...body,
      rewards: [{ kind: 'item', itemId: 'potion', qty: 1 }],
      dryRun: true,
    });
    expect(typo.statusCode).toBe(400);
    expect(typo.json()).toMatchObject({ error: 'validation_failed' });
    const dry = await admin('/admin/v1/grants/cohort', {
      ...body,
      rewards: [{ kind: 'premium_currency', amount: 25 }],
      dryRun: true,
    });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().matched).toBeGreaterThanOrEqual(1);
  });
});
