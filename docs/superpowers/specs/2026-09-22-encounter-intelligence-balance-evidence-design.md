# Encounter intelligence and balance evidence

Status: proposed package for owner review

Date: 2026-09-22

Baseline: `codex/contract-route-overhaul@fe1d4a0f6a591f725aca44d7a34f32491e7e555e`

Reviewed gameplay: `9b9585ea794120696913216a2763c563a4ba7753`

## Decision

Make the existing Contract Board legible and measurable before changing its economy. This package authors a truthful tell and recommendation for every current encounter, replaces vague reward-family copy with exact reward ranges derived from the saved route, and adds deterministic balance evidence for the current rules.

No reward, cost, timer, progression, encounter-power, or monetization value changes in this package. Evidence may identify a future tuning need; it does not silently tune the game.

This package follows the approved living-ship/short-contract direction in [Warp Crew product direction](../../design/20-product-direction-draft.md), the open gates in [outcome requirements](../../19-outcome-requirements.md), and the boundary in the [2026-09-21 stopping-point handoff](../../handoffs/2026-09-21-stopping-point.md).

## Why this package is next

The contract route works, but two player-facing claims remain vague:

- every encounter reuses its name and blurb as the enemy tell and always recommends Brace;
- contract cards name only a reward family even though the saved route already determines the possible payout paths.

Those gaps prevent players from understanding why one order or contract differs from another and make balance discussion anecdotal. Body-family art remains valuable, but it does not resolve the open loop, combat-agency, or economy-evidence gates.

## Goals

1. Give all 16 current encounters a short, distinctive tell before an order is committed.
2. Recommend an order for an authored reason that truthfully describes the existing consequence.
3. Show literal current reward ranges on the Contract Board and review sheet.
4. Produce a deterministic combat matrix across encounters, orders, and representative crew-power states.
5. Produce deterministic 30-day free-player projections from production rules and explicit strategies.
6. Preserve saved-route identity, preview/commit behavior, reload safety, and exact-once claims.

## Non-goals

- changing any numeric reward, fuel, timer, power, probability, injury, hull-loss, upgrade, or progression value;
- adding encounters, contract profiles, currencies, offers, subscriptions, purchases, or paid-player assumptions;
- implementing movement art, hull transformations, lore surfaces, or other visual packages;
- claiming real-device readiness, balanced pacing, economy approval, or monetization approval;
- merging draft PR #1, publishing Pages, uploading to Jest, or activating Jest production.

No Flora or other image generation is needed for this evidence-first package. A later art package will have its own approved brief, reference images, generation ledger, and spend cap.

## Encounter intelligence contract

Each `ENCOUNTERS_V1` entry gains static content:

```js
tell: {
  label: 'Formation tightening',
  text: 'Three cutters are closing their ragged V around the Sparrow.',
  recommendedOrder: 'burn',
  reason: 'Burn spends 1F for +12 power, improving the chance to break the formation first.',
}
```

The tell never changes combat math. Its recommendation must resolve to `COMBAT_ORDERS`, and its reason must name the real generic tradeoff:

- **Brace:** no extra fuel, half failure hull loss, and no failure injury;
- **Burn:** costs 1F and adds 12 effective power;
- **Board:** uses 90% crew power, pays 125% credits and medals on success, and forces injury on failure.

The UI preselects nothing and grants no hidden bonus for following the recommendation. The tutorial remains the encoded exception: Pirate Scout exposes only Brace and guarantees victory.

### Proposed encounter roster

