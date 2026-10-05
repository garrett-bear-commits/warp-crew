// ADR-035 pure decisions: what a purchase delivers (bundle or premium pack), which game configs
// boot, and how a verified subscription list becomes one entitlement per configured SKU.
import { describe, expect, it } from 'vitest';
import type { VerifiedSubscription } from '@foundation/jest-verify';
import type { GrantReward } from '@foundation/contracts';
import { deliveryRewards, type Classified } from '../../src/features/purchases/server.ts';
import { entitlements } from '../../src/features/subscriptions/server.ts';
import {
  gameConfigProblems,
  type CatalogPack,
  type GameConfig,
  type GamePolicy,
} from '../../src/game/config.ts';

const bundle: CatalogPack = {
  sku: 'kit',
  packKey: 'kit',
  baseAmount: 250,
  oneTime: true,
  rewards: [
    { kind: 'premium_currency', amount: 250 },
    { kind: 'soft_currency', currency: 'credits', amount: 800 },
    { kind: 'item', itemId: 'finish', qty: 1 },
  ],
};
const gems: CatalogPack = { sku: 'g', packKey: 'g', baseAmount: 100, firstPurchaseMultiplier: 2 };
const on = { mintPremium: 'on', mintSandbox: 'on' } as const;
const off = { mintPremium: 'off' } as const;

describe('deliveryRewards', () => {
  it('a bundle delivers exactly its rewards when its classification mints', () => {
    expect(deliveryRewards({ kind: 'paid', pack: bundle }, false, on)).toEqual(bundle.rewards);
    expect(deliveryRewards({ kind: 'paid', pack: bundle }, true, on)).toEqual(bundle.rewards);
    expect(deliveryRewards({ kind: 'sandbox', pack: bundle }, false, on)).toEqual(bundle.rewards);
    expect(
      deliveryRewards({ kind: 'sandbox', pack: bundle }, false, { mintPremium: 'on' }),
    ).toEqual([]);
    expect(deliveryRewards({ kind: 'paid', pack: bundle }, false, off)).toEqual([]);
    expect(deliveryRewards({ kind: 'unclassified', pack: bundle }, false, on)).toEqual([]);
    expect(deliveryRewards({ kind: 'unsupported', pack: null }, false, on)).toEqual([]);
  });
  it('a delivered bundle is a copy: minting can never edit the catalog', () => {
    const out = deliveryRewards({ kind: 'paid', pack: bundle }, false, on);
    (out[0] as { amount: number }).amount = 1;
    expect(bundle.rewards![0]).toEqual({ kind: 'premium_currency', amount: 250 });
  });
  it('a premium pack keeps its first-purchase promotion', () => {
    const c: Classified = { kind: 'paid', pack: gems };
    expect(deliveryRewards(c, false, on)).toEqual([{ kind: 'premium_currency', amount: 200 }]);
    expect(deliveryRewards(c, true, on)).toEqual([{ kind: 'premium_currency', amount: 100 }]);
    expect(deliveryRewards(c, false, off)).toEqual([]);
  });
});

const policy = (allowed: (r: GrantReward) => boolean): GamePolicy => ({
  validateBlob: () => ({ ok: true }),
  sanitizeForQa: (v) => v,
  grantRewardProblem: (rewards) =>
    rewards.every(allowed) ? null : 'reward outside the vocabulary',
});
const game = (o: Partial<GameConfig>): GameConfig =>
  ({
    gameId: 'g',
    features: { purchases: true },
    catalog: [],
    purchases: off,
    ...o,
  }) as GameConfig;

describe('gameConfigProblems', () => {
  const any = policy(() => true);
  it('boots a consistent catalog', () => {
    expect(gameConfigProblems(game({ catalog: [gems, bundle] }), any)).toEqual([]);
  });
  it('refuses a bundle the game cannot apply, a premium mismatch, a multiplier or no rewards', () => {
    const noCredits = policy((r) => r.kind !== 'soft_currency');
    expect(gameConfigProblems(game({ catalog: [bundle] }), noCredits)).toEqual([
      'catalog kit: reward outside the vocabulary',
    ]);
    expect(gameConfigProblems(game({ catalog: [{ ...bundle, baseAmount: 1 }] }), any)).toEqual([
      "catalog kit: baseAmount 1 differs from the bundle's premium 250",
    ]);
    expect(
      gameConfigProblems(game({ catalog: [{ ...bundle, firstPurchaseMultiplier: 2 }] }), any),
    ).toEqual(['catalog kit: a bundle cannot take a firstPurchaseMultiplier']);
    expect(
      gameConfigProblems(game({ catalog: [{ ...bundle, rewards: [], baseAmount: 0 }] }), any),
    ).toEqual(['catalog kit: a bundle needs rewards']);
    expect(gameConfigProblems(game({ catalog: [gems, gems] }), any)).toEqual([
      'catalog g: duplicate sku',
    ]);
  });
  it('subscriptions need SKUs and a bounded list age', () => {
    expect(
      gameConfigProblems(
        game({ features: { subscriptions: true } as GameConfig['features'] }),
        any,
      ),
    ).toEqual(['features.subscriptions needs subscriptions.skus']);
    expect(
      gameConfigProblems(
        game({ subscriptions: { skus: [{ sku: 's' }, { sku: 's' }], maxAgeSec: 48 * 3600 } }),
        any,
      ),
    ).toEqual(['subscriptions s: duplicate sku', 'subscriptions.maxAgeSec must be 1..86400']);
  });
});

const signed = (o: Partial<VerifiedSubscription>): VerifiedSubscription => ({
  sku: 'wc_sub_commission',
  status: 'active',
  sandbox: false,
  trialEligible: false,
  retentionOffer: null,
  price: 999,
  currency: 'USD',
  billingPeriod: 'monthly',
  ...o,
});
const subs = { skus: [{ sku: 'wc_sub_commission' }, { sku: 'wc_sub_admiral' }] };

describe('subscription entitlements', () => {
  it('one entry per configured SKU, in config order; unknown SKUs are dropped', () => {
    const out = entitlements({ subscriptions: subs, purchases: off }, [
      signed({ sku: 'other_game' }),
      signed({}),
    ]);
    expect(out.map((e) => [e.sku, e.active, e.status])).toEqual([
      ['wc_sub_commission', true, 'active'],
      ['wc_sub_admiral', false, null],
    ]);
    expect(out[0]).toMatchObject({ price: 999, currency: 'USD', billingPeriod: 'monthly' });
  });
  it('only an active status pays perks', () => {
    for (const status of ['expired', 'cancelled', 'unknown'])
      expect(
        entitlements({ subscriptions: subs, purchases: off }, [signed({ status })])[0],
      ).toMatchObject({ active: false, status });
  });
  it('sandbox subscriptions pay only behind the sandbox gate', () => {
    const sandbox = [signed({ sandbox: true })];
    expect(entitlements({ subscriptions: subs, purchases: off }, sandbox)[0]).toMatchObject({
      active: false,
      sandbox: true,
    });
    expect(
      entitlements(
        { subscriptions: subs, purchases: { mintPremium: 'off', mintSandbox: 'on' } },
        sandbox,
      )[0],
    ).toMatchObject({ active: true, sandbox: true });
  });
  it('an active entry wins over a stale duplicate of the same SKU', () => {
    const out = entitlements({ subscriptions: subs, purchases: off }, [
      signed({ status: 'expired' }),
      signed({ status: 'active', trialEligible: true }),
    ]);
    expect(out[0]).toMatchObject({ active: true, status: 'active', trialEligible: true });
  });
});
