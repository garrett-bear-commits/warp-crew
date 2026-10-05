# ADR-035 Bundle packs, one-time packs, an ownership query and verified subscriptions

Date: 2026-10-05. Status: accepted (Warp Crew port, stage 2; owner approval still gates any minting).

## Context

Warp Crew is the first game ported onto the core whose shop is more than premium-currency packs. Its legacy
server (`apps/warpcrew/server`, the specification here) sold:

- **bundles**: the starter kit and five sector wall packs grant gems, credits, medals, fuel and drydock finishes
  in one purchase, where `CatalogPack` could grant only `baseAmount` premium currency;
- **one-time packs**: those six sell once per player; a second payment is recorded (`duplicate_one_time`) for
  support to refund and never granted, and a refused sandbox receipt never counts as owning the pack;
- an **ownership query** (`GET /v1/purchases/owned`) the client reads before opening a one-time checkout, so a
  pack bought on another device is never charged twice: no answer means no checkout;
- **subscriptions** (Captain's Commission): Jest's signed subscription list is verified per request (same HS256
  secret, game id, `sub` is the caller, `iat` present and under 24 h so a pre-cancel list cannot be replayed),
  each known SKU's entitlement is returned, nothing is stored, and sandbox subscriptions count only on a QA server.

ADR-024 deferred subscriptions; architecture §14 put them in v1.1. Other games on the core (Cairndeep, Wild West
Demons) sell the same shapes.

## Decision

**Bundles.** `CatalogPack.rewards?: GrantReward[]` makes a pack a bundle: one delivery mints exactly those rewards
as one `purchase:<sha256(token)>` grant (every reward is a grant; the client applies it through its grant
mapping). `baseAmount` stays the premium inside the bundle, which is what `purchase_transactions.granted` records,
so entitlement (`Σ granted` of paid rows) is unchanged in meaning. Minting follows ADR-024 exactly as before
(`mintPremium` for paid, `mintSandbox` for sandbox). `createServer` refuses to boot (`gameConfigProblems`) when a
bundle's rewards are outside the game's grant vocabulary (`GamePolicy.grantRewardProblem`), its premium differs
from `baseAmount`, it has a first-purchase multiplier, it is empty, or a SKU repeats.

**One-time packs.** `CatalogPack.oneTime` marks a pack sold once per player. Migration
`0018_purchase_one_time_packs` adds two append-only facts to `purchase_transactions` (never updated in place; the
ledger fence still refuses UPDATE/DELETE):

- `one_time BOOLEAN NOT NULL DEFAULT false`: this row owns the pack. Only a **paid** purchase whose grant was
  minted owns it (CHECK `purchase_transactions_one_time_owner`); a partial unique index
  `purchase_transactions_one_time_once (player_key, sku) WHERE one_time` is the second fence behind the player
  lock that `purchases.verify` already takes.
- `duplicate_of BIGINT`: a later receipt (paid, sandbox or unclassified) for a pack the player owns, pointing at
  the owning row. It grants nothing (CHECK `purchase_transactions_duplicate_grants_nothing`), is returned as
  `PurchaseRecord.duplicateOf`, completes with the provider (`completion: ready`, since nothing will ever be
  delivered for it and support refunds the recorded row), and is left out of the `paid_count` fact.

Sandbox deliveries (with `mintSandbox: 'on'`) mint the bundle every time and never own the pack, so QA can buy the
starter kit repeatedly and a real purchase afterwards still grants. Both CHECKs are added `NOT VALID` (every
existing row satisfies them trivially; new rows are checked). The file is declared N-1 compatible with ordinal
17: the 0017 image never writes either column and boots `ahead`. During such a rollback the old image does not
know one-time packs and could deliver a second copy; that window is accepted and the rows remain visible.

**Ownership query.** `GET /v1/purchases/owned` → `{oneTime: string[]}`: the SKUs of this player's owning rows.
The client reads it immediately before a one-time checkout (next to the `/purchases/mine` + `/config` preflight
of ADR-024) and refuses to open checkout when it fails or lists the SKU. No new state: it reads `one_time`.

**Subscriptions** are a core feature (`packages/server/src/features/subscriptions/{contract,server,client}.ts`,
ADR-013 shape). `POST /v1/subscriptions/verify {commandId, subscriptionsSigned}` is a stateless player command
(idempotency `none`, no transaction, bucket `subscriptions`, like `names.check`): the payments provider's
`SubscriptionsVerifier` (`@foundation/jest-verify`, same secrets and `PAYMENTS_PROVIDER` as receipts) checks
HS256 (alg pinned), `aud` = `GAME_ID`, `sub` = the authenticated player, `iat` present (`no_iat`) and within
`subscriptions.maxAgeSec` (default and ceiling 24 h, 5 min future skew; `stale`). The answer is one entitlement per
SKU in `GameConfig.subscriptions.skus` (other SKUs dropped; a SKU missing from the list is `active: false`,
`status: null`), with the signed terms (price, currency, billing period, trial eligibility, retention offer) and
the list's `issuedAt` for the client's offline grace. A SKU is `active` only when Jest signed it `active`, and a
sandbox one only where the game delivers sandbox purchases (`purchases.mintSandbox: 'on'`, the same owner gate as
ADR-024's amendment). Refusals are `200 {outcome: 'rejected', reason}`; no secret is `503 not_configured`.
Nothing is stored: perks are the game's, and any reward a perk pays (daily gems, drydock finishes) is applied by
the client like any other game state or minted as a grant by a future server feature.

`features.subscriptions` turns the route on and needs `subscriptions.skus`. The template game enables it with a
demo SKU so route coverage stays complete.

## Consequences

- Games can sell bundles and one-time packs without game-specific server code; the catalog stays the only
  description, and boot refuses a bundle the game could not apply.
- `purchase_transactions` keeps one row per provider token; refunds of duplicate one-time payments are found by
  `duplicate_of IS NOT NULL` and handled with the existing adjustments path.
- The classification enum and its CHECK are unchanged, so older readers of `/purchases/mine` keep validating.
- Subscriptions add no table and no retention duty. A cancelled subscription stops paying as soon as the client
  re-reads a fresh list (on every boot) and at the latest when its last verified list ages out of the game's
  offline grace (Warp Crew: 72 h).
- Open for the owner: whether sandbox subscriptions should have their own switch instead of following
  `mintSandbox`; whether duplicate one-time payments should be refunded automatically.
