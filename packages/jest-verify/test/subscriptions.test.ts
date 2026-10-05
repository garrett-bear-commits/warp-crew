// Subscription list verifier (ADR-035): the claim rules Warp Crew's legacy server enforced
// (apps/warpcrew/server/subscriptions.js), on the core's shared HS256 helpers.
import { describe, expect, it } from 'vitest';
import { randomSecretB64, signHs256 } from '@foundation/testkit';
import {
  createJestSubscriptionsVerifier,
  createMockSubscriptionsVerifier,
  mintMockSubscriptions,
  DEFAULT_SUBSCRIPTION_MAX_AGE_MS,
} from '../src/index.ts';

const GAME = 'game-warp-crew';
const NOW = 1_786_924_800_000;
const secret = randomSecretB64();
const oldSecret = randomSecretB64();
const v = createJestSubscriptionsVerifier({ secretsB64: [secret, oldSecret] });
const check = { gameId: GAME, playerKey: 'subber', now: NOW };
const item = (extra: Record<string, unknown> = {}) => ({
  sku: 'wc_sub_commission',
  status: 'active',
  trialEligible: false,
  introOffer: null,
  retentionOffer: null,
  price: 999,
  currency: 'USD',
  billingPeriod: 'monthly',
  ...extra,
});
const list = (extra: Record<string, unknown> = {}, key = secret) =>
  signHs256(
    { aud: GAME, sub: 'subber', iat: Math.floor(NOW / 1000), subscriptions: [item()], ...extra },
    key,
  );

describe('Jest subscriptions verifier', () => {
  it('verifies a signed list for this player and game, iat in seconds or ms', () => {
    expect(v.verifySubscriptions(list(), check)).toEqual({
      ok: true,
      playerId: 'subber',
      issuedAtMs: NOW,
      subscriptions: [
        {
          sku: 'wc_sub_commission',
          status: 'active',
          sandbox: false,
          trialEligible: false,
          retentionOffer: null,
          price: 999,
          currency: 'USD',
          billingPeriod: 'monthly',
        },
      ],
    });
    expect(v.verifySubscriptions(list({ iat: NOW - 1000 }), check)).toMatchObject({
      ok: true,
      issuedAtMs: NOW - 1000,
    });
    expect(v.verifySubscriptions(list({}, oldSecret), check).ok).toBe(true);
  });
  it('accepts the single `subscription` proof from checkout or a retention claim', () => {
    const single = signHs256(
      {
        aud: GAME,
        sub: 'subber',
        iat: NOW / 1000,
        subscription: item({ retentionOffer: { price: 599, durationPeriods: 2 } }),
      },
      secret,
    );
    expect(v.verifySubscriptions(single, check)).toMatchObject({
      ok: true,
      subscriptions: [
        { sku: 'wc_sub_commission', retentionOffer: { price: 599, durationPeriods: 2 } },
      ],
    });
  });
  it('refuses a forged, foreign, other-player, unsigned-age, stale or future list', () => {
    expect(v.verifySubscriptions(list().replace(/.$/, 'A'), check)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(v.verifySubscriptions(list({}, randomSecretB64()), check)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(v.verifySubscriptions(list({ aud: 'other-game' }), check)).toEqual({
      ok: false,
      reason: 'wrong_audience',
    });
    expect(v.verifySubscriptions(list(), { ...check, playerKey: 'thief' })).toEqual({
      ok: false,
      reason: 'sub_mismatch',
    });
    expect(v.verifySubscriptions(list({ iat: undefined }), check)).toEqual({
      ok: false,
      reason: 'no_iat',
    });
    expect(v.verifySubscriptions(list({ iat: 'yesterday' }), check)).toEqual({
      ok: false,
      reason: 'no_iat',
    });
    const old = Math.floor((NOW - DEFAULT_SUBSCRIPTION_MAX_AGE_MS - 1000) / 1000);
    expect(v.verifySubscriptions(list({ iat: old }), check)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(v.verifySubscriptions(list({ iat: (NOW + 10 * 60_000) / 1000 }), check)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(
      v.verifySubscriptions(list({ iat: (NOW - 3_600_000) / 1000 }), {
        ...check,
        maxAgeMs: 60_000,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });
  it('pins HS256 and fails closed without a secret or on garbage', () => {
    const none = signHs256(
      { aud: GAME, sub: 'subber', iat: NOW / 1000, subscriptions: [] },
      secret,
      { alg: 'none', typ: 'JWT' },
    );
    expect(v.verifySubscriptions(none, check)).toEqual({ ok: false, reason: 'bad_alg' });
    expect(
      createJestSubscriptionsVerifier({ secretsB64: [] }).verifySubscriptions(list(), check),
    ).toEqual({ ok: false, reason: 'no_secret' });
    expect(v.verifySubscriptions('garbage', check)).toEqual({ ok: false, reason: 'malformed' });
    expect(v.verifySubscriptions(list({ subscriptions: 'all' }), check)).toEqual({
      ok: false,
      reason: 'malformed_subscription',
    });
  });
  it('keeps the signed terms it can read and drops items without a sku', () => {
    const r = v.verifySubscriptions(
      list({
        subscriptions: [
          item({ sandbox: true, billingPeriod: 'fortnightly', currency: 'usd', price: 'free' }),
          { status: 'active' },
          null,
        ],
      }),
      check,
    );
    expect(r).toMatchObject({
      ok: true,
      subscriptions: [{ sandbox: true, billingPeriod: null, currency: null, price: null }],
    });
    expect(r.ok && r.subscriptions.length).toBe(1);
  });
});

describe('mock subscriptions verifier', () => {
  const m = createMockSubscriptionsVerifier();
  it('applies the same claim rules to mock lists', () => {
    const base = { aud: GAME, sub: 'subber', iat: NOW / 1000, subscriptions: [item()] };
    expect(m.verifySubscriptions(mintMockSubscriptions(base), check)).toMatchObject({ ok: true });
    expect(m.verifySubscriptions(mintMockSubscriptions({ ...base, sub: 'other' }), check)).toEqual({
      ok: false,
      reason: 'sub_mismatch',
    });
    expect(
      m.verifySubscriptions(mintMockSubscriptions({ ...base, iat: undefined }), check),
    ).toEqual({ ok: false, reason: 'no_iat' });
    expect(m.verifySubscriptions(list(), check)).toEqual({ ok: false, reason: 'malformed' });
    expect(m.verifySubscriptions('mocksubs.!!!', check)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
