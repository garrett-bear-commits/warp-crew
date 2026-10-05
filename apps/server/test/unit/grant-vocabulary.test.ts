import { describe, expect, it } from 'vitest';
import {
  grantContentsText,
  grantProblem,
  readGrant,
  rewardOf,
  type GrantVocabulary,
} from '../../games/grant-vocabulary.ts';
import { templateGrants } from '../../games/template/grants.ts';

// A richer vocabulary than the template's: an item amount and a choice of contracts.
const rich: GrantVocabulary = {
  premiumName: 'gems',
  fields: [
    ...templateGrants.fields,
    {
      kind: 'amount',
      name: 'chests',
      label: 'Chest',
      max: 10,
      reward: { kind: 'item', itemId: 'chest' },
    },
    {
      kind: 'choice',
      name: 'contract',
      label: 'contract',
      max: 2,
      options: [
        {
          value: 'standard',
          label: 'Standard',
          reward: { kind: 'item', itemId: 'contract:standard' },
        },
        {
          value: 'premium',
          label: 'Premium',
          reward: { kind: 'item', itemId: 'contract:premium' },
        },
      ],
    },
  ],
};

describe('grant vocabulary', () => {
  it('reads every field and sums repeated rewards', () => {
    const rewards = [
      rewardOf({ kind: 'premium_currency' }, 100),
      rewardOf({ kind: 'soft_currency', currency: 'gold' }, 5_000),
      rewardOf({ kind: 'item', itemId: 'chest' }, 3),
      rewardOf({ kind: 'item', itemId: 'chest' }, 1),
      rewardOf({ kind: 'item', itemId: 'contract:premium' }, 1),
    ];
    const read = readGrant(rich, rewards);
    expect(read).toEqual({
      ok: true,
      contents: { gems: 100, gold: 5_000, chests: 4, contract: ['premium'] },
    });
    expect(read.ok && grantContentsText(rich, read.contents)).toBe(
      '+100 Gems (free) · +5,000 Gold · +4 Chests · 1 Premium contract',
    );
  });

  it('refuses whole grants: unknown rewards, extra keys, bad amounts and totals over the limit', () => {
    expect(grantProblem(rich, [])).toBe('no rewards');
    expect(grantProblem(rich, [{ kind: 'premium_currency', amount: 1, bonus: 1 }])).toBe(
      'reward 1: unsupported kind "premium_currency"',
    );
    expect(grantProblem(rich, [{ kind: 'item', itemId: 'chest', qty: 1.5 }])).toBe(
      'reward 1: chests must be at least 1',
    );
    expect(
      grantProblem(rich, [
        { kind: 'item', itemId: 'chest', qty: 6 },
        { kind: 'item', itemId: 'chest', qty: 5 },
      ]),
    ).toBe('more than 10 chests');
    expect(
      grantProblem(rich, [
        { kind: 'item', itemId: 'contract:standard', qty: 2 },
        { kind: 'item', itemId: 'contract:premium', qty: 1 },
      ]),
    ).toBe('more than 2 contracts');
    expect(grantProblem(rich, Array(21).fill({ kind: 'premium_currency', amount: 1 }))).toBe(
      'more than 20 rewards',
    );
    expect(grantProblem(templateGrants, [{ kind: 'item', itemId: 'chest', qty: 1 }])).toBe(
      'reward 1: unsupported item "chest"',
    );
  });
});
