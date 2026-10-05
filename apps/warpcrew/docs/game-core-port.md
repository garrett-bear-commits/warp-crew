# Porting Warp Crew onto game-core

Started 2026-10-05 on branch `claude/game-core-port`.

## Where things are

- Root: `game-core` imported from `https://github.com/0xJaeger/game-core.git` at commit
  `9fb869b0e47573f1506ded896b8c4bd2772e334c` (main, "Document the production-game sync", 1 Oct 2026), merged with
  its history so later core updates arrive with `git fetch <core> main && git merge FETCH_HEAD`.
- `apps/warpcrew/`: the whole game as it was at `claude/hud-overhaul@adacae2` (client, sims, QA scripts, docs,
  art, and the legacy save server in `apps/warpcrew/server/`). Every path inside it is unchanged, so its scripts
  run from that folder: `corepack pnpm -F @warpcrew/client test` (and `test:loop`, `test:ship`, `test:first-play`,
  `test:balance`, `build`, `build:pages`).
- `apps/warpcrew` is excluded from the core's ESLint and Prettier until each part is ported (it is plain JS).
- `apps/template-game` and `apps/idle-civ` stay as references until Warp Crew replaces the surfaces they show.

## What the core already gives Warp Crew

| Warp Crew today (`apps/warpcrew/server`) | Core |
|---|---|
| HS256 Jest player token check | `identity` + `packages/jest-verify` |
| Insert-only save log, refused writes kept, newest-progress wins | `saves` (append-only, server sequence, generations, quarantine, restore) |
| Receipt verification, token-unique ledger, sandbox gate | `purchases` (facts, adjustments, ledger, `mintSandbox` ADR-024) |
| Purchase SKUs returned with the current save for merges | grants + inbox delivery |
| Client dirty-flag upload and two-device merge (`src/shared/cloud.js`) | `packages/client` sync, boot reconciliation, restore gate, multi-tab leader |
| None | admin inspector, Sentry/PostHog, build records, rate limits, outbox, jobs, health |

## Gaps the core must grow (upstream-worthy; Cairndeep and Wild West Demons benefit)

All four are closed in stage 2 ([ADR-035](../../../docs/adr/ADR-035-bundles-one-time-packs-subscriptions.md)); see
"Stage 2, done" below for the shape each took.

1. **Bundle packs.** `CatalogPack` grants only `baseAmount` premium currency. Warp Crew packs grant gems, fuel,
   medals, credits and drydock finishes. Extend the catalog entry with a grant list in the game's grant vocabulary.
2. **One-time packs.** The starter kit and the five wall packs sell once per player; a second payment is recorded
   for refund (`duplicate_one_time`), never granted.
3. **Subscriptions.** Captain's Commission (`wc_sub_commission`): verify Jest's signed subscription list (`iat`
   under 24 h, `sub` is the player), return entitlements, no storage; perks re-read on boot, 72 h offline grace.
4. **Ownership query before checkout** (`GET /v1/purchases/owned` today) so a one-time pack bought on another
   device is never charged twice.

## Stages

1. **Import (done here).** Core merged, game moved, all game suites and the core's fmt, lint, typecheck, build,
   guards and unit tests pass.
2. **Server (done 2026-10-05, see below).** `apps/server/games/warpcrew/` (config, policy over the Warp Crew save,
   grant vocabulary for gems, credits, medals, fuel and drydock finishes), the core gaps above with migrations and
   pg tests, and the legacy server's tests replayed against the core server.
3. **Client.** Wrap the existing session loop as the core engine (`apply` = `sessionAction`, codec =
   `migratePlayer`, `progressOf` from lifetime progress), and replace `src/systems/save.js`,
   `src/shared/cloud.js` and the purchase bridge with `@foundation/client` storage, sync, identity and purchases.
   The plain-JS UI stays; only the save, identity and purchase plumbing moves.
4. **Cut-over.** Railway runs `apps/server` with `GAME_CONFIG=warpcrew`, a migration of the legacy save and
   purchase tables, staging checks, then retire `apps/warpcrew/server`.

Nothing ships to players and no production minting is enabled until stage 4's staging checks pass and the owner
approves (`purchases.mintPremium` stays `off`).

## Stage 2, done (2026-10-05)

### The game on the core server: `apps/server/games/warpcrew/`

