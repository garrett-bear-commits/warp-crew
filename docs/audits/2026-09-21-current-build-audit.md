# Warp Crew current-build audit

Status: evidence baseline, not an approved redesign specification  
Revision: `56693f4a6ea0cb7dce25c670e677d43a56db95e5`  
Audit viewport: 390 x 844 CSS pixels  
Audit date: 2026-09-21

Historical scope: findings below describe the revision stamped above. The [ship foundation](../qa/2026-09-21-ship-animation-foundation.md) and [contract-route QA](../qa/2026-09-21-contract-route-loop.md) supersede its coarse hitboxes, tiny/bobbing crew, post-tutorial coach, additive-assist/automatic-party, and stale-test findings. Device, economy, authority, and broader content findings remain open unless those reports explicitly close them.

## Verdict

Warp Crew has crossed from prototype into a recognizable game, but it is not yet a polished phone game. The strongest work is the ship-as-home fantasy, content breadth, short first combat, and the amount of progression already represented in data. The weakest work is the bridge between those systems and the player: text and characters are too small, the ship art and interaction geometry disagree, the repeatable decisions are shallow, and the documentation and tests no longer describe one coherent product.

The build is a useful foundation. It should be refined in place rather than discarded.

## Package follow-up

The isolated ship-and-animation package implements the first recommended work package without changing the economy or daily loop. It replaces the four coarse Sparrow regions with nine art-aligned compartments, derives pathing and input from one layout manifest, renders cropped four-direction frames at a 52px phone height, removes synthetic crew bobbing, enforces 44px ship controls, and adds a development geometry overlay. It also reconciles the two stale baseline progression tests with the current hull and tutorial rules; the complete default test chain now passes. See [the package QA report](../qa/2026-09-21-ship-animation-foundation.md).

This follow-up does not erase the audit's remaining tutorial, core-loop, content-expression, monetization, persistence, or real-device findings.

## Evidence summary

- Production build: PASS (`npm run build`; 42 modules, 198.63 kB JS before gzip).
- Comprehensive current sanity harness: PASS (`node test/sanity.mjs`; 46 crew, 51 nodes, 34 planets, 30 story beats, 16 encounters).
- Default test command at the audited baseline revision: FAIL.
  - `test/phase_c.test.mjs` expects a Corvette to be purchasable without the new chapter and prerequisite-hull gates.
  - `test/tutorial_week.test.mjs` expects the third berth after `travel_success`; the current tutorial awards it after the scripted first combat.
  - These are stale expectations. The newer sanity harness explicitly verifies the newer rules.
- Default test command on the ship-and-animation package branch: PASS after updating those stale tests to exercise the current gates and event sequence.
- CSS audit:
  - 10 distinct pixel font sizes; only 3 are on the requested 16/18/20/28/40+ scale.
  - 19 declarations are below 16px; the smallest is 10px.
  - 106 of 160 measured spacing declarations (66%) are off the 8px grid.
  - 5 pressed-state rules exist.
- Contrast script: 15 pairs remained UNCHECKED because the supplied script did not resolve the stylesheet variables. Screenshot review was used for the visible first-session states, but a complete grayscale and every-state contrast proof is still required.
- Art bundle: 17 MB under `public/art`; several individual cinematic and space images are 0.7-1.5 MB.

## What works

1. The tall ship cutaway creates a clear fantasy and is more distinctive than the earlier dashboard UI.
2. The first-session sequence teaches jump, combat, reward, and recruitment through action instead of prose.
3. The content foundation is broad: 46 mercenaries, 9 hulls, 51 nodes, 34 planets, 30 story beats, and 16 combat encounters.
4. Fuel, expeditions, crew collection, ship progression, reputation, and notifications form a credible idle-game foundation.
5. Mercenary writing already has personality. Every catalog entry has history and a quote, and the roster spans humans, aliens, and droids.
6. The current production bundle compiles, and the newest large sanity harness covers many important economy and progression invariants.

## Systemic findings

### 1. Ship art and interaction geometry disagree

The Sparrow illustration visibly contains more compartments than the four interactive regions defined in `src/data/starterShip.js`. Engineering, Cargo Hold, and Engines each cover multiple visually separate rooms. The same coarse rectangles drive labels, room selection, and pathing assumptions. Players therefore cannot reliably predict which room a tap will select.

One-line fix: derive visible room polygons, tap targets, crew destinations, door points, and labels from one ship-layout manifest aligned to the final art.

### 2. Ninefold animation is present but rendered incorrectly

`walk-4dir.png` is a real 4-row by 4-frame directional walk sheet, and direction selection is wired correctly. However, each complete 96 x 96 cell is drawn into a 20-26px square even though the character occupies only part of that cell. The visible character becomes extremely small. `crewWalk.js` then adds a sine-wave vertical offset of roughly 1.1-1.4px to walking and working states. At the resulting sprite size, that artificial bob is visually dominant.

All 46 mercenaries also reuse the same human-shaped walk base with palette changes, so many aliens and robots lose their authored identity while moving.

