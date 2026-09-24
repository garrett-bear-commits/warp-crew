# Jest platform and monetization research

Status: current platform facts and implementation implications, not an approved economy design  
Reviewed: 2026-09-21

## Why this exists

The existing Warp Crew documents were written against an older Jest surface and mix product ideas with assumptions that have since changed. This note records the current official platform contracts that constrain the eventual monetization, persistence, retention, and analytics designs.

## Current platform facts

### Products and purchases

Jest supports one-off USD products through digital-wallet checkout. Product data now includes `price` and `currency`; the older `credits` price field is deprecated. The correct consumable flow is:

1. list configured products;
2. begin purchase;
3. grant the item;
4. complete the purchase;
5. recover and process incomplete purchases on later startup.

The SDK also returns signed purchase data. The official documentation recommends server-side JWT verification of the signed token, including the expected game audience and player subject, when the game needs trustworthy purchase data.

Source: [Jest payments documentation](https://docs.jest.com/sdk/payments)

### Guest purchases

Guest wallets can purchase. A product does not need to be hidden behind registration; the wallet is merged if the guest later registers.

Source: [Jest platform changes](https://docs.jest.com/whats-new)

### Subscriptions

Jest supports recurring subscription entitlements. The game reads the current entitlement at startup and after checkout; subscriptions do not use the consumable purchase `complete` step. Current subscription data supports status, billing period, pricing, and eligible offers.

Source: [Jest subscriptions documentation](https://docs.jest.com/sdk/subscriptions)

### Player data

Jest offers per-player client-written JSON data with a 1 MB limit. The platform explicitly says this storage must not hold sensitive information or data requiring strong security guarantees. Warp Crew therefore cannot treat client-written cloud state as authoritative for a real-money economy.

Source: [Jest player-data documentation](https://docs.jest.com/sdk/player)

### Notifications

Scheduled notifications always compete within Jest's platform surfaces, and at most one scheduled notification per user per day across all games may be selected for SMS/RCS delivery. Jest recommends:

- state-driven messages instead of generic reminders;
- short copy, generally under 100 characters;
- rolling D1-D7 schedules;
- cancelling stale notifications when the player returns;
- replacing them with messages reflecting current progress;
- rotating copy so returning users do not receive the same D1 message repeatedly;
- using entry payload fields for attribution and contextual deep links.

Sources: [Jest notification strategy](https://docs.jest.com/guides/notifications), [Jest notifications SDK](https://docs.jest.com/sdk/notifications)

### Analytics

Jest collects broad usage and retention metrics automatically. Custom events should be a small, stable, non-PII funnel vocabulary. The platform also distinguishes `markGameLoaded()` from the required first meaningful milestone signal used to evaluate opening-minute performance.

Sources: [Jest custom-events guide](https://docs.jest.com/guides/custom-events), [Jest analytics SDK](https://docs.jest.com/sdk/analytics?engine=html5)

## Current Warp Crew alignment

### Correct foundations

- Products are merged with live `price` and `currency` fields.
- Consumables use grant-before-complete ordering.
- Incomplete purchases are recovered on startup.
- Purchase tokens are deduplicated locally.
- Notifications already include entry-payload templates.
- Travel, combat, gacha, expedition, hull, upgrade, tutorial, session, and IAP events are emitted.

### Gaps to close before live monetization

1. **No authoritative purchase verification.** `purchaseSigned` and `purchasesSigned` are returned but never verified by a backend.
2. **No authoritative economy persistence.** The player save remains localStorage-only. The existing Jest cloud-data wrapper is unused and, even if used, remains client-written state.
3. **Cross-device promise is currently false.** The registration tutorial says the crew can be saved for another device without an implemented sync path.
4. **Subscriptions are absent.** The platform supports them, but no entitlement adapter or product design exists.
5. **No first-milestone signal is implemented.** Only `markGameLoaded()` is present.
6. **Notification strategy is narrow and repetitive.** Fuel, expedition, free hire, D1, and D3 exist, but there is no rotating state-based D1-D7 bank or systematic attribution plan.
7. **Event vocabulary lacks a documented funnel.** Many events are emitted, but their required properties, versioning, and intended decisions are not specified.
8. **No price-value model exists.** The four current products are implementation examples, not a simulated offer ladder.
9. **No payer/non-payer pacing proof exists.** There is no multi-day simulation demonstrating the 5-10 minute free cadence, purchase acceleration, resource sinks, or long-run inflation control.

## Design implications

These implications do not select the final monetization boundary; they apply whichever fairness policy is approved.

1. Real-money grants and durable premium entitlements need a verified server authority or another explicitly trusted service boundary.
2. Registration should be timed around demonstrated value, cross-device protection, and notifications—not required merely to expose the store.
3. The core free session must be satisfying before any fuel interruption; fuel should create anticipation and optional extension, not repair an empty loop.
4. Notifications should name real crew, completed expeditions, damaged systems, unlocked routes, or ready rewards and deep-link into that state.
5. Product prices and content must come from configured product data; the UI should never invent or hardcode a real price.
6. A subscription, if approved, should grant predictable recurring convenience and identity value. It should not be designed until entitlement verification and the free economy are stable.
7. Every offer needs an analytics hypothesis and exposure event, not only a purchase-success event.

## Required follow-up artifacts

- Monetization principles and fairness boundary.
- Economy source/sink table by progression band.
- Free, light-spender, and high-spender 30-day simulations.
- Premium currency price ladder and exchange rules.
- Offer catalog with audience, trigger, price source, limits, contents, and expected player value.
- Subscription decision record.
- Purchase-verification and save-authority architecture.
- Analytics funnel and event contract.
- Notification lifecycle matrix and copy bank.
- Sandbox, recovery, refund, duplicate, offline, and cross-device QA plan.