- `game.config.ts`: features `purchases`, `grants`, `subscriptions`, `telemetry` (identity and saves are always
  on; achievements, leaderboards, inbox, liveops, journal and qa are off). Catalog: the 11 SKUs of
  `src/data/products.js` (five gem packs as plain premium packs with no first-purchase bonus; the starter kit and
  five wall packs as one-time bundles), subscription SKU `wc_sub_commission`, origins `https://jest.com`,
  `https://*.jest.com` and `https://garrett-bear-commits.github.io`, `knownSchemaVersions` 1..9,
  `maxProgressPerHour` 600, `purchases.mintPremium: 'off'`. Deploy with `GAME_ID=<Jest game UUID>` and
  `GAME_CONFIG=warpcrew`.
- `policy.ts`: reads the player in the core codec envelope `{schemaVersion, state}`, the legacy
  `{player, savedAt}` wrapper or bare; refuses anything without an integer `version >= 1` and a `wallet` object
  (numeric balances, object `stats`); schema = `player.version`; summary `progress, gems, credits, medals, fuel,
  jumps, combatsWon, contractsCompleted, chapter`; `anomalyKeys` gems, credits, medals; `sanitizeForQa` replaces
  the captain name and empties `pendingReceipts`, `iapFulfilled`, `purchaseSkus` and `cloudSeq`.
