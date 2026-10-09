---
name: no-existing-players
description: Warp Crew has no real players yet; the owner is the only playtester (as of 2026-10-05)
metadata:
  node_type: memory
  type: project
  originSessionId: 2c2899d5-ede1-4954-b00d-f4035d9e68e1
  modified: 2026-10-05T16:21:12.319Z
---

Warp Crew has no existing players: the owner is the only playtester (stated 2026-10-05). There is no legacy save or purchase data to migrate.

**Why:** The game-core port's stage 4 originally planned a migration of the legacy server's save and purchase tables; the owner said there is nothing to migrate.

**How to apply:** Don't plan data migrations, make-good grants or one-time-pack ownership imports for the legacy server; cut over to the game-core server with a fresh database. Save-compatibility work only needs to cover the owner's own QA saves (and only if cheap). Related: [[game-core-port]].