| Encounter | Tell | Recommended order | Reason |
|---|---|---|---|
| Pirate Scout | **Targeting engines.** The scout is painting the Sparrow's engines, but its first volley is hurried. | Brace | Protect the tutorial crew and hull while the guaranteed counterattack lands. |
| Pirate Wing | **Formation tightening.** Three cutters are closing their ragged V around the Sparrow. | Burn | Spend 1F for +12 power and improve the chance to break the formation first. |
| Scrapper Gang | **Grapples primed.** Cutting skiffs are drifting close enough to trade hull for salvage. | Board | Risk lower effective power for 25% more credits and medals on a win. |
| Eclipse Probe | **Signal about to jump.** The probe has finished mapping the ship and is turning for open dark. | Burn | Spend 1F for +12 power and improve the chance to stop its escape. |
| Swarm Skirmish | **Pack spreading wide.** The hunting pack is separating to strike from both sides. | Brace | Halve failure hull loss and prevent crew injury if the pack gets through. |
| Swarm Frigate Echo | **Core flare rising.** The remembered frigate is charging a broadside larger than the Sparrow. | Brace | Halve failure hull loss and prevent crew injury against the heavy shot. |
| Corsair Ace | **Attack vector committed.** The ace has traded distance for one clean firing pass. | Burn | Spend 1F for +12 power and improve the chance to seize the pass first. |
| Ice Raiders | **Boarding clamps open.** White-hulled corsairs are matching speed with their clamps exposed. | Board | Accept greater failure risk for 25% more credits and medals on a win. |
| Swarm Brood | **Chitin cloud closing.** Half-grown probes are thickening around the shield line. | Brace | Halve failure hull loss and prevent crew injury if the brood reaches the hull. |
| Veil Wraith | **Blind angle moving.** The contact vanishes whenever sensors or crew look directly at it. | Burn | Spend 1F for +12 power and improve the chance to force a decisive pass. |
| Corsair King | **Flagship alongside.** The old captain is presenting a prize broadside and daring a boarding reply. | Board | Risk lower effective power for 25% more credits and medals from the flagship. |
| Eclipse Echo | **War-form unfolding.** The echo is opening weapon limbs the Spur was never built to answer. | Brace | Halve failure hull loss and prevent crew injury if the war-form fires. |
| Ember Raider | **Breach team heating.** Raiders are welding toward Cargo while their own hull runs exposed. | Burn | Spend 1F for +12 power and improve the chance to stop the breach. |
| Hollow Shade | **Name forming.** A second line of writing is appearing beneath the crew's name on the hull. | Brace | Halve failure hull loss and prevent crew injury if the mark completes. |
| Crown Warden | **Verdict chambered.** The Warden has finished its warning and loaded a gold verdict round. | Brace | Halve failure hull loss and prevent crew injury if the verdict lands. |
| Eclipse Throne | **Halo collapsing inward.** The Throne's halo is drawing every nearby signal toward its core. | Burn | Spend 1F for +12 power and improve the chance to act before the collapse. |

Tests reject blank fields, unknown recommendations, reasons that contradict current order effects, or accidental tutorial exposure of Burn/Board.

## Literal reward bands

A reward band is the inclusive minimum and maximum claimable payout for the saved offer's currently possible terminal paths, evaluated against the current player snapshot.

It includes each currency that can be non-zero on at least one path: credits, medals, reputation, gems, and fuel. It does not combine currencies into a synthetic score and does not count XP, hull loss, injury, fuel cost, or story flags as rewards.

Display examples:

- `40–100 credits · 2–8 medals · 0–4 reputation`
- `120 credits · 8 medals · 4 reputation`
- `40–525 credits · 9–45 medals · 0–18 reputation · up to 8 gems`

A single value is shown once. A zero minimum is shown when failure can remove that currency. `Up to` is reserved for currency absent on some valid paths. The accessible label uses the same literal values.

Add a pure `contractRewardBand(player, offer)` helper beside contract review logic. It enumerates saved `routeContent` without mutation:

1. reliable and strange offers include every saved Secure/Push terminal reward path;
2. risky offers include saved low/high encounters, success/failure rewards, and all orders;
3. Board success applies the existing 1.25 credits/medals scale before site scaling;
4. combat failure applies the existing 22% credits, 25% medals, and zero reputation before site scaling;
5. existing trade, delivery, salvage, story, cargo, reputation, hull, weapons, and repeat-visit helpers supply the math;
6. tutorial distress uses its guaranteed payout;
7. invalid saved content returns unavailable instead of inventing a range.

The helper returns structured values plus a label. Card, review, and accessibility copy share one formatter. Acceptance already snapshots the route content used by the band, so reload cannot change the displayed or claimable range.

## Combat balance matrix

A deterministic report imports production combat functions and evaluates all 16 encounters with Brace, Burn, and Board at these crew-power ratios before order modifiers:

- underpowered: `0.75 × encounter power`;
- even: `1.00 × encounter power`;
- advantaged: `1.25 × encounter power`;
- dominant: `1.50 × encounter power`.

Each row records effective power, win chance, fuel, success/failure payout, expected currency payout, hull-loss multiplier, and failure-injury policy. Tutorial guarantees are separate.

Committed Markdown/JSON evidence makes dominant-order patterns visible. The gate validates completeness and repeatability; it does not fail because a current value looks weak. Tuning remains a later owner-approved package.

## Deterministic 30-day free-player simulator

### Purpose and production reuse

