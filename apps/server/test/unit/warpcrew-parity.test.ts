// Server/client parity for Warp Crew (docs/using-the-core/add-a-game.md §4): the catalog in
// games/warpcrew/game.config.ts and the grant vocabulary in games/warpcrew/grants.ts must match
// the game's own product data, apps/warpcrew/src/data/products.js (browser-safe data; the API
// image does not carry it, so the server keeps a copy and this test keeps them equal).
import { beforeAll, describe, expect, it } from 'vitest';
import type { GrantReward } from '@foundation/contracts';
import { warpcrewGame } from '../../games/warpcrew/game.config.ts';
import { warpcrewGrants } from '../../games/warpcrew/grants.ts';
import type { GrantRewardTemplate } from '../../games/grant-vocabulary.ts';

interface ProductDef {
  sku: string;
  name: string;
  oneTime?: boolean;
  grant: Record<string, number>;
}
interface ProductsModule {
  PRODUCT_DEFS: Record<string, ProductDef>;
  SUBSCRIPTION_DEFS: Record<string, { sku: string; name: string }>;
}

let products: ProductsModule;
beforeAll(async () => {
  const url = new URL('../../../warpcrew/src/data/products.js', import.meta.url).href;
  products = (await import(url)) as ProductsModule;
});

/** The client's name for what a reward template grants: a products.js grant key. */
function grantKeyOf(t: GrantRewardTemplate | GrantReward): string {
  switch (t.kind) {
    case 'premium_currency':
      return 'gems';
    case 'soft_currency':
      return t.currency;
    case 'item':
      return t.itemId;
    default:
      throw new Error(`no products.js key for ${t.kind}`);
  }
}

/** A catalog pack's delivery as a products.js grant map. */
function catalogGrant(pack: (typeof warpcrewGame.catalog)[number]): Record<string, number> {
  const rewards: GrantReward[] = pack.rewards ?? [
    { kind: 'premium_currency', amount: pack.baseAmount },
  ];
  const out: Record<string, number> = {};
  for (const r of rewards) {
    const amount = r.kind === 'item' ? r.qty : r.kind === 'cosmetic' ? 1 : r.amount;
    out[grantKeyOf(r)] = (out[grantKeyOf(r)] ?? 0) + amount;
  }
  return out;
}

describe('Warp Crew catalog parity with products.js', () => {
  it('the same SKUs, in the same order', () => {
    expect(warpcrewGame.catalog.map((p) => p.sku)).toEqual(Object.keys(products.PRODUCT_DEFS));
  });
  it('every SKU has the same one-time flag, title and grant', () => {
    for (const pack of warpcrewGame.catalog) {
      const def = products.PRODUCT_DEFS[pack.sku]!;
      expect(pack.oneTime === true, `${pack.sku} oneTime`).toBe(def.oneTime === true);
      expect(pack.title, `${pack.sku} title`).toBe(def.name);
      expect(catalogGrant(pack), `${pack.sku} grant`).toEqual(def.grant);
    }
  });
  it('no promotion the client does not show: gem packs carry no first-purchase multiplier', () => {
    for (const pack of warpcrewGame.catalog)
      expect(pack.firstPurchaseMultiplier ?? 1, pack.sku).toBe(1);
  });
  it('the same subscription SKUs', () => {
    expect(warpcrewGame.subscriptions?.skus.map((s) => s.sku)).toEqual(
      Object.keys(products.SUBSCRIPTION_DEFS),
    );
    for (const s of warpcrewGame.subscriptions?.skus ?? [])
      expect(s.title).toBe(products.SUBSCRIPTION_DEFS[s.sku]!.name);
  });
});

describe('Warp Crew grant vocabulary covers exactly the rewards products.js uses', () => {
  const vocabularyKeys = () =>
    warpcrewGrants.fields.flatMap((f) =>
      f.kind === 'amount' ? [grantKeyOf(f.reward)] : f.options.map((o) => grantKeyOf(o.reward)),
    );
  it('one field per reward kind, no more, no less', () => {
    const used = new Set(Object.values(products.PRODUCT_DEFS).flatMap((d) => Object.keys(d.grant)));
    expect(new Set(vocabularyKeys())).toEqual(used);
    expect(vocabularyKeys().length).toBe(used.size);
  });
  it('each maximum is the most one product grants', () => {
    for (const field of warpcrewGrants.fields) {
      if (field.kind !== 'amount') continue;
      const key = grantKeyOf(field.reward);
      const most = Math.max(...Object.values(products.PRODUCT_DEFS).map((d) => d.grant[key] ?? 0));
      expect(field.max, field.name).toBe(most);
    }
  });
  it('gems are the premium currency', () => {
    expect(warpcrewGrants.premiumName).toBe('gems');
  });
});
