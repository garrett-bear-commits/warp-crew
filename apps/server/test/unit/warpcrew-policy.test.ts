// Warp Crew policy conformance (docs/using-the-core/add-a-game.md §2): current, old, malformed,
// future-schema and QA-import fixtures, built from the game's own createNewPlayer/migratePlayer
// (apps/warpcrew/src/systems/player.js) so the server reads exactly what the client writes.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameConfigProblems } from '@foundation/server';
import { warpcrewGame } from '../../games/warpcrew/game.config.ts';
import {
  progressOf,
  unwrapWarpcrew,
  warpcrewPolicy,
  type WarpcrewPlayer,
} from '../../games/warpcrew/policy.ts';

type Player = WarpcrewPlayer & Record<string, unknown>;
interface PlayerModule {
  createNewPlayer(o?: {
    captainName?: string;
    tutorialScript?: number;
    now?: number;
    rng?: () => number;
  }): Player;
  migratePlayer(p: unknown): Player;
}

const T0 = 1_786_924_800_000;
let game: PlayerModule;
let fresh: Player;
let played: Player;
let old: Player;

beforeAll(async () => {
  const url = new URL('../../../warpcrew/src/systems/player.js', import.meta.url).href;
  game = (await import(url)) as PlayerModule;
  fresh = game.createNewPlayer({ captainName: 'Vex', now: T0, rng: () => 0.42 });
  // A captain some days in: lifetime counters, story, wallet, purchases and provider evidence.
  played = game.migratePlayer({
    ...fresh,
    wallet: { ...fresh.wallet, gems: 380, credits: 2450, medals: 61, fuel: 7 },
    stats: {
      ...(fresh.stats as object),
      jumps: 31,
      combatsWon: 9,
      expeditions: 2,
      contractsCompleted: 12,
    },
    story: { chapter: 2, eclipseIntro: true },
    iapFulfilled: ['jest-token-1'],
    purchaseSkus: { 'jest-token-1': 'wc_gems_m' },
    pendingReceipts: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwbGF5ZXItMSJ9.sig'],
    cloudSeq: 14,
  });
  // A version-4 save from before the v5 tutorial, as an early build wrote it.
  old = {
    version: 4,
    captainName: 'Old Salt',
    wallet: { credits: 300, fuel: 5, gems: 20 },
    stats: { jumps: 6, combatsWon: 2 },
    tutorial: { script: 4, completed: true, phase: 'done' },
    crew: [],
  } as Player;
});

const SAVE_VERSION = () => fresh.version;

describe('Warp Crew policy: current saves', () => {
  it('accepts the client save in every wrapper and records the player version as the schema', () => {
    for (const blob of [
      { schemaVersion: SAVE_VERSION(), state: played },
      { player: played, savedAt: T0 },
      played,
    ]) {
      const r = warpcrewPolicy.validateBlob(JSON.parse(JSON.stringify(blob)));
      expect(r).toEqual({
        ok: true,
        schemaVersion: SAVE_VERSION(),
        summary: {
          progress: 31 + 9 + 2 + 12,
          gems: 380,
          credits: 2450,
          medals: 61,
          fuel: 7,
          jumps: 31,
          combatsWon: 9,
          contractsCompleted: 12,
          chapter: 2,
        },
      });
    }
  });
  it('a new captain is valid at progress 0 and the version is a known schema', () => {
    const r = warpcrewPolicy.validateBlob(fresh);
    expect(r.ok).toBe(true);
    expect(r.summary?.progress).toBe(0);
    expect(warpcrewGame.knownSchemaVersions).toContain(SAVE_VERSION());
    expect(Math.max(...warpcrewGame.knownSchemaVersions)).toBe(SAVE_VERSION());
  });
  it('the envelope schemaVersion never outranks the blob', () => {
    expect(warpcrewPolicy.validateBlob({ schemaVersion: 1, state: played }).schemaVersion).toBe(
      SAVE_VERSION(),
    );
  });
  it('a claimed progress deeper than the blob is implausible; equal or shallower is not', () => {
    const summary = warpcrewPolicy.validateBlob(played).summary!;
    expect(warpcrewPolicy.summaryPlausible!(summary, progressOf(played))).toBe(true);
    expect(warpcrewPolicy.summaryPlausible!(summary, 0)).toBe(true);
    expect(warpcrewPolicy.summaryPlausible!(summary, progressOf(played) + 1)).toBe(false);
  });
});

describe('Warp Crew policy: old saves', () => {
  it('accepts an old save at its own version and migration never lowers progress', () => {
    const r = warpcrewPolicy.validateBlob({ player: old, savedAt: T0 });
    expect(r).toMatchObject({ ok: true, schemaVersion: 4, summary: { progress: 8, gems: 20 } });
    const migrated = game.migratePlayer(old);
    expect(migrated.version).toBe(SAVE_VERSION());
    expect(progressOf(migrated)).toBeGreaterThanOrEqual(progressOf(old));
    expect(warpcrewPolicy.validateBlob(migrated).ok).toBe(true);
    expect(warpcrewGame.knownSchemaVersions).toContain(4);
  });
  it('progress is monotone under migratePlayer for every fixture', () => {
    for (const p of [fresh, played, old]) {
      const once = game.migratePlayer(p);
      expect(progressOf(once)).toBeGreaterThanOrEqual(progressOf(p));
      expect(progressOf(game.migratePlayer(once))).toBe(progressOf(once));
    }
  });
  it('progress is a safe integer and ignores junk counters', () => {
    expect(
      progressOf({
        stats: { jumps: -5, combatsWon: 'x', expeditions: 2.9, contractsCompleted: 1e300 },
      }),
    ).toBe(2 + 2 ** 40);
    expect(
      Number.isSafeInteger(
        progressOf({
          stats: { jumps: 1e300, combatsWon: 1e300, expeditions: 1e300, contractsCompleted: 1e300 },
        }),
      ),
    ).toBe(true);
    expect(progressOf({})).toBe(0);
  });
});