One-line fix: crop frames to an authored anchor box, draw at a legible phone size, use the sheet's own motion without added bobbing, and support species/body-specific directional sheets through the same animation contract.

### 3. The core loop has breadth but insufficient agency

The loop currently offers many destinations and upgrades, but most actions are resolved by choosing a card and receiving an outcome. Combat assists are free additive power choices, and expeditions automatically pick the highest-scoring available crew. The player owns many systems but makes relatively few meaningful tradeoffs.

One-line fix: concentrate each daily session around a small number of legible decisions whose outcomes visibly affect the ship, crew, route, and next session.

### 4. Progression is represented more strongly than it is felt

Nine hulls and many upgrades exist, but the hangar is primarily a long text list. Week goals are checkboxes, story is mostly log text, and later systems are displayed as a development roadmap. Progress does not yet transform the home screen or create strong short-, medium-, and long-term targets.

One-line fix: make progression visible on the ship and star route, present one next milestone at a time, and move unreleased roadmap content out of the player UI.

### 5. Monetization hooks exist without a complete product model

Fuel purchases, gems, gem hires, a 10-pull, expedition skip, premium hull paths, and starter products exist. Missing or under-specified pieces include offer sequencing, price-value ladders, first-purchase timing, payer/non-payer pacing, long-run sources and sinks, duplicate conversion value, event monetization, cosmetics, subscription/pass structure, and explicit fairness rules.

One-line fix: write and simulate a complete economy and offer model before expanding the store surface.

### 6. Documentation is obsolete and contradictory

Current docs still describe 22 mercenaries, 11 nodes, two highlighted hulls, NYI features that are implemented, and content labeled for a former 15-minute test. The code now contains substantially more content and different rules.

One-line fix: replace phase-history fragments with authoritative vision, loop, economy, monetization, progression, content, animation, technical, and QA documents.

### 7. Save and paid-entitlement authority are not launch-ready

The tutorial says registration can keep the crew on another device, but `src/systems/save.js` writes only to browser `localStorage`. A Jest cloud-data adapter exists in `src/shared/platform.js` but has no call sites. The purchase flow correctly grants before completing and recovers incomplete purchases, but it does not send the signed purchase payload to a backend for verification. Fulfilled purchase tokens are stored inside the same client-owned save.

One-line fix: define and implement an authoritative persistence and purchase-verification boundary before real-money progression is enabled; until then, do not promise cross-device recovery or treat client state as secure entitlement proof.

## Screen audit

The counts below include only text visible in the 390 x 844 viewport for the tested first-session state. They are not totals for all scrollable content.

### Ship

Visible text below 16px: 19 items.

1. Room labels are 10px and are drawn over detailed art. Rule failed: readable text and text-over-art backing. Fix: use larger persistent labels or room icons outside the detailed image, and reserve in-art labels for selected/focused states.
2. Hull, shield, location, and navigation labels are 11-13px. Rule failed: player-facing text at least 18px. Fix: reduce the amount of always-visible text and promote the remaining status values to the type scale.
3. Fuel and ship buttons are 36px and 32px tall. Rule failed: 44px tap target. Fix: give every HUD action at least a 44px hit area even if its visual pill is smaller.
4. Four room hitboxes cover more visual compartments than their labels imply. Rule failed: obvious interactive elements and continuity. Fix: align room geometry to the art from a single manifest.
5. The post-tutorial coach competes with navigation and covers the lower playfield. Rule failed: one primary action and no cramming. Fix: convert it to a compact contextual objective chip or a one-time modal that dismisses after the player acts.

### Tutorial and combat

6. The tutorial successfully demonstrates actions, but `Sure` is an awkward combat-odds label. Rule failed: clear status copy. Fix: use `Guaranteed` for the scripted fight.
7. The combat choice is mostly a power comparison plus a free bonus. Rule failed: meaningful primary interaction. Fix: give each assist a distinct visible effect and a constrained tactical cost or charge model.
8. The reward and recruit steps repeat text that the visuals could carry. Rule failed: show, do not explain. Fix: animate currencies to the HUD, visibly open the berth, and place the recruit into the ship.
9. The tutorial exits into another persistent tutorial card rather than a clear repeatable session plan. Rule failed: continuity. Fix: end with a compact three-action daily plan and then yield the screen.
10. The registration step promises cross-device saving that is not implemented. Rule failed: truthful UX copy. Fix: either implement verified cloud persistence first or change the prompt so it makes no recovery promise.

### Crew

Visible text below 16px: 47 items. Eleven visible crew controls are only 36px tall.

11. Luck, pity, two luck purchases, free hire, ten-pull, roster, level, bench, dossier, stars, and power all compete in one panel. Rule failed: one primary element and no more than three hierarchy levels. Fix: make the roster primary; move hiring to a dedicated Recruit surface or collapsed top module.
12. Crew names are 15px and metadata is 12px. Rule failed: readable player-facing text. Fix: use 18-20px names and 16-18px supporting metadata.
13. Dossier, level, and bench buttons are 36px tall and tightly packed. Rule failed: 44px targets with 8px separation. Fix: make the row itself open the dossier and move level/bench into the dossier sheet.
14. Animated crew sprites and portrait art do not share species silhouettes. Rule failed: visual continuity. Fix: establish one identity manifest that maps portrait, idle, doing, and four-direction movement art for each body family.

