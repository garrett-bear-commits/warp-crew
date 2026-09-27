# Warp Crew save and purchase server

Authority for two things the browser cannot be trusted with:

- **Purchases.** `POST /v1/purchases/verify` accepts only the signed Jest receipt (`purchaseSigned` from `beginPurchase`, or `purchasesSigned` from `getIncompletePurchases`). The server checks the HS256 signature, the game id and that the receipt belongs to the calling player, then chooses the grant from `src/data/products.js`. The purchase token is unique in the ledger, so replays never grant twice. One-time packs (starter kit, wall packs) grant once per player; a second payment is recorded as `duplicate_one_time` for support to refund. Signed price 0 is recorded as `sandbox`.
- **Cloud saves.** `PUT /v1/saves` appends to an insert-only log with a server-assigned sequence; refused writes are kept for recovery. `GET /v1/saves/current` returns the newest accepted save plus every granting purchase, so a device can catch up on purchases it never saw.

Every request carries `x-player-id` and `authorization: Bearer <JestSDK.getPlayerSigned().playerSigned>`.

## Client flow

The game talks to the server only when one is configured (`?server=<url>` on the QA link, remembered, or `VITE_WARPCREW_SERVER` at build time). Then: a purchase's signed receipt is saved locally first, verified by the server, granted, saved again, and only then completed with Jest. If the server is unreachable the receipt waits in the save and Jest keeps the purchase incomplete; both retry on the next boot. Without a server the Pages QA build keeps its local mock purchases.

## Run locally

```bash
# a throwaway Postgres 16, then:
DATABASE_URL=postgres://postgres@localhost:5434/warpcrew PGSSL=off WARPCREW_DEV_AUTH=1 npm run server
TEST_DATABASE_URL=postgres://postgres@localhost:5434/warpcrew_test PGSSL=off npm run test:server
```

`npm run test:server` drops and recreates its tables. Point it only at a throwaway database.

## Railway setup (its own project)

1. New Project → Deploy from GitHub repo → `warp-crew` (root directory empty: the server imports `src/data/products.js`). `railway.json` sets start command and health check.
2. New → Database → Add PostgreSQL. On the service, set `DATABASE_URL` as a reference to it.
3. Variables: `JEST_PLAYER_SECRET` (the base64 shared secret from the Jest Developer Console), `JEST_GAME_ID`, and `ALLOW_ORIGINS` (comma-separated game origins, e.g. the Jest and Pages hosts).
4. `WARPCREW_DEV_AUTH=1` trusts `x-player-id` with no token. Use it only for a first QA without Jest; **never** where real players can reach it.
5. Settings → Networking → Generate Domain; build the game with `VITE_WARPCREW_SERVER=<that URL>`.

Migrations run on boot.

## Facts about Jest tokens (from Ninefold/Barrowdeep)

HS256 with a symmetric, base64-encoded secret; no JWKS; no `exp` on player tokens (freshness from `iat`, 24 h); check `aud` and the player. The Simulator's `mock-signed-player-jwt` never verifies.
