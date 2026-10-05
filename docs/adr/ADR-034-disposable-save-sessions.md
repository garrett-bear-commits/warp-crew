# ADR-034 Player-save takeover uses a disposable browser session

Date: 2026-08-26. Status: accepted.

## Context

Support needs to reproduce a problem from any retained player snapshot in the actual game UI. Restoring the
snapshot would change the player's lineage, while loading it through the operator's normal game client could
overwrite the operator's slot or let background sync publish the exploratory branch. A read-only state viewer
does not reproduce gameplay behavior.

## Decision

The inspector launches a one-use game popup and transfers the selected retained blob after an exact-origin,
exact-window, random-session handshake. Sensitive snapshot data and identifiers never enter the URL. The game
detects this mode before normal storage or platform boot, validates the blob through its normal codec, and seeds
a synthetic identity in fresh memory-only storage.

Disposable client construction fails closed: sync, KV, journal, beacon, persistence, browser locks/channels,
provider services, analytics, and network fetch are disabled. A game must also omit its own API clients and
server-backed UI in this mode. The UI carries a persistent banner and offers only discard/close; there is no
promotion path back into a player save.

Only retained blobs are eligible. The canonical server snapshot does not contain the local envelope RNG stream,
so gameplay begins from the exact saved state but is not guaranteed to reproduce the original future random
branch.

## Consequences

Operators can safely reproduce historical states without a database clone or player mutation. Every adopter
must wire a small alternate bootstrap and prove zero durable/network side effects. Pruned snapshots remain
unavailable, and deterministic future branching would require a later save-format decision for RNG state.
