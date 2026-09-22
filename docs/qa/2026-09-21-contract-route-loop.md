# Contract route and first-session runtime QA

Status: automated and desktop-emulated runtime checks pass; package content and release gates remain open.

This report covers the approved [specification](../superpowers/specs/2026-09-21-contract-route-loop-design.md) and [implementation plan](../superpowers/plans/2026-09-21-contract-route-loop.md). It is not real-device QA, economy approval, or deployment approval.

## Provenance and reproduction

- Worktree: `/Users/garrettdare/.codex/worktrees/ship-animation-foundation/warp-crew`.
- Package starting commit: `0edecdea654d66318da52df6fd34a683ff2fcfec`.
- Tasks 1–8 implementation range: `0edecdea654d66318da52df6fd34a683ff2fcfec..6fd8a1e417d53f00aaba725534cd7671cd5526d5`.
- Task 9 adds this report, the package-local harness, focused/default test commands, regression coverage, captured evidence, and the QA-found fixes below. Its commit is titled `docs: verify contract route loop`; the exact final SHA is recorded in the controller's ignored `task-9-report.md`. Resolve the committed report's containing change with `git log -1 --format=%H -- docs/qa/2026-09-21-contract-route-loop.md`.
- No dependencies installed, external publishing, production state changes, pushes, merges, or deployment. Generated `dist` output is uncommitted.

