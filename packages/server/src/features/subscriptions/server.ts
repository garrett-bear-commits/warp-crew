// subscriptions feature (ADR-035): verifies Jest's signed subscription list for the calling player
// and answers one entitlement per SKU the game configures. Stateless and outside any transaction:
// the signed list IS the entitlement, so nothing is stored or granted, and a perk the game pays
// from it is the game's own (daily grants go through the grants feature like any reward).
import type { FastifyInstance } from 'fastify';
import {
  SubscriptionsVerifyBody,
  type SubscriptionEntitlement,
  type SubscriptionsVerifyResult,
} from '@foundation/contracts';
import type { VerifiedSubscription } from '@foundation/jest-verify';
import { defineCommand } from '../../cqrs/define.ts';
import { AppError } from '../../errors.ts';
import { route } from '../../http/route.ts';
import type { AppContext } from '../../http/context.ts';
import { SUBSCRIPTION_MAX_AGE_SEC, type GameConfig } from '../../game/config.ts';

type Result = Omit<SubscriptionsVerifyResult, 'serverNow' | 'requestId'>;

export const SubscriptionsVerify = defineCommand<typeof SubscriptionsVerifyBody, Result>({
  type: 'subscriptions.verify',
  schema: SubscriptionsVerifyBody,
  actorPolicy: 'player',
  scope: 'player',
  lock: 'player',
  idempotency: { owner: 'none', retention: '7d' },
  tx: 'none',
  limit: 'subscriptions',
});

/**
 * One entitlement per configured SKU, in config order. A SKU is active only when Jest signed it
 * `active`; a sandbox subscription only where the game delivers sandbox purchases
 * (`purchases.mintSandbox`, ADR-024). SKUs the game does not configure are dropped.
 */
export function entitlements(
  game: Pick<GameConfig, 'subscriptions' | 'purchases'>,
  signed: readonly VerifiedSubscription[],
): SubscriptionEntitlement[] {
  const sandboxOn = game.purchases.mintSandbox === 'on';
  return (game.subscriptions?.skus ?? []).map(({ sku }) => {
    // A list naming a SKU twice: any active entry wins, so a stale duplicate never revokes.
    const named = signed.filter((s) => s.sku === sku);
    const usable = named.filter((s) => s.status === 'active' && (!s.sandbox || sandboxOn));
    const s = usable[0] ?? named[0];
    if (!s)
      return {
        sku,
        active: false,
        status: null,
        sandbox: false,
        trialEligible: false,
        retentionOffer: null,
        price: null,
        currency: null,
        billingPeriod: null,
      };
    return {
      sku,
      active: usable.length > 0,
      status: s.status,
      sandbox: s.sandbox,
      trialEligible: s.trialEligible,
      retentionOffer: s.retentionOffer,
      price: s.price,
      currency: s.currency,
      billingPeriod: s.billingPeriod,
    };
  });
}

export function registerSubscriptions(app: FastifyInstance, ctx: AppContext): void {
  const { bus, game } = ctx;
  ctx.declaredCommands.push(SubscriptionsVerify);
  const maxAgeMs = (game.subscriptions?.maxAgeSec ?? SUBSCRIPTION_MAX_AGE_SEC) * 1000;
  bus.register(SubscriptionsVerify, async (input, exec): Promise<Result> => {
    const v = ctx.subscriptions.verifySubscriptions(input.subscriptionsSigned, {
      gameId: ctx.config.gameId,
      playerKey: exec.playerKey!,
      now: exec.now,
      maxAgeMs,
    });
    if (!v.ok) {
      if (v.reason === 'no_secret')
        throw new AppError(
          'not_configured',
          'payments verifier has no secret; refusing to verify',
          { reason: v.reason },
        );
      return { outcome: 'rejected', reason: v.reason, subscriptions: [] };
    }
    return {
      outcome: 'verified',
      issuedAt: v.issuedAtMs,
      subscriptions: entitlements(game, v.subscriptions),
    };
  });
  route<
    typeof SubscriptionsVerifyBody,
    typeof import('@foundation/contracts').SubscriptionsVerifyResult
  >(app, ctx, 'subscriptions.verify', async ({ body, exec }) =>
    bus.execute(SubscriptionsVerify, { commandId: body.commandId, payload: body }, exec!),
  );
}
