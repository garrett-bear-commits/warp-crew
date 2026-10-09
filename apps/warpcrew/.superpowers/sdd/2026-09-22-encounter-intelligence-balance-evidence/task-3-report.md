# Task 3 report

Status: DONE. Starting HEAD: bf53ab7. Commit: 8bc8ec6 (feat: derive live contract reward bands). No push, merge, deployment, or activation performed.

## Scope and implementation

- src/systems/contractRewards.js: moved production crew selection, route payout, full combat mutation unchanged in operation order and now/RNG seams. Added raw currency presence beside normalized payouts and the shared literal formatter.
- src/systems/contracts.js: production commits use shared helpers. Band enumeration uses JSON-safe disposable players, production accept/preview/commit, both terminal RNG extremes, feasible orders only, and deduplicated normalized payouts. Accepted unresolved contracts continue their saved current stage instead of reaccepting. Resolved contracts return unavailable from this pre-resolution helper; UI must display their stored result.
- test/contract_rewards.test.mjs: tutorial and all normal profiles, immutable input, accepted reload, modifiers, visits, injury readiness/sorting/cap, exact Board flooring, failure zeros versus omitted gems, insufficient fuel, disabled Burn, accepted stage costs, board-content changes, malformed content.
- test/final_review.test.mjs: destination override fixture now snapshots sorted authored low/high combat outcomes alongside the destination. Old fixtures changed destinationId alone; accepting mismatched content would violate the new rejection requirement. Controller approved this bounded fixture correction.

Acceptance rejects invalid saved content instead of regenerating it. Existing ensureContractBoard legacy repair is unchanged. No wallet/save migration, gameplay coefficients, claim sequence, or runtime default changes. Existing production result objects gain optional rewardPresence metadata; claim ignores it. All unrelated files remain untouched.

## RED: initial focused test (exit 1)

```text
node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/garrettdare/warp-crew/src/systems/contractRewards.js' imported from /Users/garrettdare/warp-crew/test/contract_rewards.test.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:992:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:701:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:721:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:759:56)
    at #resolve (node:internal/modules/esm/loader:683:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:603:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:163:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:253:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///Users/garrettdare/warp-crew/src/systems/contractRewards.js'
}

Node.js v24.19.0
```

## Additional RED: inconsistent combat content (exit 1)

Added the missing-encounter identity assertion before tightening validation. Full assertion values:
```text
AssertionError [ERR_ASSERTION]: inconsistent combat identity is invalid
actual: {
  available: true,
  currencies: {
    credits: { min: 92, max: 525, presentOnAllPaths: true },
    medals: { min: 9, max: 45, presentOnAllPaths: true },
    reputation: { min: 0, max: 18, presentOnAllPaths: true },
    gems: { min: 0, max: 8, presentOnAllPaths: false }
  },
  paths: [
    { credits: 420, medals: 36, reputation: 18, gems: 8, fuel: 0 },
    { credits: 92, medals: 9, reputation: 0, gems: 0, fuel: 0 },
    { credits: 525, medals: 45, reputation: 18, gems: 8, fuel: 0 }
  ],
  label: '92–525 credits · 9–45 medals · 0–18 reputation · up to 8 gems'
}
expected: {
  available: false, label: 'Reward unavailable', currencies: {}, paths: []
}
at test/contract_rewards.test.mjs:74:8
Node.js v24.19.0
```

## Initial regression failure and resolution

The initial npm run test:loop passed its 11 scripts, then final_review passed 13/15:
```text
✖ invalid normal contracts at the tutorial destination do not reconcile tutorial phase or fuel
TypeError: Cannot set properties of null (setting 'profile')
at test/final_review.test.mjs:151:35
✖ Risky branches snapshot low and high authored destination encounters and disclose fallback
AssertionError [ERR_ASSERTION]: no_active_contract
false !== true
at step (test/final_review.test.mjs:14:10)
at test/final_review.test.mjs:163:18
```
Both were caused by the incoherent destination override fixture described above. No production validation was relaxed. The initial chained npm test did not run because test:loop exited 1. Both commands were then rerun successfully after the fixture correction.

## GREEN: focused tests (exit 0)

Command: node test/contract_rewards.test.mjs && node test/contract_route.test.mjs && node test/contract_board.test.mjs && node test/combat_orders.test.mjs

```text
contract_rewards.test.mjs OK
contract_route.test.mjs OK
contract_board.test.mjs OK
combat_orders.test.mjs OK
```

