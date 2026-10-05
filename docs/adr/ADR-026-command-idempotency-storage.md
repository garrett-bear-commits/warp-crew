# ADR-026 Idempotency: reserved commands row + tombstones, request_hash over {type, canonicalPayload}

Date: 2026-08-17. Status: accepted (implements §4.1).

## Context
§4.1 defines commandId as transport idempotency with reservation inside the command transaction,
no in_progress state, tombstones as long as the produced fact exists.

## Decision
`commands(scope_key, command_id)` is UNIQUE. The bus does `INSERT … ON CONFLICT DO NOTHING RETURNING`
inside the command's transaction after taking the declared lock; if nothing is returned the row
already exists (or a concurrent tx holds the uniqueness wait): read it, compare `request_hash`
(SHA-256 over canonical JSON of `{commandType, payload}` with keys sorted recursively; auth and
transport fields excluded), replay the stored result on match or raise 422 `idempotency_mismatch`.
On success the reserved row is finalised (status, result, duration_ms, trace_id) — the only
UPDATE the app role has on `commands`. Retention prunes full rows per definition (7d/90d/1y) and
copies `(scope_key, command_id, type, request_hash, outcome_ref)` into `command_tombstones`; the
lookup checks tombstones when the row is absent so a weeks-old retry returns `duplicate` with the
original outcome ref instead of colliding with `UNIQUE(player_key, command_id)` on snapshots.

## Consequences
Concurrent duplicates serialise on the unique index (bounded by `lock_timeout` → 503 retry_later).
`scope_key` = player key or the literal `game` — the database is already game-isolated (ADR-003).
