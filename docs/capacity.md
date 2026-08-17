# Capacity note (§8, §9)

Assumed 1k-DAU game: ~1 save/min/active player at 60 s timer + autosaves ⇒ ≈ 17 writes/s peak (5× spike ≈ 85/s, 20× ≈ 340/s). Each write is one transaction under the player advisory lock (bounded by `lock_timeout` 3 s), one INSERT into `save_snapshots`, one into `save_blobs` (~13 KB), one outbox row.

Storage: append-only blobs are the unbounded cost; retention (`prune_save_blobs`: newest 20, one/day for 30 d, deepest per generation for the last 3 generations, purchase-bearing, pending quarantine, anchor) caps a player at ≈ 650 KB. Refused blobs: first 5/hour per player.

Postgres: `postgres:16`, pool 8 per replica; the hot read is the anchor query (indexed by `(player_key, generation, progress DESC, seq DESC)` on anchored/quarantined rows). The scariest query (distinct anchors) runs at boot to keep its plan honest.

Bench plan (§9): k6 at 1×/5×/20× against Lab, spike, monthly 2 h soak; nightly p95 threshold from `/health/ops`. Not run in this repository (needs a deployed Lab); tooling `check-health --assert` provides the assertion surface.
