// Warp Crew client/server parity (docs/using-the-core/add-a-game.md §4), the client half: the
// core client (apps/warpcrew/src/core) must send exactly the progress and summary the policy
// reads, accept exactly the save shapes it accepts, write the schema it records, apply exactly the
// grant kinds the vocabulary mints, and sell exactly the catalog SKUs. The products.js half is
// warpcrew-parity.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { warpcrewGame } from '../../games/warpcrew/game.config.ts';
import { warpcrewGrants } from '../../games/warpcrew/grants.ts';
import {
  isWarpcrewPlayer,
  MAX_LIFETIME_COUNTER,
  progressOf,
  summaryOf,
  warpcrewPolicy,
  type WarpcrewPlayer,
} from '../../games/warpcrew/policy.ts';
import type { GrantRewardTemplate } from '../../games/grant-vocabulary.ts';

type Player = WarpcrewPlayer & Record<string, unknown>;
interface ClientProgress {
  progressOf(p: unknown): number;
  summaryOf(p: unknown): Record<string, number>;
  isWarpcrewPlayer(p: unknown): boolean;
  MAX_LIFETIME_COUNTER: number;
}
interface ClientGrants {
  GRANT_KINDS: readonly string[];
  grantKindOf(r: unknown): string;
  rewardsFromTable(t: Record<string, number>): unknown[];
}
interface ClientCodec {
  SAVE_VERSION: number;
  warpcrewCodec: {
    encode(s: unknown): string;
    trialDeserialize(b: string): { ok: boolean; state?: Player };
  };
}
interface ClientEngine {
  warpcrewEngine: { progressOf(s: unknown): number; summary(s: unknown): Record<string, number> };
}
interface PlayerModule {
  createNewPlayer(o?: { captainName?: string; now?: number; rng?: () => number }): Player;
}
interface ProductsModule {
  PRODUCT_DEFS: Record<string, { sku: string; oneTime?: boolean; grant: Record<string, number> }>;
}

const src = (path: string) => new URL(`../../../warpcrew/src/${path}`, import.meta.url).href;
let progress: ClientProgress;
let grants: ClientGrants;
let codec: ClientCodec;
let engine: ClientEngine;
let game: PlayerModule;
let products: ProductsModule;
beforeAll(async () => {
  progress = (await import(src('core/progress.js'))) as ClientProgress;
  grants = (await import(src('core/grants.js'))) as ClientGrants;
  codec = (await import(src('core/codec.js'))) as ClientCodec;
  engine = (await import(src('core/engine.js'))) as ClientEngine;
  game = (await import(src('systems/player.js'))) as PlayerModule;
  products = (await import(src('data/products.js'))) as ProductsModule;
});

/** A deterministic stream of odd players: counters of every type, wrong wallets, crew garbage. */
function* players(): Generator<unknown> {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const values = [0, 1, 3.7, -2, 1e6, 1e6 + 1, 2 ** 41, Number.NaN, '5', null, undefined, Infinity];
  const pick = () => values[Math.floor(rnd() * values.length)];
  const base = game.createNewPlayer({ captainName: 'Vex', now: 1, rng: () => 0.5 });
  for (let i = 0; i < 400; i++) {
    yield {
      ...base,
      version: rnd() < 0.1 ? pick() : base.version,
      wallet:
        rnd() < 0.05 ? pick() : { credits: pick(), gems: pick(), medals: pick(), fuel: pick() },
      stats:
        rnd() < 0.05
          ? pick()
          : { jumps: pick(), combatsWon: pick(), expeditions: pick(), contractsCompleted: pick() },
      story: rnd() < 0.5 ? { chapter: pick() } : undefined,
      crew: rnd() < 0.1 ? [null] : rnd() < 0.1 ? [{ templateId: 1 }] : base.crew,
      ship: rnd() < 0.05 ? 'sparrow' : base.ship,
    };
  }
}

describe('Warp Crew client progress and summary equal the policy', () => {
  it('progressOf, summaryOf and the shape check agree on 400 odd players', () => {
    for (const p of players()) {
      expect(progress.isWarpcrewPlayer(p)).toBe(isWarpcrewPlayer(p));
      expect(progress.progressOf(p as Player)).toBe(progressOf(p as Player));
      if (isWarpcrewPlayer(p)) {
        expect(progress.summaryOf(p)).toEqual(summaryOf(p));
        expect(engine.warpcrewEngine.progressOf(p)).toBe(progressOf(p));
        expect(engine.warpcrewEngine.summary(p)).toEqual(summaryOf(p));
      }
    }
    expect(progress.MAX_LIFETIME_COUNTER).toBe(MAX_LIFETIME_COUNTER);
  });
  it('the server accepts what the client codec writes, at the schema the client declares', () => {
    const p = game.createNewPlayer({ captainName: 'Vex', now: 1, rng: () => 0.5 });
    const blob = JSON.parse(codec.warpcrewCodec.encode(p)) as unknown;
    const verdict = warpcrewPolicy.validateBlob(blob);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.schemaVersion).toBe(codec.SAVE_VERSION);
      expect(verdict.summary).toEqual(progress.summaryOf(p));
    }
    expect(warpcrewGame.knownSchemaVersions).toContain(codec.SAVE_VERSION);
    expect(Math.max(...warpcrewGame.knownSchemaVersions)).toBe(codec.SAVE_VERSION);
  });
});

describe('Warp Crew client grants and SKUs equal the server', () => {
  const kindOf = (t: GrantRewardTemplate): string =>
    t.kind === 'soft_currency'
      ? `soft_currency:${t.currency}`
      : t.kind === 'item'
        ? `item:${t.itemId}`
        : t.kind;
  it('the client applies exactly the vocabulary kinds', () => {
    const vocabulary = warpcrewGrants.fields.flatMap((f) =>
      f.kind === 'amount' ? [kindOf(f.reward)] : f.options.map((o) => kindOf(o.reward)),
    );
    expect([...grants.GRANT_KINDS].sort()).toEqual([...new Set(vocabulary)].sort());
  });
  it('every catalog delivery is a grant the client applies', () => {
    for (const pack of warpcrewGame.catalog) {
      const rewards = pack.rewards ?? [
        { kind: 'premium_currency' as const, amount: pack.baseAmount },
      ];
      for (const r of rewards)
        expect(grants.GRANT_KINDS, pack.sku).toContain(grants.grantKindOf(r));
      // the local-mock checkout delivers the same rewards the server mints
      const local = grants.rewardsFromTable(products.PRODUCT_DEFS[pack.sku]!.grant);
      expect(new Set(local.map((r) => JSON.stringify(r)))).toEqual(
        new Set(rewards.map((r) => JSON.stringify(r))),
      );
    }
  });
  it('the client sells exactly the catalog SKUs, one-time flags included', () => {
    expect(Object.keys(products.PRODUCT_DEFS)).toEqual(warpcrewGame.catalog.map((p) => p.sku));
    for (const pack of warpcrewGame.catalog)
      expect(products.PRODUCT_DEFS[pack.sku]!.oneTime === true, pack.sku).toBe(
        pack.oneTime === true,
      );
  });
});
