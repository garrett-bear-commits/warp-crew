# Contract Route and First-Session Loop Design

Status: approved direction, written specification awaiting implementation approval
Date: 2026-09-21
Product direction: [`docs/design/20-product-direction-draft.md`](../../design/20-product-direction-draft.md)
Completion contract: [`docs/19-outcome-requirements.md`](../../19-outcome-requirements.md)

## Purpose

Replace Warp Crew's dense, instant-resolution mission map with a phone-first daily loop built around three readable contracts, one persistent short route, one consequential command decision, a visible return payout, one improvement, and an away expedition. Rewrite the first session so it teaches that same repeatable loop and then ends cleanly.

The package preserves the current node catalog, encounter catalog, fuel system, crew power, ship systems, rewards, expeditions, and story flags. It changes how those systems are selected, sequenced, explained, and persisted.

## Player promise for this package

In five to ten minutes, a free player can:

1. understand three different jobs at a glance;
2. finish one complete contract without buying fuel;
3. make a route decision and a combat order whose consequences are previewed;
4. bring the payout back to the Sparrow and improve something;
5. send an away team and leave knowing what will be ready next.

The game may offer optional continuation only after that loop is complete. This package does not add or tune paid offers.

## Scope

### Included

- a deterministic daily Contract Board with Reliable, Risky, and Strange offers;
- a persistent two- or three-beat active route;
- preview/commit transitions with double-tap protection and resumable state;
- Brace, Burn, and Board combat orders with legible tradeoffs;
- a version-three first-session script using one guaranteed distress contract;
- reward return and claim on the ship instead of an instant detached payout;
- a compact daily-plan prompt that yields the playfield after each action;
- an expedition party picker that explains recommendations and opportunity cost;
- a secondary Explore map preserving the existing node catalog and story access;
- save migration, analytics events, automated tests, and 390 by 844 evidence.

### Explicit non-goals

- final economy, offer, bundle, subscription, or pass values;
- real-money purchase authority or cross-device cloud saves;
- real-time tactical combat;
- a new star-map renderer;
- new currencies or a larger static content count;
- final body-family art;
- multi-ship fleet dispatch;
- production deployment or activation.

## Navigation and screen hierarchy

The bottom navigation keeps the existing **Missions** label during this package to avoid unrelated navigation churn. Its default view becomes **Contracts**.

The Missions screen has three views:

1. **Contracts** — default; shows the active route or the three-card board.
2. **Away** — shows expedition destinations and the party picker.
3. **Explore** — shows the existing sector map for free travel, story cleanup, and long-form progression.

The view selector uses three full-width, 44px-minimum segmented controls. An active contract replaces the board until its reward is claimed. Explore remains visible while a contract is active, but starting free travel is disabled with the explanation “Finish or abandon the active contract first.” This prevents two competing location authorities.

No screen shows the Contract Board, full star map, expedition list, and tutorial coach at once.

## Daily Contract Board

### Offer set

The board contains exactly one offer of each profile:

| Profile | Promise | Route length | Base fuel | Candidate destinations |
|---|---|---:|---:|---|
| Reliable | predictable credits and reputation | 2 beats | 2 | visible `trade` or `travel` nodes whose combat weight is at most 25% |
| Risky | combat payout and medals | 3 beats | 2, plus 1 only when Burn is chosen | visible `danger` nodes or nodes whose combat weight is at least 40% |
| Strange | story, discovery, or unusual salvage | 2–3 beats | 2 | visible `story` or `salvage` nodes |

`base fuel` is the sum of two one-fuel route actions before engine and crew reductions. The engine/passive fuel rules already used by travel apply independently to each paid action. A fresh account starts with enough fuel to complete any first board offer.

If a profile has no qualifying visible node, generation uses these fallbacks in order:

- Reliable: any visible non-danger node;
- Risky: the visible node with the greatest combat weight;
- Strange: the visible node with the greatest story-plus-salvage weight;
- final fallback: `lane_a`, `danger_belt`, and `scrapyard` respectively.

### Deterministic generation

The board seed is `<local-day-key>:<career-band>:<ship-id>`. `career-band` is `intro`, `spur`, `veil`, `ember`, `hollow`, or `crown`, derived from the highest unlocked sector. A small seeded PRNG selects among eligible destinations, titles, and one-line briefs. The generated offers are stored in the save; reopening the game never rerolls them.

The board refreshes on the first session of a new local day only when no contract is active. If midnight occurs during a route, that route and its original board remain authoritative until reward claim or abandonment. Completed offer IDs remain marked for that board day so reloads cannot recreate rewards.

### Card contract

Every card shows, without opening details:

- profile name and color-independent icon;
- title and one evocative sentence;
- total normal fuel cost;
- “2 beats” or “3 beats” expected length;
- primary reward family;
- danger label: Low, Guarded, or High;
- one favored crew role or ship system and why it matters;
- one 44px-minimum **Review** button.