- **`progressOf`** (exported from `policy.ts`; stage 3's engine must send exactly this):
  `stats.jumps + stats.combatsWon + stats.expeditions + stats.contractsCompleted`, each floored, non-negative and
  capped at 2^40, so the sum is a safe integer. It never decreases: the game only increments these four counters
  (`travel.js`, `travelEvents.js`, `contracts.js` on every claimed contract won or lost, `expedition.js`),
  `migratePlayer` merges saved stats over zero defaults, and the only reset (a restart) is a new player, which the
  core records as a new generation. Balances, hull, crew, flags and ship system levels are left out (they move
  both ways, or could after a future refit). `summaryPlausible` quarantines a write whose claimed progress is
  deeper than the blob's.
- `grants.ts`: gems (premium, max 3,500), credits (12,000), medals (280), fuel (10), drydock finishes (item
  `drydockFinishes`, field `drydock-finishes`, max 3); each maximum is the most one product grants.
- Registry entry in `apps/server/src/games.ts`; the admin inspector's `game-grants.ts` points at the Warp Crew
  vocabulary (the inspector's own tests keep the template's via `vi.mock`).

### The core gaps (ADR-035)

| Gap | Shape |
| --- | --- |
| Bundle packs | `CatalogPack.rewards: GrantReward[]`; one delivery mints exactly those as one `purchase:<sha256(token)>` grant; `baseAmount` = the bundle's premium (`granted`); boot refuses a bundle outside the grant vocabulary (`gameConfigProblems`). |
| One-time packs | `CatalogPack.oneTime`; migration `0018_purchase_one_time_packs` adds `purchase_transactions.one_time` (the minted paid row that owns the pack; unique per player and SKU) and `duplicate_of` (a later receipt, granted nothing, `PurchaseRecord.duplicateOf`, completion `ready` so Jest stops re-offering it; support refunds it). Sandbox purchases never own a pack. Append-only; N-1 compatible with 0017. |
| Ownership query | `GET /v1/purchases/owned` → `{oneTime: string[]}` (`purchasesClient(api).owned()`). No answer, no checkout. |
| Subscriptions | Core feature `subscriptions`: `POST /v1/subscriptions/verify {commandId, subscriptionsSigned}` → `{outcome, reason?, issuedAt?, subscriptions: [{sku, active, status, sandbox, trialEligible, retentionOffer, price, currency, billingPeriod}]}`, one entry per configured SKU. HS256 with the Jest secrets, `aud`, `sub` = caller, `iat` required and < 24 h. Stateless (no table, idempotency `none`). Sandbox subscriptions are active only with `purchases.mintSandbox: 'on'`. Refusals are `200 rejected` (legacy: 400). |

### Tests

- `apps/server/test/unit/warpcrew-policy.test.ts`: current (all three wrappers), old (v4), malformed,
  future-schema and QA-import fixtures from `createNewPlayer`/`migratePlayer`; progress monotone under migration;
  boot check of the config; vocabulary refusals.
- `apps/server/test/unit/warpcrew-parity.test.ts`: `products.js` SKUs (same order), one-time flags, titles and
  grants equal the catalog; subscription SKUs equal; the vocabulary covers exactly the grant keys `products.js`
  uses, each maximum the largest product grant.
- `apps/server/test/pg/warpcrew.test.ts`: `server/test/server.test.js` replayed on the core server with real
  HS256: identity (malformed, forged, wrong game, wrong player, stale), saves (server seq, refused writes stored,
  a conflict keeps the deeper save, malformed refused, future schema and inflated progress quarantined, legacy
  wrapper read, players isolated), minting off (paid withheld, sandbox never owns), purchases (gem pack once,
  replay, forged/foreign/other-player/`alg: none`, starter kit bundle once then `duplicateOf`, wall pack
  rewards, unknown SKU, refused sandbox never owns, batch, a three-way race grants once, ledger fence and unique
  owner index), sandbox delivery on (delivers, never owns, then a paid one owns), subscriptions (active, missing,
  lapsed, `no_iat`, other player, forged, foreign, stale, checkout proof, sandbox gate, stores nothing), no secret
  fails closed.
- Core: `packages/server/test/unit/bundles-subscriptions.test.ts`, `packages/jest-verify/test/subscriptions.test.ts`,
  `packages/server/test/pg/infra.test.ts` (0017 image boots on 0018).

### Behaviour that differs from the legacy server (stage 3 must adapt the client)

- Saves: deepest-wins (`progressOf`) instead of "any write from a stale base is `stale_base`". A stale but deeper
  save is anchored with `divergent`; a shallower one is `stored_refused progress_regression`. The client's
  `chooseSave`/archive dance becomes the core sync's reconcile and generations.
- Purchases: the response is `outcome`/`completion` + a `PurchaseRecord`, and the reward arrives as a grant to
  claim (`/v1/grants/pending`, `/v1/grants/claim`), not a `grant` object; the "purchases not yet delivered" list
  and `purchaseSkus` provenance are replaced by grants (a claimed grant is delivered; unclaimed ones show on any
  device). A receipt for another player is `200 rejected sub_mismatch` (legacy 403). Unclassified receipts (no
  valid price/currency) are recorded but never granted (legacy granted them). Price 0 without `sandbox: true` is
  unclassified, not sandbox: only the signed `sandbox` flag classifies sandbox (ADR-024).
- Subscriptions: body field `subscriptionsSigned` (legacy `signed`); `issuedAt` is on the response, not on each
  entitlement; every configured SKU is answered (absent = `active: false, status: null`).
- Headers: `x-player-key` (legacy `x-player-id`).

### Left for later stages, and decisions a human must make

- **Minting.** `mintPremium` and `mintSandbox` stay `off` until real Jest receipts are validated in Lab and the
  owner approves (ADR-024). With minting off no paid pack is delivered, so stage 3 cannot ship to players before
  that decision.
- **Sandbox subscriptions** follow `mintSandbox`; the owner may want a separate switch.
- **Legacy data at cut-over (stage 4).** `save_events` (insert-only, `player_key` = Jest player id) and
  `purchase_transactions` (legacy schema) live in the legacy database. Proposed: import each player's newest
  accepted save as generation 0 seq 1 (`progress` = `progressOf`, `schemaVersion` = `player.version`) through a
  one-off admin import, keep refused/archived rows in cold storage rather than the core ledger; import legacy
  granting purchases as `purchase_transactions` rows with `source = 'financials_import'` (classification `paid`
  or `sandbox`, `granted` = the gem part) and keep `duplicate_one_time` rows as `duplicate_of` rows. One-time
  ownership must survive so `/purchases/owned` stays right, but `one_time = true` requires a minted grant (CHECK
  `purchase_transactions_one_time_owner`): either mint each legacy pack's grant and record it already claimed
  (a `grant_claims` row, so it is never delivered twice), or add a migration that also accepts
  `source = 'financials_import'` owners without a grant. Pick one before the import is written.
  Purchases already applied to a save (`delivered_seq` / `iapFulfilled`) must not become claimable grants;
  undelivered ones need an explicit make-good grant per player. Needs the owner's sign-off and a dry run on a
  copy.
- **Admin CLI** (`scripts/admin.mjs`) still points at the template vocabulary (its tests assert gold); switch it
  to `games/warpcrew/grants.ts` with the cut-over.
- **liveops off**: kill switches still work, but there is no `/config` route; turn `liveops` on if the client
  adopts the template's checkout preflight (`/purchases/mine` + `/config`) or min-build gating.
- **Real Jest gates**: confirm signed subscription lists carry `iat` (the legacy README flagged it), and that
  receipts carry `price`/`currency` (else they are unclassified).
