# Luna audit: game-core port, server (stage 2) (2026-10-05)

Codex `gpt-5.6-luna` (medium) read-only audit of commits 6e28338 and aee2ba3. Every finding was fixed in 9671cf5 with regression tests; see `apps/warpcrew/docs/game-core-port.md`.

## Findings

1. **High — malformed saves accepted and can crash the client**

   [policy.ts:39-49](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/server/games/warpcrew/policy.ts:39) accepts any `crew` value because it validates only `version`, `wallet`, and `stats`.

   Scenario: submit a valid-looking player with `crew: [null]`. The client restores it through `migratePlayer`, which calls `recomputeCrew(null)`; [crewRoster.js:475-477](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/warpcrew/src/data/crewRoster.js:475) dereferences `c.templateId`, crashing boot. This can poison the deepest save and make the player unable to load the game.

2. **High — first-save progress can be arbitrarily inflated**

   [policy.ts:35-37](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/server/games/warpcrew/policy.ts:35) clamps each counter to `2**40`, then [policy.ts:63-65](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/server/games/warpcrew/policy.ts:63) sums four attacker-controlled counters.

   Scenario: on a fresh generation with no existing head, submit counters such as `1e300` and a matching safe `progress` of `4 * 2**40`. The save is valid, `summaryPlausible` passes, and the no-head path avoids the `progress_jump` quarantine. It becomes the deepest anchor; subsequent honest lower-progress saves are refused as regressions. This is a progression/availability exploit.

3. **Medium — QA sanitization leaks user-entered names and future sensitive fields**

   [policy.ts:84-101](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/server/games/warpcrew/policy.ts:84) only replaces `captainName` and clears purchase evidence. It preserves `ship.name` and crew `customName`/`name`, which are player-entered ([captainFirstPlay.js:14-26](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/warpcrew/src/systems/captainFirstPlay.js:14), [tutorialV4.js:76-87](/Users/garrettdare/warp-crew/.claude/worktrees/game-core-port/apps/warpcrew/src/systems/tutorialV4.js:76)).

   It also spreads all other top-level fields via `...rest`, so any future email, token, device identifier, or provider field added to the save will be copied into QA exports unless explicitly added to the denylist.

## Checked without additional findings

- One-time purchase races are protected by the player command lock plus the partial unique index; sandbox rows do not own packs, and duplicate rows do not mint grants.
- Bundle rewards are boot-validated against Warp Crew’s vocabulary and maxima.
- Subscription verification pins HS256, checks signature, audience, subject, `iat`, age, and sandbox gating. I found no bypass in these paths.
- Migration 0018 is technically N-1 additive-compatible. The documented rollback window can duplicate one-time delivery because the old image does not understand ownership, but ADR-035 explicitly accepts that risk.

Focused tests could not run because Vitest attempted to write `.vite-temp` files and the read-only workspace rejected it.


