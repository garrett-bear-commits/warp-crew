# Balancing and live operations

The core supports live changes, but only values deliberately consumed through live operations change without a
release. Engine constants do not become live merely because a flag with a similar name exists.

## Current change boundaries

| Change | Current source | Delivery |
| --- | --- | --- |
| Engine formulas, costs, production, combat/drop rules | game engine code | client release |
| Catalog grant amounts and first-purchase multipliers | server `GameConfig` | server release |
| Client catalog display and platform products | game client config | client release |
| Board bounds, retention, plausibility, schema and security limits | server config/policy | server release |
| Grant vocabulary (rewards admin/cohort grants may carry) | `games/<id>/grants.ts` | server + inspector release |
| Economy anomaly keys (`anomalyKeys`) | server policy | server release |
| Achievement and daily-reward definitions (daily `cadence` `utc_day`/`rolling_24h`, `minProgress`) | versioned content | publish |
| Typed flag values and rollouts | live-ops database | publish |
| Schedules and segments | live-ops database | publish |
| SKU/command kill switches and global minimum build | live-ops database | publish |

## Safe live-change workflow

1. Make the change in Lab.
2. Validate the document/schema and preview the target segment.
3. Use shadow mode or a small sticky rollout where supported.
4. Verify actual game behavior, not only displayed values.
5. Record a reason and expected metric.
6. Publish to production with a rollback version identified.
7. Watch health, integrity events, economy metrics, and support signals.
8. Revert or kill-switch immediately when the expected bound is crossed.

Content reverts publish an earlier document as a new version, preserving history.

## Important v1 limits

- The admin inspector has friendly forms for flags and content. Schedules, segments, kill switches, minimum-build
  changes, and content reverts currently use their admin APIs/runbooks.
- Only achievements and daily rewards have runtime content schemas. Treat other content kinds as unsupported
  until they have a schema and a consuming client.
- `activateAtSessionBoundary` is present in the contract, but current flag resolution does not pin a value for a
  session. Do not use it for deterministic economy changes.
- A content version's `minBuildVersion` is metadata; game code must not assume it protects server-side reward
  evaluation until enforcement is added.
- The template's `idle.rate` changes the displayed production number, not the engine's production. It is a UI
  demonstration, not proof that simulation balance is remotely controlled.
- Existing achievement IDs are durable reward identities. Changing the reward behind an ID does not compensate
  players who already unlocked it.

## Recommended pattern for a balanceable game

Define a game-owned, schema-validated `BalanceDocument` with hard limits. Resolve one immutable balance version at
session start, persist its version in state/repro evidence, and pass the resolved snapshot into deterministic
engine decisions. Generate client and server views from the same browser-safe definition where possible.

Before giving publish access to a non-engineer, add a schema-driven editor with current/draft diff, Lab preview,
economy ceilings, simulation output, and explicit rollback. Raw JSON is an operator interface, not a complete
game-design workbench.