Use Node 22 or newer for its built-in WebSocket client and the installed Chrome. Start these commands in separate terminals from the named worktree:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5198
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-first-run --no-default-browser-check --remote-debugging-port=9339 --user-data-dir=/private/tmp/warpcrew-contract-task9-chrome about:blank
QA_URL=http://127.0.0.1:5198/ node scripts/contract-route-qa.mjs
```

The final capture pass drives the fresh production build through Vite Preview with CDP pointer clicks, reads actual DOM/computed styles, writes only a dedicated browser profile's local save, and captures viewport PNGs. Initial fault discovery used `npm run dev -- --port 5199`. The harness never substitutes mock HTML or calls the session controller to advance gameplay. `QA_URL` and `QA_CDP` override local endpoints. `--record` continues evidence collection while retaining every measurement failure; the default command exits nonzero on failed requirements. `--reduced-only` reuses the previously recorded confrontation saves for the focused canvas probe and does not replace a final full run.

[Complete machine-readable evidence](artifacts/contracts-runtime/contract-route-measurements.json) includes the full seed, browser version, each control's dimensions and clipped bounds, every measured text string/font size, sheet bounds, exact before/after reload snapshots, selected expedition payload, reward result, improvement spend, and reduced-motion samples.

The deterministic fixture uses `createNewPlayer()` version 7 with its real starting wallet (80 credits, 8 fuel, no gems/medals/reputation) and normal starting crew. Only captain/crew identity, clock fields, the current login day, and `splashSeen` are stabilized. Date is fixed at `2026-09-21T19:00:00Z`, timezone is America/Los_Angeles, Math.random returns 0.01, and device scale factor is 1. The completed login day prevents unrelated daily-login grants during reload assertions. The clock freeze intentionally excludes real timer-expiry/performance testing.

## Automated commands

All four required commands exit 0:

```sh
npm run test:loop
npm run test:ship
npm test
npm run build
git diff --check
```

`test:loop` runs combat orders, board, route, tutorial v3/migration, party selection, contract UI, daily loop, ship feedback, session controller, Explore orders, and dialog focus: 11 scripts. `test:ship` retains all five ship suites. `npm test` retains its nine existing timer/fuel/economy/daily/travel/platform/progression/content scripts and appends `tutorial_v3.test.mjs` (10 scripts). The same tutorial suite is intentionally included in both focused and default gates.

Fresh production build after the typography/label polish: 51 transformed modules; `dist/index.html` 1.27 kB (0.75 kB gzip), `index-BoyEJ1Ge.css` 30.74 kB (7.17 kB gzip), and `index-Cbq5ozin.js` 251.31 kB (81.05 kB gzip). Browser: Chrome 153.0.8010.53, desktop headless mobile viewport emulation.

## Runtime progression and reload proof

Both 390×844 and 360×800 runs use the same fresh fixture and advance through `distress → launch → order → return → recruit → choose → away → done`. The tutorial has no `choice` stage: its launch enters the guaranteed confrontation directly. The normal Risky route supplies the required `choice` reload case.

| Reload point, at both viewports | Revision | Wallet before and after: credits / fuel / medals / reputation | Pending reward before and after |
| --- | ---: | --- | --- |
| Tutorial confrontation | 1 | 80 / 7 / 0 / 0 | null |
| Tutorial return | 2 | 80 / 7 / 0 / 0 | 120 credits, 8 medals, 4 reputation |
| Normal choice | 1 | 200 / 6 / 8 / 4 | null |
| Normal confrontation | 2 | 200 / 5 / 8 / 4 | null |
| Normal return | 3 | 200 / 5 / 8 / 4 | 120 credits, 10 medals, 5 reputation |
| Normal claimed | no active route | 320 / 5 / 18 / 9 | no pending result |

Gems remain zero throughout. All twelve reload comparisons assert equality of the complete active contract, saved revision, wallet, completed-offer IDs, tutorial phase, and daily milestones. Reload never changes the stored result or grants it. Existing route tests separately exercise duplicate claims, stale revision/acceptance identities, altered previews, and active-route midnight behavior.

After claiming the tutorial reward, Cargo receives the improvement focus and the durable first-repair light is set. Closing that sheet exposes the Recruit Jen coach CTA. During the tutorial upgrades remain locked; the runtime evidence does not claim the pre-done improvement focus is an actionable purchase. The player then reviews the real three-offer board, accepts Risky, and completes its two paid route actions plus Brace confrontation. Tutorial and normal route together spend 3 fuel, leaving 5 without purchases.

The selected Dustfall party is explicitly changed to Jen alone. The preview shows 59%, success 70 credits/8 medals/4 reputation, failure 16 credits/2 medals/1 reputation, injury risk, a 12:05 PM return time, and unavailability until return. The saved job contains exactly Jen's instance ID and the displayed chance; no automatic party replacement occurs. Tutorial reaches done and the compact daily chip reads 2/3. Clicking it opens Operations; purchasing Sensors 1 spends 220 credits (320 → 100), marks Improve, and hides the chip at 3/3. This is one deterministic free run, not economy tuning or a timing study.

After tutorial completion, a further Reliable offer is accepted solely to inspect Explore's active-contract lock. Every rendered travel button is disabled and the explanation is visible; that unlaunched contract is abandoned without spending fuel. Explore's combat-order adapter is covered by `explore_orders.test.mjs` and the controller suite.

## Phone-sized layout measurements

Each viewport records 16 normal-motion component states, 36 actionable-control samples, and 196 text samples (including all 36 controls), plus the reduced-motion order state. Disabled controls are measured too. All measured required controls reach at least 44×44 CSS pixels; every sampled control/card/consequence text is at least 16px. The harness asserts one font sample for each measured control, scrolls each target into view, checks its whole rectangle against the viewport and every clipping ancestor, and verifies center-point hit ownership below the navigation boundary. It resets both scroll axes before overview captures. Separate checks verify visible Cargo/Operations room-label bounds against clipping ancestors and ensure labels cannot intercept input.

| Component | Minimum control size at 390×844 | Minimum control size at 360×800 | Essential text |
| --- | --- | --- | --- |
| Contract card Review | 332×44 | 302×44 | 16px |
| Mission view switcher | 116.65625×44 | 106.65625×44 | controls 16px |
| Review sheet, including Close | 44×44 | 44×44 | 16px |
| Tutorial order buttons | 298×44 | 268×44 | 16px |
| Normal route/order, including Break | 137.203125×44 | 137.203125×44 | 16px |
| Cargo claim sheet, including Close | 44×44 | 44×44 | 16px |
| Away destination Choose crew | 318×44 | 288×44 | 16px |
| Party sheet, including Close | 44×44 | 44×44 | 16px; portraits 64×64 |
| Daily plan | 370×44 | 340×44 | 16px |
| Active Away controls | 70.53125×44 | 70.53125×44 | 16px |

The navigation begins at y=779 and y=735 respectively. Review and party sheets end at y=772 and y=728, leaving 7px before navigation. Cargo sheets remain inside the stage. Exact top/width/height and scroll extents for every sheet are in the JSON; all required controls are fully scroll-reachable. Native safe-area insets are zero in desktop emulation, so these checks do not prove notched-device behavior. Review close returns focus to the exact Risky Review action; crew-picker close returns focus to Dustfall Choose crew at both sizes. Unit tests also cover focus containment and rerendered party selection.

The board and order roster intentionally require vertical scrolling at these sizes. The named overview PNGs show the first card/order; supplementary Risky/Strange and Brace/Burn/Board captures show the remaining facts and reachable actions. This report does not claim all three cards fit simultaneously.

## QA-found corrections and before evidence

1. Cargo outcome and reward text inherited 15px. A rule scoped to the claim action container raises both to 16px. [Before image](artifacts/contracts-runtime/return-before-390x844.png) and [first measurements](artifacts/contracts-runtime/measurements-before.json) retain the failure at both sizes.
2. The daily chip participated in the stage's flex layout, shrinking to 86.84375×131.9375 at 390px and shifting/clipping the ship. It is now an absolute bottom overlay, 370×44 or 340×44, with viewport-safe side margins. Full ship horizontal bounds and the chip's full clipped bounds are asserted. [Before image](artifacts/contracts-runtime/daily-plan-before-390x844.png).
3. Closing Review initially restored focus, but the action's second render replaced the trigger and left focus on the document body. `syncDialogFocus` now preserves only a detached, enabled action's exact dataset identity across the non-dialog rerender. The new regression first failed with `second render retains exact Review trigger`; the fix passes it and the real Review/party close checks. [Before focus records](artifacts/contracts-runtime/measurements-focus-before.json).
4. Active Away chance/time and crew names inherited 13px `.muted` styling. A rule scoped to Away mission cards raises those facts to 16px. [Before image](artifacts/contracts-runtime/active-away-before-390x844.png) and [measurements](artifacts/contracts-runtime/measurements-away-before.json).
5. Reduced motion disabled animation frames but still moved ambient crew positions/collision nudges, stars, planets, and rocks. Reduced mode now freezes only that decorative movement while still drawing current state and preserving authored station/departure snaps. Focused tests first failed for changing actor feet, then changing space draw coordinates. They now prove static reduced frames and resumed normal movement; existing selected-actor Airlock/exact-once tests remain green. [Before canvas observations](artifacts/contracts-runtime/measurements-motion-before.json).
6. The follow-up control-font scan caught the Cargo **Bring it aboard** button itself at 15px, even though its surrounding summary/payout had been corrected. A rule scoped to that action now gives it 16px. Mission-switcher and every other measured action font are now included in the same runtime gate. [Before polish measurements](artifacts/contracts-runtime/measurements-polish-before.json) record the four failures (tutorial/normal return at both sizes).
7. Cargo and Operations labels were inside polygon-clipped hotspot buttons, cutting off their first/last characters. Passive, aria-hidden labels now sit beside those buttons at the same authored anchors. The polygon hit ownership is unchanged; labels retain `pointer-events:none` and appear only for the selected/alert/focused room. The ship-view regression first failed with `room label remains clipped inside hotspot`; live checks separately reproduced six clipped-label observations and verify the corrected bounds. [Cargo before](artifacts/contracts-runtime/room-label-before-daily-360x800.png) and [Operations before](artifacts/contracts-runtime/room-label-before-improvement-390x844.png). Labels may extend beyond their compartment's hit polygon; they do not enlarge its touch target or change room geometry. These checks concern ancestor clipping, not occlusion by foreground sheets: the Operations sheet can still cover the background Cargo label at 360px, as expected for that layering.

These changes are local presentation/accessibility fixes. Contract resolution, costs, rewards, persistence schema, and tutorial progression rules were not changed by Task 9.

## Reduced motion

At both viewports the identical saved normal confrontation is reloaded under `prefers-reduced-motion: reduce`. Every displayed order string is identical: Brace 58%/0F/protection, Burn 76%/+1F/+12 effective power, Board 52%/0F/+25% credits and medals/crew injury risk. The same Brace action yields an identical stored result and reward.

Computed route/order animation names are `none` and transition durations `0s`. After the reduced return settles, the harness compares actual space and crew canvas pixels over 600ms: both remain identical, six stage-transform samples are `none`, and combat canvas `is-live` is false. The same test fixture under normal motion is allowed to animate. This is browser evidence for this route; it does not establish physical-device frame pacing or every possible interruption case.

## Captures and visual inspection

All 47 PNGs (seven named, 35 supplementary current-state frames, and five before-fix frames) were opened and visually inspected; their PNG header dimensions were checked against their filename viewports. No debug scaffolding appears. Text is legible, required actions are unobscured or demonstrably scroll-reachable, sheet bottoms clear navigation, and the corrected daily chip leaves the centered ship visible. The follow-up captures verify complete Cargo Hold and Operations labels at both widths. The supplementary directory contains the other spec states at both sizes, plus clearly named before-fix evidence. Final production runtime output: `Measured failures: 0; scenarios: 2`; both scenarios and both reduced-motion runs reported zero uncaught exceptions.

| Named artifact | Inspected state |
| --- | --- |
| [contracts-board-390x844.png](artifacts/contracts-board-390x844.png) | Reliable card fully visible; Risky follows below; three-profile facts verified by scroll |
| [contracts-board-360x800.png](artifacts/contracts-board-360x800.png) | Narrow-width wrapping and accessible Review; remaining cards scroll |
| [contract-order-390x844.png](artifacts/contract-order-390x844.png) | Normal Swarm Skirmish, existing tell blurb, explicit Brace facts; Burn/Board below |
| [contract-return-390x844.png](artifacts/contract-return-390x844.png) | Tutorial stored reward in Cargo, 16px summary/payout, Bring it aboard, reward marker |
| [expedition-party-390x844.png](artifacts/expedition-party-390x844.png) | Jen alone selected, portraits/reasons, reward/risk/return/opportunity cost, Confirm |
| [daily-plan-390x844.png](artifacts/daily-plan-390x844.png) | Tutorial finished, Jen away, 2/3 daily chip, repaired ship centered |
| [contracts-reduced-motion-390x844.png](artifacts/contracts-reduced-motion-390x844.png) | Same confrontation facts under reduced-motion preference |

Supplementary captures cover distress, distress review, normal review, tutorial order, normal route choice, each normal order preview, both Cargo returns, post-claim focus, actionable improvement focus, each lower board card, party selection, daily plan, active Away, Explore lock, and the 360×800 reduced-motion equivalent. They are real application frames, not separately rendered mockups.

## Migration and rollback

`tutorial_v3.test.mjs`, now in `npm test`, covers completed and dismissed v2 veterans remaining done; v2 not-fought/traveled-but-not-fought → distress; fought/not-recruited → recruit; recruited → choose; pre-v2 progressed veterans not replaying; and idempotent second migration. Wallet, crew, reserve, ship, existing expedition, story keys, and `iapFulfilled` receipts are compared for preservation. Valid version-seven briefing/choice/confrontation/return snapshots, acceptance identity, board, and acceptance sequence survive normalization. Invalid stage, identity, outcome snapshot, destination, encounter, order, revision, reward number, or non-finite hull loss clears only contract state and records recovery.

Contract fields are additive and no existing wallet/crew/story/purchase field is renamed. Older code ignoring additive fields is a schema compatibility observation, not a tested safe downgrade protocol or cross-device recovery guarantee. A dismissible veteran board introduction is not proven by these tests or the fresh-save runtime run.

## Economy and telemetry boundaries

Package economy changes are the two independently reduced route fuel actions, Burn's additional 1F/+12 effective power, Brace's failure protection, and Board's -10% effective power/+25% victory credits and medals. Existing scaled site payouts and repeat-visit decay remain the reward authority. Tutorial reward remains 120 credits/8 medals/4 reputation. Daily milestones award no currency. These inputs still require the planned multi-day free/light/high-spender simulations; no final balance conclusion is drawn from green rule tests.

The controller's persistence-before-publish/event/effect boundary is covered by `session_loop.test.mjs`, including failed saves producing no success events. Event transport fields are:

| Event | Fields |
| --- | --- |
| `contract_board_seen` | boardDay, destinationIds, completedCount; hidden active-route board does not emit |
| `contract_reviewed` | offerId, profile, destination, fuel, traitMatch |
| `contract_accepted` | offerId, profile, destination, traitMatch |
| `contract_action` | contractId, stage, actionId, fuel, revision |
| `combat_order_selected` | encounter, order, shownChance, extraFuel |
| `contract_resolved` | profile, success, beats, order, credits, medals, reputation, gems, fuel, hullLoss, injury |
| `contract_reward_claimed` | profile, credits, medals, reputation, gems, fuel, elapsedSeconds |
| `contract_abandoned` | profile, stage, fuelSpent |
| `daily_plan_progress` | day, milestone, completedCount |
| `expedition_party_changed` | destination, partySize, roleMatch, shownChance |
| `tutorial_stage` | script=3, phase, elapsedSeconds |

Explore retains compatibility travel/combat events; contracts do not emit duplicate free-travel events. Local mock platform event generation and controller tests are evidence of wiring, not proof of analytics ingestion or a measured retention funnel.

## Remaining gates

- Authored per-encounter tell labels/sentences/recommended orders are incomplete. Current UI uses the existing encounter blurb and a transparent generic Brace protection recommendation; no roster was invented.
- Review still shows reward-family copy, not the specification's literal numeric reward bands. No claim is made that band presentation or full reward-distribution tuning is complete.
- Real iPhone and Android touch, notched safe-area/keyboard/scroll behavior, accessibility assistive technology, OS reduced-motion changes/interruption, frame pacing/memory/thermal performance, and novice comprehension/session timing remain required.
- Contrast and the wider pre-existing UI are not comprehensively audited here. The 44px/16px results apply to the named package components and sampled states. The unchanged disabled Explore destination grid extends to the right edge at 360px; this round verifies its lock copy/switcher, not destination-grid layout.
- Veteran introduction UX, broader long-term progression, lore/art families, 30-day economy simulation, paid-value authority, signed purchase recovery, cross-device persistence, and deployment/activation remain outside this package's proven completion.
- Production remains untouched. No full overhaul outcome is marked Verified on the basis of these tests.