Measure whether the free loop supports one useful daily chapter and expose current source/sink pressure. Use production player creation, fuel regeneration, board generation, preview/commit, claim, expedition, and improvement-cost helpers. Inject time and random draws. If a production transition calls `Date.now()` internally, add an optional clock argument with unchanged runtime defaults.

No duplicate reward formula is allowed. Aggregation may be new; gameplay math must come from production modules.

### Fixed baseline

- fresh free save with current wallet, fuel cap/rate, Sparrow, systems, and crew;
- one check-in every 24 hours at the same simulated local time;
- claim natural regeneration and record cap waste;
- claim the prior expedition and start one available expedition using production recommendations;
- complete one normal contract when fuel and hull permit;
- no ads, purchases, paid fuel, skips, premium grants, manual clock changes, catch-up, or compensation;
- stop invalid/unaffordable actions and record the reason.

Three free strategies exercise current choices without pretending to model spenders:

| Strategy | Contract | Route/order | Improvement |
|---|---|---|---|
| cautious | Reliable, Strange, Risky | Secure; Brace | Cheapest available credit-funded ship improvement after the contract; otherwise save. |
| balanced | Strange, Reliable, Risky | Secure unless Push differs and leaves 2F; Burn only if it adds at least 10 percentage points and leaves 1F, otherwise Brace | Same cheapest-valid rule. |
| ambitious | Risky, Strange, Reliable | Push; Board at 75%+ displayed chance, otherwise affordable Burn, otherwise Brace | Same cheapest-valid rule. |

Thresholds are simulator inputs, not player recommendations or balance changes.

For each day/strategy, record wallets, hull, offers/choice, route/order/chance/outcome, fuel gained/spent/wasted, blocked actions, rewards by source, improvements, affordability gaps, injuries, incomplete milestones, and no-useful-action days. Cumulative output includes sources, sinks, net movement, completed contracts/expeditions, and system levels.

Run a documented fixed seed set. Commit concise Markdown plus machine-readable JSON and report median/worst seed for useful-session completion, fuel starvation, accumulation, and improvement cadence.

Light/high-spender scenarios, target bands, acceptable cadence, and tuning recommendations remain omitted until separately approved.

## UI and analytics

Combat shows encounter name, tell, orders, recommendation badge/reason, then existing chance/cost/payout/consequence facts. Contract card and review use the shared literal range. Derivation failure shows `Reward unavailable` and disables acceptance for invalid content.

Existing `combat_order_selected` telemetry gains authored recommended order and whether the player followed it, answering: **Do players understand and use different orders when tells change?** Analytics never controls rewards.

No new modal, tab, animation, navigation surface, or currency treatment is introduced.

## Save, migration, and rollback

Tells are bundled static content; bands are derived view data. No save migration or wallet rewrite occurs. Existing saved route content remains authoritative. Optional clock/RNG and analytics fields default to current behavior.

Rollback removes display fields and reports without changing save version, balances, route identity, encounter identity, or claim history.

## Tests and evidence

Write failing tests before implementation.

- Exactly 16 encounter IDs have complete, valid tells; tutorial rules remain intact.
- Combat and encounter numeric values remain unchanged except optional dependency injection.
- Tutorial, reliable, risky, and strange fixtures enumerate every valid reward path.
- Board success, combat failure, scaling, repeat visits, and zero-minimum currency are covered.
- Card, review, and accessible labels share one formatter; reload preserves the range.
- Identical simulation inputs/seeds produce identical 30-day JSON.
- Wallet conservation reconciles every source and sink; no action bypasses production validation.
- No scenario uses purchases, ads, skips, or premium grants.
- `npm run test:loop`, `npm test`, `npm run build`, and the focused report gate pass.
- 390×844 and 360×800 evidence covers Board, review, recommendation states, long ranges, focus, 44px actions, 16px consequence text, and reduced motion.
- Physical iPhone/Android verification remains separate and cannot be inferred from emulation.

## Independent audit

Run a bounded read-only Grok subscription audit after the first complete implementation diff and again before review-ready status. Provide exact base/HEAD, approved spec, scoped diff, test ledger, and runtime evidence. Grant no edit, commit, push, deploy, purchase, or production authority. Codex owns integration and reruns every accepted finding. A tool failure or plan without a substantive verdict is unavailable, not approval.

## Stop condition

The package stops when the roster, derived UI, deterministic reports, automated gates, and phone-sized runtime evidence are reviewed with no open Critical or Important findings.

Completion does not authorize tuning, monetization, PR #1 merge, Pages publication, Jest upload, or Jest production activation. Each requires a separate explicit owner decision.
