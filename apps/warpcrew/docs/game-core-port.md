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
3. **Client (done 2026-10-05, see "Stage 3, done").** The session loop wrapped as the core engine
   (`apply` = `sessionAction`, codec = `migratePlayer`, `progressOf` equal to the policy's), and
   `src/systems/save.js`, `src/shared/cloud.js` and the purchase bridge replaced with
   `@foundation/client` storage, sync, identity and purchases. The plain-JS UI stays.
4. **Cut-over.** Warp Crew has no players yet (the owner is the only playtester), so there is no
   legacy save or purchase migration and no make-good grants: Railway runs `apps/server` with
   `GAME_CONFIG=warpcrew` on a fresh database, the staging checks pass, the client build points
   `VITE_WARPCREW_SERVER` at it, and `apps/warpcrew/server` (the legacy save server and its tests)
   is deleted.

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
- **Legacy data at cut-over (stage 4).** Superseded 2026-10-05: the owner confirmed Warp Crew has
  no players, so the cut-over starts from a fresh core database and nothing is migrated from the
  legacy `save_events` or `purchase_transactions` tables (see the Stages list).
- **Admin CLI** (`scripts/admin.mjs`) still points at the template vocabulary (its tests assert gold); switch it
  to `games/warpcrew/grants.ts` with the cut-over.
- **liveops off**: kill switches still work, but there is no `/config` route; turn `liveops` on if the client
  adopts the template's checkout preflight (`/purchases/mine` + `/config`) or min-build gating.
- **Real Jest gates**: confirm signed subscription lists carry `iat` (the legacy README flagged it), and that
  receipts carry `price`/`currency` (else they are unclassified).

## Stage 3, done (2026-10-05)

The Warp Crew client runs on `@foundation/client`. The UI stays plain JS (string rendering in
`src/ui/bridge.js`); only the framework-agnostic parts of the core client are used (no
`@foundation/client/react`).

### What moved: `apps/warpcrew/src/core/`

| Module | What it is |
| --- | --- |
| `engine.js` | The core `Engine`. State = the Warp Crew player. Actions: `session` (runs `sessionAction` with the core's seeded sim stream and `ctx.now`, returning the transition as an effect), `grant` (the single grant path), `prepare` (`tickCrewStatus` + `prepareSession` at the trusted now), `set` (a player computed by the UI's remaining direct handlers: hiring, hangar, fuel, subscription perks, daily login; refused when the server would refuse its shape or when it is shallower than the current player). `progressOf` and `summary` from `progress.js`. |
| `progress.js` | `progressOf`, `summaryOf` and `isWarpcrewPlayer` mirrored from `apps/server/games/warpcrew/policy.ts` (including the stage 2 audit's crew, ship and `MAX_LIFETIME_COUNTER` checks). `apps/server/test/unit/warpcrew-client-parity.test.ts` holds them equal on 400 generated players. |
| `codec.js` | `defineSave` at schema 9 (read from `createNewPlayer().version`, the `player.version` the policy records). Migrations 1..8 pass through and `decode` runs `migratePlayer`, which already reads every older player and stamps 9 (it must see the original version for the veteran rule). Drops the legacy client's `cloudSeq`, `cloudDirty`, `lastSavedAt`, `pendingReceipts`, `purchaseSkus`. |
| `grants.js` | `applyGrantRewards`: the one function a reward reaches the player through (server grants, and the local-mock checkout). Vocabulary exactly `games/warpcrew/grants.ts`: `premium_currency` → gems, `soft_currency` credits/medals/fuel (fuel clamps to the tank), `item:drydockFinishes`; anything else is reported and not applied. A purchase grant (`reason: "purchase <sku>"`) for a one-time SKU marks it owned. |
| `purchases.js` | Buy: one-time packs ask `GET /v1/purchases/owned` first (no answer → `store_unavailable`, owned → marked owned, no checkout); `payments.begin` → `POST /v1/purchases/verify` → claim the minted grant → apply → immediate save → `payments.complete`. `duplicateOf` marks the pack owned and completes. Boot: `recoverIncompleteBatch` → `verify-batch`, pending grants claimed (purchases from any device), ownership refreshed. With no server the core mock checkout grants the products.js rewards on the device. |
| `client.js` | Composition root: `createGameClient` (storage, boot reconciliation, sync, restore gate, generations, multi-tab leader, journal `errors_only`), the platform, the API, purchases, the subscription verifier, `boot({fresh})`, `restart()`, `session/commit/prepare/applyGrant/save`. No DOM, so node tests and the pg end-to-end test run the same code the browser does. |
| `platform.js` | `jest` (core Jest provider: signed player token, payments, KV mirror) only inside the Jest shell **and** with a server configured; it shares Warp Crew's single `JestSDK.init`. Everywhere else the core mock provider (exactly as the template), signed `sandbox: true` purchases, Warp Crew's mock catalog in cents. |
| `api.js` | `createApi` with `x-player-key` + bearer token + build version; feeds every `serverNow` to the core clock. Purchases, grants and `POST /v1/subscriptions/verify` (`subscriptionsSigned`). |
| `config.js` | `VITE_WARPCREW_SERVER` compiled in (https, or http on loopback); `?server=` (and `?server=off`) and `?player=` only in dev builds, and a production build clears a remembered override. No server → offline. |
| `legacy.js` | The one-time import of the pre-port localStorage save `warpcrew.save.v2` (kept because it is a few lines and preserves the owner's QA progress): imported when at least as deep as the core's player, then moved to `warpcrew.save.v2.imported`. `clearLocalSaves` for `?fresh=1` and the offline restart. |

Elsewhere: `src/shared/time.js` (`trustedNow` = the core clock: server-anchored once online),
`src/ui/coreOverlay.js` (keep-this-device / use-cloud prompt, cloud unreachable, update required,
"Play here" for a second tab), `src/main.js` (boot creates the client; every change goes through
`session` or `commit`; purchases through `purchases.buy`; Jest sign-in through the core identity
in Jest mode; a dev-only `globalThis.__warpcrew` for QA).

Saves: ordinary changes `requestSave('routine')` (device slot at most every 1 s, cloud at most every
12 s, leading and trailing); purchases, grants, legacy import, contract claims, story chapters, wall
breaks, the intro's end and a one-time ownership change are `'immediate'`. Online, the core's
teardown beacon covers page hide; offline (no beacon) the game saves the slot on hide/pagehide.
Restart: online a new server generation (`restartJourney`), offline the device's slots are cleared;
then reload. `?fresh=1` does the same at boot.

Subscriptions: `subscription.js` is unchanged except its verifier is the core route; the 72 h
offline grace, perks and fuel-cap rules are the same, and `issuedAt` comes from the response.

### What was removed

`src/systems/save.js`, `src/shared/cloud.js`, `src/systems/cloudSync.js` (chooseSave, carry
purchases, ledger), the receipt staging and local grant paths of `src/systems/iap.js` (it keeps
`ownsOneTime` and `listShopProducts`), the legacy purchase calls and `getPlayerSigned`/`cloudData`
in `src/shared/platform.js`, and `server/test/client-sync.test.js` (the legacy client against the
legacy server; `test:server` now runs `server.test.js` only, until stage 4 deletes `server/`).

### Scheduling decision

Warp Crew keeps its own real-time scheduling. The engine has no `step` or `onGap`: the stage loop
animates, the guided beat scheduler dispatches ordinary `session` actions on its own tempo (it now
also pauses while another tab plays), and timed systems (fuel regen, drydock builds, injuries,
expeditions, offers) are computed from timestamps when read, through `prepare`. The core loop
therefore never ticks; it only applies dispatched actions (`tps: 1`, idle). Forcing a fixed-step sim
onto timestamp-based systems would change the game's balance for no gain, and offline time already
cannot raise progress (it never touches the four counters).

### Tests and results

New or ported in `apps/warpcrew/test`: `engine_conformance.test.mjs` (progress never decreases across
a scripted session through the core client; codec reads v1..v9 fixtures generated by each version's
own `createNewPlayer`, `test/fixtures/saves/`; shallower or malformed `set` refused), `cloud_sync`
(reload, legacy import once and never over deeper progress, `?fresh=1`, offline restart, follower tab
never writes, grant vocabulary, save priorities, subscription verify request), `platform_iap`
(offline mock checkout through the core), `audit_fixes` (no Jest payments without a server,
ownership before one-time checkout, `?server=` dev-only), `wall_packs`, `sanity`. In `apps/server`:
`test/unit/warpcrew-client-parity.test.ts` and `test/pg/warpcrew-client.test.ts` (the client modules
against the core server on Postgres: new player saves, reload keeps it, new device restores it, a
deeper second device wins with the dirty device prompted and the shallower save refused, a sandbox
purchase is withheld with minting off, the ownership query answers before a one-time checkout).

All exit 0 on 2026-10-05:

| Command | Exit |
| --- | --- |
| `corepack pnpm check` (fmt, lint, typecheck, build, guards, every package's tests including `@warpcrew/client test`, scripts) | 0 |
| `DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55442/foundation_test corepack pnpm test:pg` | 0 (18 files, 196 tests) |
| `corepack pnpm -F @warpcrew/client test` | 0 |
| `… test:loop`, `test:ship`, `test:first-play`, `test:balance` | 0 each |
| `… build`, `build:pages` | 0 each |

Browser (built-in browser, 375x812, dev build, no server): fresh start (`?fresh=1`) through captain,
first hire and the assign step; reload keeps the step; Shop opens, the New Captain's Kit shows
unowned, the local mock purchase applies 250 gems, 10 fuel, 50 medals and 800 credits, marks it
owned and the card disappears, and a reload keeps it; Sound toggles; Log tab shows the entries; a
second tab shows "Play here"; no console errors on three consecutive loads. Screenshots:
`docs/qa/mockups/stage3-0*.jpg`.

### Left for stage 4, and decisions for a human

- **Minting.** With minting off, a purchase against the core server is recorded and `withheld`
  (nothing delivered, Jest not completed). QA on a server needs `purchases.mintSandbox: 'on'` in Lab;
  real sales need `mintPremium: 'on'`. Both are owner decisions (ADR-024).
- **Real Jest in Lab.** Not exercisable locally: the core Jest provider sharing Warp Crew's SDK init,
  sign-in through `identity.login`, real signed receipts (price/currency present), and subscription
  lists carrying `iat`.
- **Purchase adjustments.** The client does not yet read `/v1/purchases/mine` pending adjustments
  (refunds); with `liveops` off there is no checkout preflight either. Add both if refunds must claw
  back gems.
- **Remaining direct handlers.** Hiring, hangar, fuel, luck, reserve and subscription perks still
  compute a player in `main.js` and commit it through `set`. Moving them into named engine actions
  would make the journal and replay finer-grained.
- **Notifications** still go through Warp Crew's SDK bridge, not the core retention coordinator.
- **Pre-existing, not changed:** in a plain browser the Jest CDN mock SDK answers `getProducts` with
  its own sample catalog, so local Shop rows show "Buy" without prices; `scripts/warp-crew-sanity.mjs`
  (run by no script) still expects save version 6.
- **Cut-over** (rewritten above): fresh core database, staging checks, then delete
  `apps/warpcrew/server`.