Review opens one bottom sheet with the destination, exact currently payable fuel, expected reward band, possible injury/hull consequence, favored trait, and **Accept contract**. Accepting stores the route but spends nothing. Fuel is spent only by a clearly labeled route action.

## Persistent route model

### Saved state

`player.activeContract` stores a complete snapshot:

```js
{
  id: 'contract_<dayKey>_<profile>',
  offerId: 'offer_<dayKey>_<profile>',
  boardDay: 'YYYY-MM-DD',
  profile: 'reliable' | 'risky' | 'strange',
  title: string,
  destinationId: string,
  favoredTrait: { kind: 'role' | 'system', id: string, label: string },
  stage: 'briefing' | 'choice' | 'confrontation' | 'return' | 'claimed',
  revision: number,
  routeSeed: number,
  choiceId: string | null,
  encounterId: string | null,
  orderId: 'brace' | 'burn' | 'board' | null,
  result: null | {
    success: boolean,
    rewards: { credits: number, medals: number, reputation: number, gems: number, fuel: number },
    hullLoss: number,
    injuredCrewId: string | null,
    storyFlag: string | null,
    summary: string
  }
}
```

`player.contractBoard` stores `{ dayKey, offers, completedOfferIds }`. `player.stats.contractsCompleted` and `player.stats.contractsByProfile` track durable progression. Currency is not granted until claim.

### Transition contract

Every mutation is split into preview and commit:

- `previewContractAction(player, action)` returns cost, predicted consequence, enabled state, and a `revision` token without mutation.
- `commitContractAction(player, preview, { rng })` rejects a stale revision, insufficient fuel, wrong stage, or already-applied action.
- a successful commit increments `activeContract.revision` exactly once.

The caller persists the committed player before starting visual animation. Reloading during animation therefore resumes the next stable stage rather than replaying a spend or grant.

### Route beats

1. **Briefing / launch** — the player sees the chosen crew and trait match. **Launch · 1F** spends the first route fuel and advances to `choice`.
2. **Route choice** — two buttons state consequence before commitment:
   - **Secure the contract** spends 1F and resolves the profile's lower-variance result;
   - **Push the signal** spends 1F and advances to a confrontation or discovery with a stronger reward opportunity.
3. **Confrontation / discovery** — combat presents an enemy tell and the three orders. A non-combat Strange discovery presents two equivalent consequence-preview choices through the same preview/commit interface.
4. **Return** — the ship is shown in flight and then at home. The result is stored but not granted. **Bring it aboard** claims the reward exactly once, marks the offer complete, clears `activeContract`, and focuses the most relevant improvement room.

The lower-variance Reliable path may finish after beat two. Risky always reaches a confrontation. Strange reaches a confrontation only when its snapshotted route content calls for one.

### Abandonment

The player may abandon only at `briefing` with no cost. After launch, **Break contract** requires a confirmation sheet, grants no pending reward, preserves fuel already spent, returns to the ship, and records `contract_abandoned`. It never costs gems.

## Contract payout boundaries

The package does not create a new reward multiplier stack. It snapshots and resolves rewards through existing `scaleSitePayout()` rules.

- Reliable secure outcomes use an eligible destination's existing trade or delivery reward.
- Risky outcomes use the selected existing encounter reward.
- Strange outcomes use an existing story flag or salvage reward.
- repeated-destination decay continues to use the existing visit count.
- tutorial combat keeps the current guaranteed reward: 120 credits, 8 medals, and 4 reputation.

The only new reward modifier is Board: on victory it grants 25% more credits and medals, rounded down. It does not multiply reputation, gems, or fuel. This value is a named balance input and must appear in the later 30-day economy simulation before release approval.

No contract card promises an exact randomized result. It shows a literal band calculated from the snapshotted eligible outcomes; the resolved reward must fall inside that band.

## Combat orders

Free additive assists leave the player with an obvious “select the largest bonuses” answer. Contract and Explore combat replace the assist picker with one order.

| Order | Preview | Mechanical result | Cost |
|---|---|---|---|
| Brace | protect hull and crew | normal win chance; failure hull loss is halved; no combat injury | none |
| Burn | seize initiative | +12 effective power before the win-chance calculation | 1 additional fuel |
| Board | risk crew for salvage | -10% effective power; victory credits and medals +25%; failure injures one participating crew member | none |

The interface displays the recalculated win chance, fuel cost, payout effect, and failure consequence before confirmation. Odds copy uses **Guaranteed** for the scripted tutorial fight, never “Sure.”

Each encounter gains an authored tell with a short label, one sentence, and a recommended order. The recommendation explains a consequence; it does not secretly change the math. The first tutorial encounter tells the player to Brace and guarantees victory. Later fights allow all three orders.

