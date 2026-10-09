---
name: game-core-port
description: "Warp Crew is being ported onto the owner's game-core foundation on branch claude/game-core-port (started 2026-10-05)"
metadata:
  node_type: memory
  type: project
  originSessionId: 2c2899d5-ede1-4954-b00d-f4035d9e68e1
  modified: 2026-10-05T16:21:19.473Z
---

The owner asked (2026-10-05) to bring in https://github.com/0xJaeger/game-core (their private foundation, also used by Cairndeep and Wild West Demons) and port Warp Crew onto it inside the warp-crew repo.

Branch `claude/game-core-port` (worktree `.claude/worktrees/game-core-port`): core merged with history at 9fb869b, the whole game moved to `apps/warpcrew/`, plan in `apps/warpcrew/docs/game-core-port.md`. Stages: 1 import, 2 server (core gained bundles, one-time packs, owned query, subscriptions; ADR-035), 3 client plumbing, 4 Railway cut-over. Merged into `main` on 2026-10-09 (owner approved); work on `main`. `claude/hud-overhaul` is the frozen pre-port layout. Hand-off doc: `apps/warpcrew/docs/HANDOFF.md`.

**Why:** the owner wants one shared foundation across their games.

**How to apply:** Use Warp Crew's own Postgres container `warpcrew-postgres` on port 55442; never `foundation-postgres`/55432, which other game-core checkouts share. Minting stays off until the owner approves. No legacy data to migrate: [[no-existing-players]].