## GREEN: full regression output (exit 0)

```text
> warp-crew@0.1.0 test:loop
> node test/combat_orders.test.mjs && node test/contract_board.test.mjs && node test/contract_route.test.mjs && node test/tutorial_v3.test.mjs && node test/expedition_party.test.mjs && node test/contract_ui.test.mjs && node test/daily_loop.test.mjs && node test/contract_ship_feedback.test.mjs && node test/session_loop.test.mjs && node test/explore_orders.test.mjs && node test/dialog_focus.test.mjs && node --test test/final_review.test.mjs

combat_orders.test.mjs OK
contract_board.test.mjs OK
contract_route.test.mjs OK
tutorial_v3.test.mjs OK
expedition_party.test.mjs OK
contract_ui.test.mjs OK
daily_loop.test.mjs OK
contract_ship_feedback.test.mjs OK
session_loop.test.mjs OK
explore_orders.test.mjs OK
dialog_focus.test.mjs OK
✔ completed offers survive day A to B to A, reload, and stale-result replay (3.848666ms)
✔ saved tutorial return remains claimable after encounter catalog loss (1.294542ms)
✔ invalid pre-result tutorial routes recover playably without repeating launch spend (2.320584ms)
✔ tutorial confrontation recovers from missing profile without charging launch twice (1.023625ms)
✔ tutorial return with missing profile recovers safely without duplicate reward (0.890875ms)
✔ tutorial confrontation recovers from unknown_profile profile without charging launch twice (0.76025ms)
✔ tutorial return with unknown_profile profile recovers safely without duplicate reward (0.949125ms)
✔ tutorial confrontation recovers from risky profile without charging launch twice (0.669917ms)
✔ tutorial return with risky profile recovers safely without duplicate reward (0.510333ms)
✔ invalid normal contracts at the tutorial destination do not reconcile tutorial phase or fuel (0.725625ms)
✔ Risky branches snapshot low and high authored destination encounters and disclose fallback (3.641291ms)
✔ contract claims apply route, win, and participant XP progression once with tutorial exceptions (0.90575ms)
✔ offer beat ranges and resolution telemetry match committed route branches across days (6.475875ms)
✔ existing saved boards repair displayed beat lengths without rerolling their offer identity (0.3035ms)
✔ production launch and Jen descriptors show the ship only after durable publication (0.293084ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 91.164541

> warp-crew@0.1.0 test
> node test/timer.test.mjs && node test/fuel.test.mjs && node test/economy.test.mjs && node test/daily.test.mjs && node test/travel_phase_a.test.mjs && node test/platform_iap.test.mjs && node test/phase_c.test.mjs && node test/tutorial_week.test.mjs && node test/sanity.mjs && node test/tutorial_v3.test.mjs && node --test test/final_review.test.mjs

timer.test.mjs OK
fuel.test.mjs OK
economy.test.mjs OK
daily.test.mjs OK 2026-09-23
travel_phase_a.test.mjs OK
[platform] Local mock active (no JestSDK).
[platform] mock schedule wc_fuel_full Fuel tanks are full, Captain. The Spur is waiting.
platform_iap.test.mjs OK
phase_c.test.mjs OK 46 mercs 51 nodes
tutorial_week.test.mjs OK { nodes: 51, planets: 34, beats: 30, day5nodes: 20 }
OK crew 46 nodes 51 planets 34 visits 1 beats 30 map 7 exp 3 enc 16
tutorial_v3.test.mjs OK
✔ completed offers survive day A to B to A, reload, and stale-result replay (3.824792ms)
✔ saved tutorial return remains claimable after encounter catalog loss (1.292125ms)
✔ invalid pre-result tutorial routes recover playably without repeating launch spend (2.023417ms)
✔ tutorial confrontation recovers from missing profile without charging launch twice (0.966375ms)
✔ tutorial return with missing profile recovers safely without duplicate reward (0.862583ms)
✔ tutorial confrontation recovers from unknown_profile profile without charging launch twice (0.673584ms)
✔ tutorial return with unknown_profile profile recovers safely without duplicate reward (1.021833ms)
✔ tutorial confrontation recovers from risky profile without charging launch twice (0.666584ms)
✔ tutorial return with risky profile recovers safely without duplicate reward (0.480125ms)
✔ invalid normal contracts at the tutorial destination do not reconcile tutorial phase or fuel (0.6355ms)
✔ Risky branches snapshot low and high authored destination encounters and disclose fallback (3.435709ms)
✔ contract claims apply route, win, and participant XP progression once with tutorial exceptions (0.857333ms)
✔ offer beat ranges and resolution telemetry match committed route branches across days (6.87125ms)
✔ existing saved boards repair displayed beat lengths without rerolling their offer identity (0.36475ms)
✔ production launch and Jen descriptors show the ship only after durable publication (0.322958ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 90.54925

```

