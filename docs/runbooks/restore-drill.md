# Restore drill (PITR + restore verify)

Weekly (automated): the `restore.verify` job samples the newest anchored blobs, re-hashes them and writes `ops_markers.restore_verified_at`; `/health/ops` warns when it is older than 10 days.

Quarterly (manual, Lab first):
1. Create a fresh database from a PITR point (managed Postgres console) → note `{game, env, takenAt}`.
2. Write a manifest: `pnpm foundation manifest-write --game <id> --env lab --schema-head <head> --out /tmp/manifest.json`.
3. Validate the destination before ANY write: `pnpm foundation manifest-check --manifest /tmp/manifest.json --game <id> --env lab` (refuses on mismatch — that is the whole point).
4. Point a scratch server at the restored DB with `GAME_ID/GAME_ENV` of the destination; `pnpm migrate --status` must be at head; `pnpm foundation check-health --url <scratch> --assert page`.
5. Replay the erasure ledger (`erasures`) against the restored copy: `erase_player()` for every row newer than the restore point.
6. Canary read/write with a `qa_` identity (`POST /qa/v1/identity/mint`, PUT /v1/saves) and confirm `GET /v1/saves/current` returns it.
7. Record RPO/RTO observed in the drill log; update `docs/slo.md` if the objective moved.