### Missions

Visible text below 16px: 42 items.

15. Two-column node cards put destination, fuel, reward, odds, status, and art into 56-73px rows. Rule failed: glanceability and minimum text size. Fix: show fewer nearby routes as larger cards or a readable map with a single selected-destination panel.
16. Expedition crew is auto-selected and embedded in a 13px summary line. Rule failed: meaningful interaction and show-don't-explain. Fix: show crew portraits and let the player confirm or adjust the recommended team.
17. Repeated destinations decay in payout, but the consequence appears as another small percentage. Rule failed: status shown visually. Fix: use a depletion meter/state on the destination art.
18. Travel outcomes frequently resolve immediately with little anticipation or visible consequence. Rule failed: motion should explain what happened. Fix: use a short route/arrival/reward sequence and persist visible route consequences.

### Shop

Visible text below 16px: 49 items.

19. Nine hulls appear as a dense text list, with progression locks and two currencies compressed into small metadata. Rule failed: hierarchy and shop pattern. Fix: feature the current/next hull as a large comparison card and place the full fleet in a secondary collection view.
20. Some ship thumbnails have colored square backings while others are transparent renders. Rule failed: continuity. Fix: normalize every hull thumbnail to one crop, backing, and scale convention.
21. The store mixes soft-currency fuel, hull progression, premium currency, and real-money offers in one scroll. Rule failed: one primary action. Fix: separate Hangar, Fuel, and Premium Store surfaces while preserving one contextual offer entry point.
22. The store does not yet explain value or show a coherent price ladder in local mode. Rule failed: clear purchase decision. Fix: show exact price, contents, comparative value, and purchase limits from authoritative product data.

### Log and meta

Visible text below 16px: 46 items.

23. `Unknown` is the player's first career title and reads like missing data. Rule failed: understandable state. Fix: use an intentional starting rank such as `Unproven` or `Rookie Captain`.
24. `Later`, `Fast follow`, `LiveOps`, and `Mid-core` expose internal roadmap language. Rule failed: player-facing continuity. Fix: remove unreleased development concepts or present only real unlockable systems as in-world rumors.
25. Week goals are a flat checklist with no reward track. Rule failed: progress should use bars, rewards, and state. Fix: add milestone rewards and a visible weekly progression rail.
26. Story is hidden behind log rows instead of delivered through characters and discoveries. Rule failed: casual-friendly lore. Fix: use short illustrated transmissions, crew reactions, and optional dossier depth.

## Content and roster audit

- Species split: 22 human, 13 alien, 11 droid.
- Role split is reasonably even across pilot, engineer, gunner, medic, trader, scout, and security.
- Rarity split reaches seven tiers, including 2 mythic and 1 apex mercenary.
- Every mercenary has a history and quote.
- The writing includes promising outliers such as a lane that became a pilot, a ship-mind poured into a body, a Swarm form that chose a name, a cloud-being, and a living crystal knight.

The content problem is not a lack of ideas. It is that portrait and movement systems do not yet express enough of those ideas at runtime, and most passives resolve to a small percentage attached to one of seven templates.

## Not verified

1. Grayscale distinction across all screens and states.
2. All 15 contrast pairs the supplied script left UNCHECKED.
3. Real iPhone and Android rendering, safe areas, touch accuracy, and device performance.
4. Full tutorial registration flow inside the real Jest shell.
5. Every route, expedition, combat loss, injury, hull purchase, reserve overflow, and premium-purchase state.
6. Boot CPU and memory cost of preparing all crew art variants.
7. Runtime animation registration and jitter for every direction and body family at final display size.
8. Economy pacing beyond the current deterministic sanity harness; no multi-day source/sink simulation has yet proven the target 5-10 minute cadence or payer acceleration values.
9. Before/after proposed visuals. Current-state screenshots were inspected live; redesign mockups require an approved direction and will be produced separately.

## Recommended work packages

1. Baseline truth: reconcile tests, remove stale player-facing roadmap copy, and establish authoritative docs.
2. Ship and animation foundation: final Sparrow geometry, matching hitboxes/pathing, larger correctly cropped Ninefold movement, and removal of pseudo-bobbing.
3. First-session and daily loop: tutorial transition, destination choice, combat assists, expedition team choice, reward presentation, and daily plan.
4. Economy and monetization: source/sink simulation, premium currency, fuel, offers, bundles, skips, passes/subscriptions, and fairness boundaries.
5. Meta and content expression: ships, visible upgrades, mercenary body families, collection, lore delivery, weekly goals, and long-tail progression.
6. Phone QA and telemetry: real devices, accessibility, performance budgets, funnel events, retention measures, and balance experiments.

This audit does not authorize implementation. Each package needs an approved design and verification plan before code changes.
