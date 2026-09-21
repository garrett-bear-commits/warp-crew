# Warp Crew overhaul outcome requirements

Status: active completion contract  
Revision baseline: `56693f4a6ea0cb7dce25c670e677d43a56db95e5`

## Purpose

This document converts the overhaul goal into testable outcomes. It prevents a visual reskin, a green build, or a larger content count from being mistaken for completion.

Status terms:

- **Foundation** — useful current behavior exists but does not satisfy the outcome.
- **Missing** — no adequate implementation or evidence exists.
- **Decision required** — implementation would encode an unapproved product choice.
- **Verified** — reserved for evidence that covers the whole stated outcome.

No outcome is currently marked Verified.

## Requirements and proof

| Outcome | Current status and evidence | Required completion proof |
|---|---|---|
| Preserve the useful Grok-built foundation | Foundation: modular rules, content catalogs, platform facade, 46 crew, 9 hulls, 51 nodes, 34 planets, and 16 encounters exist. | Regression suite demonstrates preserved approved rules and save migration; discarded behavior is listed with rationale. |
| Phone-first presentation | Foundation: portrait shell exists. Audit found extensive sub-16px text and sub-44px controls at 390 by 844. | Approved screen specs; automated size checks; screenshots for all critical states at target viewports; real iPhone and Android touch, safe-area, keyboard, scroll, and performance evidence. |
| Ship looks and functions well | Foundation: tall cutaway creates a strong home fantasy. Four logical hit regions do not match visible compartments. | One authored geometry manifest drives rendered rooms, labels, focus, hit regions, doors, crew destinations, and path tests; tap overlay proof matches final art. |
| Real Ninefold four-direction movement | Foundation: correct directional sheet and direction mapping exist. Rendering is tiny and adds pseudo-bobbing. | Frame metadata includes crop and foot anchors; no synthetic bob; automated direction/frame/anchor tests; recorded phone proof for all directions and representative body families. |
| Memorable human, alien, and robot mercenaries | Foundation: 46 written characters with a 22 human, 13 alien, 11 droid split. Movement art uses one recolored human body. | Approved body-family roster; portrait/movement continuity; distinctive readable silhouettes; functional identity beyond generic percentage templates; roster and in-ship phone review. |
| Fun five-to-ten-minute free daily loop | Decision required: fuel, travel, combat, expeditions, upgrades, and hiring exist, but choices are shallow and session pacing is unproven. | Approved loop diagram; timed novice and returning-player sessions; 30-day free-player simulation; tests for action costs, timers, recovery, and stopping points; usability evidence that decisions are understood. |
| Retentive first session and tutorial | Foundation: action-first travel, combat, reward, and recruit sequence exists. It ends in an obstructive coach and makes a false cross-device promise. | Approved first-session script; event funnel; first meaningful milestone signal; clean tutorial exit into the repeatable loop; novice phone tests; skip/resume/migration coverage. |
| Meaningful combat and expedition agency | Foundation: assists and party scoring exist, but assists are free additive power and expedition selection is automatic. | Approved decision model; preview/commit/failure contracts; balance matrix; UI proof that consequences and tradeoffs are legible; deterministic tests. |
| Deep, legible long-term progression | Foundation: hulls, system levels, crew progression, reputation, galaxies, story, and week goals exist. Their impact is weakly surfaced. | Progression map across daily, weekly, monthly, and evergreen horizons; milestone rewards; visible ship transformation; unlock pacing simulation; late-game sink and inflation analysis. |
| Rich but casual-friendly lore | Foundation: biographies, quotes, story beats, and planet copy exist. Most delivery is log text. | Lore bible; layered delivery rules; short required beats and optional depth; localization/read-time budgets; representative transmissions, crew reactions, discoveries, and dossiers verified in context. |
| Excellent fair monetization | Decision required: fuel, gems, pulls, skips, premium hull paths, and four product examples exist without a complete model. | Approved fairness principles; authoritative price/product integration; source/sink table; free/light/high spender simulations; offer catalog and exposure rules; duplicate value; subscription decision; purchase/recovery/refund QA. |
| Secure paid-value and cross-device behavior | Missing: save is localStorage-only and signed purchase data is not verified. | Threat model; trusted grant ledger or equivalent authority; signed-purchase verification; idempotent recovery; cross-device merge/conflict rules; offline and replay tests; truthful registration UX. |
| High-quality animation and feedback | Foundation: flight, combat, hitstop, shake, SFX, and crew animation exist. Quality and restraint are inconsistent. | Motion language and budgets; reduced-motion behavior; transition/reward/combat recordings; frame pacing and load measurements on representative phones; no decorative motion that obscures state. |
| Sustainable content and live operations | Foundation: substantial static content and notification hooks exist. Internal roadmap terms leak into player UI. | Content schema and authoring guide; event cadence; notification lifecycle and rotating copy; versioned analytics vocabulary; content validation and preview tooling. |
| Thorough maintained documentation | Foundation: many documents exist but conflict with current code. | Approved vision, loop, economy, monetization, progression, content, animation, architecture, implementation, telemetry, and QA docs indexed from `docs/README.md`; obsolete documents labeled or retired. |
| Release readiness without unauthorized activation | Missing: current audit has unverified device, economy, contrast, authority, and recovery areas. | Release checklist ties every requirement to fresh evidence; all required tests pass or have approved exceptions; exact artifact provenance recorded; production activation remains a separate explicit decision. |

## Cross-cutting acceptance gates

Every implementation package must include:

1. Approved design scope and explicit non-goals.
2. Tests written against the approved behavior before implementation changes.
3. Player-state migration and rollback analysis where applicable.
4. Phone-sized before-and-after evidence for presentation changes.
5. Touch-target, text-size, contrast, and reduced-motion checks.
6. Analytics events tied to a stated product question.
7. Economy effects included in the simulation when currencies, timers, rewards, or power change.
8. No production activation or deployment without explicit authorization.

## Current decision gate

The next design cannot finalize progression or offer math until the monetization fairness boundary is approved:

- recommended: every functional capability and power tier is earnable through play; purchases sell acceleration, additional fuel or attempts, convenience, cosmetics, collection choice, and predictable subscription value;
- alternative: some functional power remains permanently exclusive to payment.

The chosen boundary will be recorded in the future monetization principles document and treated as a hard invariant in simulations and tests.

