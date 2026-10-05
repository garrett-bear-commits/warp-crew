# Capacity note (§8, §9)

Assumed 1k-DAU game: ~1 save/min/active player at 60 s timer + autosaves ⇒ ≈ 17 writes/s peak (5× spike ≈ 85/s, 20× ≈ 340/s). Each write is one transaction under the player advisory lock (bounded by `lock_timeout` 3 s), one INSERT into `save_snapshots`, one into `save_blobs` (~13 KB), one outbox row. With the client's routine save cadence (one push per `routinePushMs` window, default 12 s, while state changes; `packages/client/src/sync/client.ts`), a playing client pushes far more often than once a minute: a production game measured ≈ 0.073 writes/s per playing session, so 17 writes/s is about 240 concurrently playing players rather than 1,000.

Storage: append-only blobs are the unbounded cost; retention (`prune_save_blobs`: newest 20, one/day for 30 d, deepest per generation for the last 3 generations, purchase-bearing, pending quarantine, anchor) caps a player at ≈ 650 KB. Refused blobs: first 5/hour per player.

Postgres: `postgres:16`, pool `PG_POOL` per API process (unset: 20 when `GAME_ENV=prod`, 8 elsewhere; `config.ts defaultPgPool`). A scheduled job holds two connections (its advisory-lock transaction and its queries), at most two scheduled jobs run at once per process plus the outbox drain, and requests use the rest; size `replicas × PG_POOL` plus the migrator and admin sessions under the server's `max_connections`. The hot read is the anchor query (indexed by `(player_key, generation, progress DESC, seq DESC)` on anchored/quarantined rows). The scariest query (distinct anchors) runs at boot to keep its plan honest. Rate limits live in Postgres in prod (`RATE_LIMIT_STORE=pg`), so a write also updates its per-player and per-IP windows.

## Load test

`scripts/load/sessions.js` (k6). Each VU is one synthetic player playing sessions the way a hosted client does on the core routes: boot (`/v1/config`, current save, purchases, pending grants), a save every 10-15 s through a session (`SESSION_S`, default 600 s), a head check about every 5 min, a teardown beacon, then 30-120 s away. No analytics or error-reporting traffic. One VU averages ≈ 0.073 writes/s:

| Size | Writes/s | VUs |
| --- | --- | --- |
| 1× | 17 | 240 |
| 5× | 85 | 1,200 |
| 20× | 340 | 4,700 |

Thresholds: save p95 < 300 ms (`slo.md`), boot p95 < 500 ms, under 1 % failed requests. Environment (`scripts/load/common.js`): `BASE_URL` (default a local API; through a web origin that proxies the API, `https://<origin>/api`), `GAME_ID` and `JEST_JWS_SECRET_B64` (tokens minted like Jest's; unset: mock tokens for a local mock-identity server), `SAVE_FILE` (a save the game's policy accepts; default a fresh template save), `BUILD_VERSION`, `RUN_ID`, `VUS`, `DURATION`, `RAMP`. Synthetic players and their saves stay in the target database, so never point it at production: a `BASE_URL` naming prod/production is refused. Never print or commit the signing secret.

- **Smoke** (one player): `k6 run -e BASE_URL=http://127.0.0.1:8080 -e SESSION_S=20 scripts/load/sessions.js`. Through a public origin, one source address is capped by the per-address limits (API 1,200 writes/min per IP, plus any proxy limits).
- **5× and 20×**, inside the deployment's private network: run `scripts/load/Dockerfile` as a temporary service with `BASE_URL` at the API's private address and `SPREAD_IPS=1` (a distinct `X-Forwarded-For` per VU; the API trusts one proxy hop). Watch `/health/ops` `commands.p95Ms`, Postgres CPU and connections; delete the service afterwards. Thousands of VUs need several GB: split `VUS` across replicas if one container cannot hold them.
- **Same-player race** (`scripts/load/save-race.js`): each round, a fresh synthetic player gets `DISTINCT` (8) distinct and `DUPES` (4) duplicate saves in one parallel batch; fails on any 5xx or 429, a shared seq, duplicates that split or anchor twice, or a head that is not the highest seq. Run it with 2+ API replicas to prove the per-player lock holds across them.

Bench plan (§9): the load test above at 1×/5×/20× against Lab, a spike, a monthly 2 h soak; nightly p95 threshold from `/health/ops`. Not yet run at load from this repository (needs a deployed Lab); tooling `check-health --assert` provides the assertion surface.

## Evidence

From a production game on this core (1 October 2026), indicative only: on a local Docker Postgres with one API process, 40 simulated sessions gave save p95 1.1 s at `PG_POOL=8` and 282 ms at `PG_POOL=20`. On its staging (2 API replicas), a same-player race of 360 parallel writes (8 distinct + 4 duplicate saves per fresh player, 30 rounds) produced 0 shared seqs, split duplicates, head mismatches or errors, so the per-player lock holds across replicas; a 60-VU, 5-minute session run had save p95 77 ms, boot p95 70 ms and no failed request.
