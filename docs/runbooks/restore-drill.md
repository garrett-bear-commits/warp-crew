# Restore drill (PITR + restore verify)

Weekly (automated): the `live.integrity` job samples the newest anchored blobs of the LIVE database, re-hashes them and writes `ops_markers.live_integrity_verified_at` (`/health/ops` → `liveIntegrityVerifiedAt`). It says nothing about backups: `restore_verified_at` (`/health/ops` → `restoreVerifiedAt`, warn when older than 10 days) is written only by step 6 below.

Quarterly (manual, Lab first):
1. Create a fresh database from a PITR point (managed Postgres console) → note `{game, env, takenAt}`.
2. Write a manifest: `pnpm foundation manifest-write --game <id> --env lab --schema-head <head> --out /tmp/manifest.json`.
3. Validate the destination before ANY write: `pnpm foundation manifest-check --manifest /tmp/manifest.json --game <id> --env lab` (refuses on mismatch — that is the whole point).
4. Export the erasure tombstones from the LIVE database: `DATABASE_URL=<live> node --experimental-strip-types apps/server/src/cli/dr.ts export-erasures --out /tmp/erasures.jsonl --game <id> --env lab`.
5. Verify the restored copy in isolation and replay the erasures into it: `node --experimental-strip-types apps/server/src/cli/dr.ts verify-restore --restored-url <restored-db-url> --manifest /tmp/manifest.json --game <id> --env lab --erasures /tmp/erasures.jsonl` (checks manifest vs destination, schema head, anchored blob hashes, anchor query; exit 1 on any problem).
6. Only when step 5 passed, mark the live database: append `--mark` with `DATABASE_URL=<live>` — this is the only path that writes `restore_verified_at`.
7. Point a scratch server at the restored DB with `GAME_ID/GAME_ENV` of the destination; `pnpm migrate --status` must be at head; `pnpm foundation check-health --url <scratch> --assert page`; canary read/write with a `qa_` identity (`POST /qa/v1/identity/mint`, PUT /v1/saves) and confirm `GET /v1/saves/current` returns it.
8. Record RPO/RTO observed in the drill log; update `docs/slo.md` if the objective moved.