Legacy `ASSISTS` data may remain only as a save/API compatibility adapter during this package. No player-facing combat path may render the old assist picker after migration.

## First-session script version 3

The tutorial uses the same production systems as the daily loop.

| Phase | Player action | Result |
|---|---|---|
| `distress` | tap the Bridge alert and review the only distress contract | cost, reward, danger, and favored crew are introduced |
| `launch` | launch the route | 1 fuel is spent and the Sparrow visibly departs |
| `order` | read the Pirate Scout tell and choose Brace | guaranteed victory through the real order system |
| `return` | bring the payout aboard | tutorial reward is claimed and a visible Sparrow repair/light state is activated |
| `recruit` | recruit Jen | third berth opens; Jen enters through the airlock and walks to the Workshop |
| `choose` | review three profiles and accept one next contract | the tutorial transitions to real daily choice |
| `away` | choose and launch the Dustfall expedition party | the player sees return time, reward, risk, and unavailable crew |
| `done` | return to the ship | tutorial UI disappears; compact daily plan shows the next useful action |

The tutorial does not show a registration or cross-device claim. Existing optional platform login remains outside this flow and must use truthful local-progress copy until cloud persistence exists.

The first fight cannot be abandoned and only Brace is enabled. The tutorial route consumes at most 2 fuel. No store, gem price, fuel purchase, gacha pull, or paid prompt appears before `done`.

## Tutorial migration

`TUTORIAL_SCRIPT` becomes `3` and the player save version becomes `7`.

- a new or zero-progress career starts at `distress`;
- a completed or dismissed version-two tutorial stays complete and does not replay;
- an active version-two tutorial with `firstCombat === false` starts version three at `distress`, retaining wallet, crew, stats, and purchases;
- an active version-two tutorial with `firstCombat === true` and `hiredThird === false` starts at `recruit` and cannot claim the tutorial combat reward again;
- an active version-two tutorial with `hiredThird === true` starts at `choose`;
- an invalid or partial `activeContract` is cleared during migration; valid version-three snapshots are normalized field by field;
- veteran players receive one dismissible Contract Board introduction sheet, not the first-session tutorial.

Rollback to the previous code will ignore the additive contract fields. No existing wallet, crew, ship, story, purchase, or expedition field is renamed or removed.

## Return, improvement, and daily plan

Claiming a contract reward focuses one improvement without spending automatically:

1. Engineering when hull is below 70%;
2. a room whose next upgrade is affordable;
3. a crew member with an affordable level;
4. Away when no immediate improvement is affordable.

The ship shows one compact objective chip, never the persistent coach card. `dailyPlan(player, dayKey)` has three milestones:

- **Contract** — claim one contract reward today;
- **Improve** — buy one ship-system upgrade, crew level, or crew rank today;
- **Away** — launch one expedition today.

The chip shows only the next incomplete milestone and `n/3`. It disappears when all three are complete. The full state is available in the Log. These milestones are guidance, not a reward-bearing checklist in this package.

## Expedition party choice

The Away view preserves the current destinations and timers but stops launching an invisible auto-picked team.

- each destination card shows preferred role, success chance, duration, success reward, failure reward, and injury risk;
- tapping **Choose crew** opens a bottom sheet with 64px portraits and 44px selection rows;
- the current recommendation is preselected and every recommended member has a reason such as “Scout match,” “highest ready power,” or “expedition passive”;
- the player may select from one up to `expeditionPartySize(player)` ready crew;
- success chance and both reward outcomes update immediately from the selected real crew;
- assigned crew are labeled unavailable for contracts until return;
- launch requires an explicit confirmation containing the return clock and opportunity cost.

The version-three tutorial limits the destination list to Dustfall but allows the same party-selection interaction. It does not permit a zero-member launch.

## Ship feedback

This package uses the ship foundation rather than adding detached screens for results.

- accepting a contract places a route marker in Operations;
- launch triggers the existing space-flight layer and sends assigned crew to Bridge/Engineering anchors;
- a pending return highlights Cargo and places the reward claim there;
- the tutorial payout sets a durable `flags.sparrowFirstRepair` state that changes a localized light/effect, providing the first visible ship improvement;
- expedition launch sends selected crew to Cargo/Airlock anchors before their status changes to `expedition`;
- reduced-motion mode preserves state changes and uses fades/static emphasis instead of particle travel or camera movement.

No animation may delay persistence or make the outcome unclear.

## Failure and recovery behavior