describe('Warp Crew policy: malformed saves', () => {
  it('refuses anything that is not a versioned player with a wallet (stored, never anchored)', () => {
    const bad: unknown[] = [
      null,
      42,
      'save',
      [],
      {},
      { player: {} },
      { player: null, savedAt: T0 },
      { schemaVersion: 9, state: null },
      { ...fresh, version: 0 },
      { ...fresh, version: '9' },
      { ...fresh, version: 9.5 },
      { ...fresh, wallet: undefined },
      { ...fresh, wallet: [] },
      { ...fresh, wallet: { gems: 'many' } },
      { ...fresh, wallet: { credits: Infinity } },
      { ...fresh, stats: [] },
    ];
    for (const blob of bad)
      expect(warpcrewPolicy.validateBlob(blob), JSON.stringify(blob)?.slice(0, 80)).toEqual({
        ok: false,
        reason: 'shape',
      });
  });
});

describe('Warp Crew policy: future schema', () => {
  it('reads a newer save but its version is unknown, so the core quarantines it (schema_unknown)', () => {
    const future = { ...played, version: SAVE_VERSION() + 1, hyperdrive: { tier: 3 } };
    const r = warpcrewPolicy.validateBlob({ schemaVersion: SAVE_VERSION() + 1, state: future });
    expect(r).toMatchObject({ ok: true, schemaVersion: SAVE_VERSION() + 1 });
    expect(warpcrewGame.knownSchemaVersions).not.toContain(SAVE_VERSION() + 1);
  });
});

describe('Warp Crew policy: QA import', () => {
  it('strips the name, receipts and provider tokens, keeps the wrapper and the summary', () => {
    for (const blob of [
      { schemaVersion: SAVE_VERSION(), state: played },
      { player: played, savedAt: T0 },
      played,
    ]) {
      const input = JSON.parse(JSON.stringify(blob)) as Record<string, unknown>;
      const clean = warpcrewPolicy.sanitizeForQa(input) as Record<string, unknown>;
      const before = unwrapWarpcrew(input);
      const after = unwrapWarpcrew(clean);
      expect(after.wrapper).toBe(before.wrapper);
      const p = after.player as Record<string, unknown>;
      expect(p.captainName).toBe('Captain');
      expect(p.pendingReceipts).toEqual([]);
      expect(p.iapFulfilled).toEqual([]);
      expect(p.purchaseSkus).toEqual({});
      expect('cloudSeq' in p).toBe(false);
      expect(JSON.stringify(clean)).not.toMatch(/Vex|jest-token-1|eyJhbGci/);
      expect(warpcrewPolicy.validateBlob(clean)).toEqual(warpcrewPolicy.validateBlob(input));
      // The input is not mutated.
      expect(JSON.stringify(input)).toMatch(/jest-token-1/);
    }
  });
  it('passes through what it cannot read', () => {
    expect(warpcrewPolicy.sanitizeForQa({ nope: true })).toEqual({ nope: true });
  });
});

describe('Warp Crew game config', () => {
  it('boots: every bundle is a grant the policy accepts', () => {
    expect(gameConfigProblems(warpcrewGame, warpcrewPolicy)).toEqual([]);
  });
  it('premium minting stays off (ADR-024) and the declared origins include Jest and Pages', () => {
    expect(warpcrewGame.purchases).toEqual({ mintPremium: 'off' });
    expect(warpcrewGame.origins).toEqual(
      expect.arrayContaining([
        'https://jest.com',
        'https://*.jest.com',
        'https://garrett-bear-commits.github.io',
      ]),
    );
  });
  it('the grant vocabulary refuses rewards the client cannot apply and over-sized grants', () => {
    const problem = warpcrewPolicy.grantRewardProblem!;
    expect(problem([{ kind: 'premium_currency', amount: 3500 }])).toBeNull();
    expect(
      problem([
        { kind: 'soft_currency', currency: 'credits', amount: 12_000 },
        { kind: 'item', itemId: 'drydockFinishes', qty: 3 },
      ]),
    ).toBeNull();
    expect(problem([{ kind: 'premium_currency', amount: 3501 }])).toMatch(/more than 3500/);
    expect(problem([{ kind: 'soft_currency', currency: 'gold', amount: 1 }])).toMatch(
      /unsupported currency "gold"/,
    );
    expect(problem([{ kind: 'cosmetic', cosmeticId: 'hat' }])).toMatch(/unsupported kind/);
  });
});
