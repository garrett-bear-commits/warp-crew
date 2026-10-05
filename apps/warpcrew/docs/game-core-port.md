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
2. **Server.** `apps/server/games/warpcrew/` (config, policy over the Warp Crew save, grant vocabulary for gems,
   credits, medals, fuel and drydock finishes), the three core gaps above with migrations and pg tests, and the
   legacy server's tests replayed against the core server.
3. **Client.** Wrap the existing session loop as the core engine (`apply` = `sessionAction`, codec =
   `migratePlayer`, `progressOf` from lifetime progress), and replace `src/systems/save.js`,
   `src/shared/cloud.js` and the purchase bridge with `@foundation/client` storage, sync, identity and purchases.
   The plain-JS UI stays; only the save, identity and purchase plumbing moves.
4. **Cut-over.** Railway runs `apps/server` with `GAME_CONFIG=warpcrew`, a migration of the legacy save and
   purchase tables, staging checks, then retire `apps/warpcrew/server`.

Nothing ships to players and no production minting is enabled until stage 4's staging checks pass and the owner
approves (`purchases.mintPremium` stays `off`).