- insufficient fuel leaves state unchanged and offers return-to-ship or existing fuel-source navigation; no paid modal opens automatically;
- critical hull blocks launch before fuel spend and focuses Engineering;
- no ready crew blocks launch with the exact reason;
- a stale preview returns `stale_contract_action` and the UI rerenders current state;
- unknown offer, destination, encounter, order, or saved stage clears only the invalid contract state and records a recovery event;
- a reload at `choice`, `confrontation`, or `return` restores the same content and revision;
- reward claim is idempotent; repeated claim calls return `already_claimed` with no grant;
- changing the local clock cannot reroll an active route or grant a completed offer twice.

## Analytics vocabulary

Events answer explicit product questions and contain no free-form player text.

| Event | Required fields | Product question |
|---|---|---|
| `contract_board_seen` | board day, three destination IDs, completed count | do players reach and understand the choice set? |
| `contract_reviewed` | offer ID, profile, destination, fuel, trait match | which information drives selection? |
| `contract_accepted` | offer ID, profile, destination, trait match | which captain identity is chosen? |
| `contract_action` | contract ID, stage, action ID, fuel, revision | where do routes stall or recover? |
| `combat_order_selected` | encounter, order, shown chance, extra fuel | are tradeoffs used rather than one dominant answer? |
| `contract_resolved` | profile, success, beats, order, reward fields, hull loss, injury | are routes satisfying and balanced? |
| `contract_reward_claimed` | profile, reward fields, elapsed seconds | does the return loop complete? |
| `contract_abandoned` | profile, stage, fuel spent | why do players leave routes? |
| `daily_plan_progress` | day, milestone, completed count | does the session reach improvement and away setup? |
| `expedition_party_changed` | destination, party size, role match, shown chance | do players understand away-team agency? |
| `tutorial_stage` | script `3`, phase, elapsed seconds | where does the first session lose players? |

Existing `travel`, `combat`, and `expedition_start` events remain for Explore and compatibility, but contract activity must not be double-counted as free travel.

## Accessibility and phone rules

- target viewport evidence: 390 by 844 and 360 by 800 CSS pixels;
- every actionable control is at least 44 by 44 CSS pixels;
- essential card and consequence text is at least 16px;
- profile, danger, success, and selection states use icon/text in addition to color;
- bottom sheets fit above safe-area navigation and never obscure their triggering card's required context;
- route stages have one visually primary action;
- screen-reader names include contract profile, title, fuel, danger, and primary reward;
- focus returns to the triggering card after closing Review or crew selection;
- reduced motion disables camera shake, route particles, and reward-flight motion without skipping information.

## Test and QA contract

### Deterministic system tests

- exactly three distinct profiles are generated for eligible new and veteran saves;
- a saved board is stable across reload and PRNG changes;
- fallback generation always returns three valid offers;
- every stage rejects wrong-stage and stale-revision commits without mutation;
- fuel is charged once per paid action and never at Review/Accept;
- route resume produces the same destination, encounter, choice, and reward band;
- Brace, Burn, and Board match their previewed costs and consequences;
- reward claim and board completion are idempotent;
- active-route midnight behavior cannot reroll or duplicate rewards;
- version-two tutorial migrations enter the specified version-three phase without duplicate reward;
- veteran saves do not replay the first-session tutorial;
- daily milestones advance only on the matching committed actions;
- selected expedition crew, displayed chance, and launched crew IDs agree.

### Regression tests

- existing fuel regeneration, hull repair, node visibility, story flags, gacha, hull ownership, purchase recovery, and expedition resolution remain green;
- Explore travel continues to reach every visible node when no contract is active;
- old assist-shaped call sites either adapt to one order or remain test-only compatibility paths;
- save migration preserves wallet, crew, reserve, ship, story, expedition, and `iapFulfilled` data.

### Phone evidence

Capture and inspect at 390 by 844 and 360 by 800:

1. tutorial distress card;
2. three-card board;
3. contract review sheet;
4. route choice;
5. each combat order preview;
6. return reward inside Cargo;
7. improvement focus;
8. expedition party picker;
9. active expedition and compact daily plan;
10. Explore with active-contract travel disabled;
11. reduced-motion equivalents.

The harness measures touch targets, text size, vertical obstruction, scroll reachability, and persistence across a real page reload. Real iPhone and Android touch, safe-area, performance, and interruption checks remain release gates and cannot be replaced by desktop emulation.

## Package completion criteria

This package is complete only when:

1. the version-three tutorial reaches the real three-offer board and real expedition picker;
2. a free fresh save can complete the tutorial and one normal route without purchasing fuel;
3. an active route survives reload at every stage without duplicate spend or reward;
4. all player-facing combat uses Brace, Burn, or Board with consequence previews;
5. reward claim visibly returns to the Sparrow and promotes one improvement;
6. the persistent coach and false cross-device tutorial copy are absent;
7. all automated and phone-sized gates above pass;
8. the default regression suite and production build pass;
9. the implementation, telemetry, migration, economy impact, and QA evidence are documented;
10. production remains untouched.
