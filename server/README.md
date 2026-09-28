# Warp Crew save and purchase server

Authority for two things the browser cannot be trusted with:

- **Purchases.** `POST /v1/purchases/verify` accepts only the signed Jest receipt (`purchaseSigned` from `beginPurchase`, or `purchasesSigned` from `getIncompletePurchases`). The server checks the HS256 signature, the game id and that the receipt belongs to the calling player, then chooses the grant from `src/data/products.js`. The purchase token is unique in the ledger, so replays never grant twice. One-time packs (starter kit, wall packs) grant once per player; a second payment is recorded as `duplicate_one_time` for support to refund. Signed price 0 grants only when `JEST_GRANT_SANDBOX=1` (set it only on a QA server); otherwise it is recorded as `sandbox_refused` and never counts as owning a one-time pack. Before a one-time checkout opens, the client asks `GET /v1/purchases/owned`; if the server does not answer, no checkout opens, so a pack bought on another device is never charged twice.
- **Subscriptions.** `POST /v1/subscriptions/verify` takes Jest's signed subscription list (`signed` from `getSubscriptions`, or `subscriptionSigned` from checkout or a retention claim). The server checks the HS256 signature, the game id, that `sub` is the calling player, and that `iat` (when present) is under 24 hours old, so an old list cannot be replayed after a cancel. It returns each known subscription's entitlement. Nothing is stored. Sandbox subscriptions unlock only with `JEST_GRANT_SANDBOX=1`. The game re-reads the list on every boot. A verified entitlement keeps paying perks for 72 hours offline.
- **Merge provenance.** `GET /v1/saves/current` (and a save conflict) also returns `purchaseSkus`: the token→SKU record of every granting purchase, delivered or not, so a two-device merge can re-grant any purchase the winning save lacks.
- **Cloud saves.** `PUT /v1/saves` appends to an insert-only log with a server-assigned sequence; refused writes are kept for recovery. `GET /v1/saves/current` returns the newest accepted save plus every granting purchase, so a device can catch up on purchases it never saw.

Every request carries `x-player-id` and `authorization: Bearer <JestSDK.getPlayerSigned().playerSigned>`.

## Client flow

The game talks only to the server compiled in with `VITE_WARPCREW_SERVER` (HTTPS, or `http://localhost` for development). A `?server=<url>` override works only in development builds; no build flag re-enables it in production (a QA build compiles its staging server in with `VITE_WARPCREW_SERVER`), so a crafted link cannot redirect a player's Jest token. Then: a purchase's signed receipt is saved locally first, verified by the server, granted, saved again, and only then completed with Jest. If the server is unreachable the receipt waits in the save and Jest keeps the purchase incomplete; both retry on the next boot. In a real Jest environment with no server configured, purchasing is disabled and incomplete purchases wait: nothing is ever granted without verification. Only the local mock (no Jest) grants locally, for QA.

Saves: a local save is dirty until uploaded. The server refuses (stores, never makes current) any write based on an older save than the current one and returns the current save; the device then keeps whichever side has more progress and archives the other. A purchase is *delivered* once an accepted save contains its token; delivered purchases are never handed back, so editing the save cannot re-grant them.

## Run locally

```bash
# a throwaway Postgres 16, then:
DATABASE_URL=postgres://postgres@localhost:5434/warpcrew PGSSL=off WARPCREW_DEV_AUTH=1 npm run server
TEST_DATABASE_URL="postgres://postgres@localhost:5434/warpcrew_test?sslmode=disable" npm run test:server
```

`npm run test:server` drops and recreates its tables. Point it only at a throwaway database.

## Railway setup (its own project)

1. New Project → Deploy from GitHub repo → `warp-crew` (root directory empty: the server imports `src/data/products.js`). `railway.json` sets start command and health check.
2. New → Database → Add PostgreSQL. On the service, set `DATABASE_URL` as a reference to it.
3. Variables: `JEST_PLAYER_SECRET` (the base64 shared secret from the Jest Developer Console), `JEST_GAME_ID`, and `ALLOW_ORIGINS` (comma-separated game origins, e.g. the Jest and Pages hosts; **required** — with none set, browsers cannot call the server). `JEST_GRANT_SANDBOX=1` only on a QA server.
4. `WARPCREW_DEV_AUTH=1` trusts `x-player-id` with no token. Use it only for a first QA without Jest; **never** where real players can reach it. The server refuses to start with it unless `NODE_ENV=development`, and refuses to start at all without a valid `JEST_PLAYER_SECRET` (base64, >= 16 bytes) and `JEST_GAME_ID`.
5. Settings → Networking → Generate Domain; build the game with `VITE_WARPCREW_SERVER=<that URL>`.

Migrations run on boot.

## Facts about Jest tokens (from Ninefold/Barrowdeep)

HS256 with a symmetric, base64-encoded secret; no JWKS; no `exp` on player tokens (freshness from `iat`, 24 h); check `aud` and the player. The Simulator's `mock-signed-player-jwt` never verifies.

## Known limits (security model)

- **Premium balances live in the player's save.** The server is the authority for *purchases* (what was bought, one-time ownership, no double grants), not for spending. A player who edits their own local save can change their own gem count; that affects only their single-player game. Server-owned gem spending is the next step if gems ever feed leaderboards, trading or anything shared.
- **Timers use the server clock while online:** the last `serverNow` plus monotonic elapsed time (`performance.now()`), so changing the device clock mid-session does nothing. Before the first server response, or fully offline, only the device clock exists, so a player who changes their clock offline can finish their own builds early.
- **Merges never lose purchases:** when two devices conflict, the losing save's applied purchases are re-granted to the winner from the catalog (by token), and one-time ownership is merged.
