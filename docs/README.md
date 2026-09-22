# Warp Crew documentation map

This directory contains both current product evidence and historical build notes. Use this page to avoid treating an old phase document as the present specification.

## Current authoritative evidence

- [Current-build audit](audits/2026-09-21-current-build-audit.md) — revision-stamped phone, gameplay, art, test, and platform findings.
- [Current architecture](18-current-architecture.md) — how the running game is divided, where state flows, and which boundaries must be preserved or replaced.
- [Outcome requirements](19-outcome-requirements.md) — completion criteria and required proof for the active overhaul goal.
- [Approved product direction](design/20-product-direction-draft.md) — living ship first, short contract routes, away expeditions, and fully earnable functional power.
- [Ship and animation foundation](design/21-ship-animation-foundation.md) — exact first-package geometry, interaction, and Ninefold rendering contract.
- [Ship and animation QA](qa/2026-09-21-ship-animation-foundation.md) — automated results, 390×844 captures, hit ownership, and remaining device gates.
- [Jest platform and monetization research](research/2026-09-21-jest-platform-monetization.md) — current platform contracts and gaps that constrain future designs.
- [Contract route and first-session loop specification](superpowers/specs/2026-09-21-contract-route-loop-design.md) — approved route, tutorial, combat-order, expedition-choice, migration, telemetry, and QA requirements; implementation evidence and remaining content gates are below.
- [Contract route implementation plan](superpowers/plans/2026-09-21-contract-route-loop.md) — nine-task package and verification contract.
- [Contract route runtime QA](qa/2026-09-21-contract-route-loop.md) — reproducible 390×844 and 360×800 desktop browser measurements, reload and migration evidence, QA-found fixes, and outstanding authored tells, reward-band presentation, economy, and device gates.

These files describe the current build and the evidence needed to improve it. They do not authorize a particular redesign or live monetization model.

## Design specifications awaiting approval

The product direction is approved. The following package specifications become authoritative as they are written against that direction and accepted for implementation.

1. Product vision and player promise.
2. Five-to-ten-minute daily loop and first-session tutorial.
3. Economy, monetization principles, offers, and simulations.
4. Ship interaction, room geometry, navigation, and camera behavior.
5. Crew identity, body families, Ninefold animation, and art budgets.
6. Progression, hulls, systems, collection, lore, and live content.
7. Persistence, purchase authority, analytics, notifications, and release QA.

## Historical and superseded planning

The numbered documents from `00-foundation.md` through `17-tracks-abc.md` preserve useful provenance, early concepts, and implementation history. They are not a coherent current specification. In particular, their content counts, feature status, test duration, platform assumptions, and shipped/next labels may conflict with the current code.

Use historical documents only to recover intent. Validate every claim against the current authoritative evidence and source before using it in a new design.

## Working rules

- Current code and rendered behavior outrank historical prose.
- A design proposal is not an implemented feature.
- An implemented feature is not complete until its required automated and phone evidence exists.
- Real-money behavior requires a separately verified authority boundary and recovery testing.
- Production activation or deployment requires explicit authorization.