## Self-review

Compared extracted production branches with original code: payout normalization, Board-before-site floors, hull, injury selection/deadline, XP, win stats, result summaries and ready crew semantics preserved. Raw presence is captured before normalization. Fuel previews precede every commit and branch copies do not mutate input. Checked exact-once claims via unchanged existing regression assertions. git diff --check passed.

Concerns: none blocking. UI wiring and package test-script integration are later tasks; the new test was run explicitly. Burn has the same currency outcomes as Brace, so its disabled-order assertion uses production preview alongside unchanged deduplicated bands. No build or browser/physical-device verification was requested for this helper task.

## Review correction: unknown saved story flags

Fix commit: ffcfb96 (fix: reject unknown contract story identities).

Changed files: src/systems/contracts.js and test/contract_rewards.test.mjs.

The reported malformed story payout was reproduced for both board offers and accepted unresolved contracts. Validation now requires each story outcome flag and any non-null saved storyFlag to be an own key in the production STORY_BEATS catalog. Object.hasOwn also rejects inherited object names such as toString. This leaves applyStoryFlag and its already-completed known-story fallback unchanged.

RED command: node test/contract_rewards.test.mjs (exit 1). Full output:

```text
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: malformed board and accepted story identities must be unavailable
+ actual - expected

+ [
+   {
+     flag: 'not_a_real_story',
+     label: '40 credits · 3 reputation',
+     name: 'board'
+   },
+   {
+     flag: 'not_a_real_story',
+     label: '40 credits · 3 reputation',
+     name: 'accepted'
+   },
+   {
+     flag: 'toString',
+     label: '40 credits · 3 reputation',
+     name: 'board'
+   },
+   {
+     flag: 'toString',
+     label: '40 credits · 3 reputation',
+     name: 'accepted'
+   }
+ ]
- []

    at file:///Users/garrettdare/warp-crew/test/contract_rewards.test.mjs:93:8
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [
    {
      name: 'board',
      flag: 'not_a_real_story',
      label: '40 credits · 3 reputation'
    },
    {
      name: 'accepted',
      flag: 'not_a_real_story',
      label: '40 credits · 3 reputation'
    },
    {
      name: 'board',
      flag: 'toString',
      label: '40 credits · 3 reputation'
    },
    {
      name: 'accepted',
      flag: 'toString',
      label: '40 credits · 3 reputation'
    }
  ],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

Node.js v24.19.0

```

GREEN command: node test/contract_rewards.test.mjs && node test/contract_route.test.mjs && node test/contract_board.test.mjs && node test/combat_orders.test.mjs && npm run test:loop && npm test (exit 0). Full output:

```text
contract_rewards.test.mjs OK
contract_route.test.mjs OK
contract_board.test.mjs OK
combat_orders.test.mjs OK

> warp-crew@0.1.0 test:loop
> node test/combat_orders.test.mjs && node test/contract_board.test.mjs && node test/contract_route.test.mjs && node test/tutorial_v3.test.mjs && node test/expedition_party.test.mjs && node test/contract_ui.test.mjs && node test/daily_loop.test.mjs && node test/contract_ship_feedback.test.mjs && node test/session_loop.test.mjs && node test/explore_orders.test.mjs && node test/dialog_focus.test.mjs && node --test test/final_review.test.mjs

combat_orders.test.mjs OK
contract_board.test.mjs OK
contract_route.test.mjs OK
tutorial_v3.test.mjs OK
expedition_party.test.mjs OK
contract_ui.test.mjs OK
daily_loop.test.mjs OK
contract_ship_feedback.test.mjs OK
session_loop.test.mjs OK
explore_orders.test.mjs OK
dialog_focus.test.mjs OK
✔ completed offers survive day A to B to A, reload, and stale-result replay (3.718333ms)
✔ saved tutorial return remains claimable after encounter catalog loss (1.272417ms)
✔ invalid pre-result tutorial routes recover playably without repeating launch spend (2.114542ms)
✔ tutorial confrontation recovers from missing profile without charging launch twice (1.011916ms)
✔ tutorial return with missing profile recovers safely without duplicate reward (0.854125ms)
✔ tutorial confrontation recovers from unknown_profile profile without charging launch twice (0.675625ms)
✔ tutorial return with unknown_profile profile recovers safely without duplicate reward (0.979792ms)
✔ tutorial confrontation recovers from risky profile without charging launch twice (0.660875ms)
✔ tutorial return with risky profile recovers safely without duplicate reward (0.460167ms)
✔ invalid normal contracts at the tutorial destination do not reconcile tutorial phase or fuel (0.477417ms)
✔ Risky branches snapshot low and high authored destination encounters and disclose fallback (3.14625ms)
✔ contract claims apply route, win, and participant XP progression once with tutorial exceptions (0.887208ms)
✔ offer beat ranges and resolution telemetry match committed route branches across days (6.963666ms)
✔ existing saved boards repair displayed beat lengths without rerolling their offer identity (0.444875ms)
✔ production launch and Jen descriptors show the ship only after durable publication (0.487625ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 89.807

> warp-crew@0.1.0 test
> node test/timer.test.mjs && node test/fuel.test.mjs && node test/economy.test.mjs && node test/daily.test.mjs && node test/travel_phase_a.test.mjs && node test/platform_iap.test.mjs && node test/phase_c.test.mjs && node test/tutorial_week.test.mjs && node test/sanity.mjs && node test/tutorial_v3.test.mjs && node --test test/final_review.test.mjs

timer.test.mjs OK
fuel.test.mjs OK
economy.test.mjs OK
daily.test.mjs OK 2026-09-23
travel_phase_a.test.mjs OK
[platform] Local mock active (no JestSDK).
[platform] mock schedule wc_fuel_full Fuel tanks are full, Captain. The Spur is waiting.
platform_iap.test.mjs OK
phase_c.test.mjs OK 46 mercs 51 nodes
tutorial_week.test.mjs OK { nodes: 51, planets: 34, beats: 30, day5nodes: 20 }
OK crew 46 nodes 51 planets 34 visits 1 beats 30 map 7 exp 3 enc 16
tutorial_v3.test.mjs OK
✔ completed offers survive day A to B to A, reload, and stale-result replay (3.710542ms)
✔ saved tutorial return remains claimable after encounter catalog loss (1.315958ms)
✔ invalid pre-result tutorial routes recover playably without repeating launch spend (2.016917ms)
✔ tutorial confrontation recovers from missing profile without charging launch twice (0.981792ms)
✔ tutorial return with missing profile recovers safely without duplicate reward (0.8545ms)
✔ tutorial confrontation recovers from unknown_profile profile without charging launch twice (0.697667ms)
✔ tutorial return with unknown_profile profile recovers safely without duplicate reward (0.9575ms)
✔ tutorial confrontation recovers from risky profile without charging launch twice (0.711417ms)
✔ tutorial return with risky profile recovers safely without duplicate reward (0.469833ms)
✔ invalid normal contracts at the tutorial destination do not reconcile tutorial phase or fuel (0.516708ms)
✔ Risky branches snapshot low and high authored destination encounters and disclose fallback (3.157458ms)
✔ contract claims apply route, win, and participant XP progression once with tutorial exceptions (1.218625ms)
✔ offer beat ranges and resolution telemetry match committed route branches across days (6.849083ms)
✔ existing saved boards repair displayed beat lengths without rerolling their offer identity (0.329417ms)
✔ production launch and Jen descriptors show the ship only after durable publication (0.305666ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87.639917

```

Self-review: catalog lookup is shared for board and accepted content validation. No payout code, balances, flags, or claim semantics changed. Tests cover unknown catalog keys and prototype keys in both routes, plus the literal known completed-story fallback for both routes. git diff --check passed.

Assessment of accepted Risky briefing with encounterId:null: left unchanged. Existing contractState validation permits null before confrontation; production Risky choice selects the encounter from its saved secureOutcome or routeOutcome before the combat preview. Thus valid saved outcome identities remain authoritative and no catalog-based resnapshot or invented encounter occurs. The stricter board snapshot consistency requirement remains in place. A blanket accepted-stage rejection would be a new persistence restriction without a concrete requirement, so no such restriction was added.

No subagents, push, deployment, merge, or activation. Unrelated image and package lock remain untouched.
