# Living-Ship Core Vertical Slice

Status: written design for Garrett review; **not implementation approval**

Date: 2026-09-22

Supersedes the first-session and combat presentation assumptions in the 2026-09-21 Contract Route spec; it does not silently change the live build or approve production.

## Intent and player promise

Warp Crew is a phone-first, high-resolution pixel-art game about building an unusual mercenary crew and operating a ship together. The player should understand the ship and its people by acting on them, not by reading route sheets. The repeating pleasure is to recruit a character with a distinctive trait, discover where that character excels, reconfigure stations and away teams, survive a job, improve the ship, and slowly build a galaxy-wide reputation that improves future recruiting luck.

Combat is semi-complex and crew-run. The captain chooses staffing and priorities, then watches crew carry them out, with occasional emergency orders at clear threat moments. It draws inspiration from FTL's readable systems, threats, and multiple responses, but is not a copy of its interface or a high-APM tactics game. A free five-to-ten-minute session must contain at least one understandable, consequential choice and one satisfying payoff. Spending is never required to finish that session.

The two iPhone recordings from 2026-09-22 are negative baseline evidence: the small card splash, tiny ship, long contract/combat sheets, blocked navigation, and one-button outcomes do not satisfy this promise. Passing route tests or completing seven tutorial phases did not establish a fun first play.

## Decomposition

This document specifies the **first playable vertical slice**, not the entire overhaul. It must prove the core interaction in a fresh save and in one repeatable normal job before expanding to the whole catalog.

1. **This slice:** full-screen pixel-art opening; close ship camera; legible station/crew assignment and routes; one guided short fight and one repeatable normal fight using crew-run simulation; one free curated recruit; ship naming; truthful optional Jest registration; phone-first UI and evidence.
2. **Next combat/content package:** additional enemy patterns, station/trait interactions, boarding and damage-control depth, encounter migration, difficulty and reward tuning.
3. **Next progression/art package:** reputation odds simulation, daily/free pull cadence, duplicate value, ship upgrade visuals, alien/droid movement families, consistent portraits, and away-mission presentation.
4. **Later release package:** cloud-save authority, purchase verification/recovery, fair monetization model, full-device QA, and separate Jest production decision.

Only package 1 is in scope for the first implementation plan. Packages 2–4 require their own design and approval. No new art generation is authorized by this spec alone.

## Visual language and asset boundary

The chosen style is **high-pixel-count, high-quality “new retro” pixel art throughout**. The splash and portraits may be more detailed and cinematic than in-ship sprites, but all families use intentional pixel clusters, clean hard edges, consistent lighting and material language, and no soft airbrushed or photoreal finish. The mood remains cool, adventurous sci-fi with varied human, alien, droid, and eccentric mercenary silhouettes.

The first art batch is bounded to one portrait-phone splash scene, a separate Warp Crew logo overlay, and canonical identity sheets for Rex, Bolt, and the three first-pull candidates: Kira, Tink, and Nemi. The existing 1152×1728 Sparrow cutaway is the initial ship reference; its geometry may be corrected or locally extended to make doors, halls, and stations unmistakable. The package must not generate replacements for all 46 portraits or nine hulls. The logo and loading indicator are rendered UI, not text baked into the scene. The indicator reflects actual preload progress and never stalls waiting for optional assets.

Before any metered Flora GPT Image 2.5 generation, the implementation plan must name references, intended output count, estimated total cost, and a cap for Garrett's approval. Every completed or uncertain run is logged immediately with prompt, model, output identity, cost, disposition, and hash. An uncertain response is checked against recent generations before any retry. Source art is preserved and accepted exports are reviewed at true phone size. No duplicate generation is made without a named defect.

UI layout is fixed before decorative chrome: the ship owns the playfield, the next threat or action has one clear visual priority, and text is limited to brief labels and optional detail. Controls meet phone touch/safe-area requirements. The first ship view is close on the bridge and adjacent stations, not a full-hull miniature. The player can pan to other rooms; a simple recenter control returns to the current event. Camera, hit regions, crew canvas, effect anchors, and path geometry share one transform.

## Repeatable gameplay contract

The cycle is: **choose a job → staff ship and away team → crew execute the job while the captain responds to threats → claim rewards and reputation → recruit and improve → reconfigure for the next job**. Station assignment persists until the player changes it or crew availability changes. It is a strategic setup choice, not mandatory pre-fight busywork.

- A crew member has one current assignment: a ship station, an away team, recovery, or reserve. An unavailable crew member cannot simultaneously operate a station.
- A station has a clear output and visible state. The initial combat-relevant outputs are helm/evasion, shields/mitigation, weapons/attack, and engineering/repair. Unmanned stations retain a limited baseline output so a fresh two-person ship is playable.
- A character's role and authored trait alter a *specific observable behavior* at a relevant station or on an away team. The UI shows what changed; it does not reduce identity to an unexplained total-power percentage.
- Ship upgrades improve or open station capacity and visibly change the ship or station state. The first tutorial reward activates one visible improvement. Numeric upgrade balance beyond the slice is not approved here.
- Jobs and expeditions grant reputation for completed work. Reputation is persistent and slowly improves recruitment rarity odds. The existing threshold table and separately purchasable Luck are provisional baseline behavior, **not** approval of their pacing or paid fairness. This slice may show the current reputation progress and actual current odds, but must not claim a tuned curve. A later deterministic free/light/high-spender simulation and explicit fairness decision are required before changing odds or monetizing Luck.

## Crew-run combat

Combat is a resumable encounter state, not an immediate power roll disguised with animation. A deterministic, seeded simulation advances in short beats. The saved encounter snapshot includes crew/station assignments, ship systems, enemy pattern, current hull/shield/system states, cooldowns, order availability, RNG state or an equivalent replay-safe event index, and revision. Save/commit precedes presentation so reload cannot spend fuel or grant rewards twice.

The UI shows both ships, the current threat, important station outputs, and crew responses on the cutaway. Crew automatically man, fire, evade, shield, repair, and recover according to assignment, role, trait, and a small authored priority policy. Enemy tells identify the threatened system and time to impact. Damage changes visible ship/system state. Movement follows visible hallways and doors to an authored work position; if no valid route exists, the actor does not teleport through scenery. Reduced motion preserves state changes and timing information without decorative movement.

The player can issue an **occasional emergency order** at a telegraphed decision window. An order has a visible cost, effect, cooldown or use limit, and consequence; the first fight teaches only Brace. Normal fights allow more than one meaningful response, including doing nothing to conserve a resource. Orders are captain-level priorities; the crew carry them out automatically. The legacy Brace/Burn/Board values are a compatibility baseline, not final design for the new simulation. Exact order math and enemy tuning are tested and reviewed before extending beyond the slice.

The guided fight is short, forgiving, and guaranteed to end in a win through an authored encounter contract rather than a concealed one-roll override. A second, repeatable non-tutorial fight uses the same simulation without guaranteed success and demonstrates a different enemy tell. Other existing encounters retain their current resolver in QA until individually migrated; the UI must distinguish legacy results, and the new system is not production-complete while that split remains. A normal loss must leave a recoverable ship and an intelligible reason.

## First-session sequence

Target: the player reaches the first win within roughly two minutes without opening a long contract sheet. Timing is a QA target, not an animation that forces waiting.

1. Full-screen crew-inside-ship splash: distinct mercenary silhouettes, galaxy/nebula/planet beyond a viewport, separate logo, real loading progress, one **Board ship** action when essential assets are ready.
2. The camera opens near the Sparrow bridge. A distress signal appears on the ship. A short visual cue shows one crew-to-station assignment; the player repeats it. No multi-tab tutorial navigation or unavailable tab that can be tapped into an error.
3. The first pirate appears and telegraphs an attack. The assigned crew visibly reaches the station and works it. The player uses one Brace order; the crew resolve the encounter on screen. The win is quick and visually celebrated without blocking repeated taps or reload.
4. Reward cargo and reputation move into their corresponding ship/HUD states. One station or ship detail visibly improves. The player names the **ship**; a default name is supplied and can be accepted without typing.
5. The player receives one free first pull, explicitly labeled as a guaranteed-Uncommon welcome pull, with a uniform random identity from Kira (gunner/Weapons), Tink (engineer/Shields), or Nemi (scout/Away). The awarded crew joins the roster exactly once and is shown in their useful context; the player may change the suggested assignment. This pull is recorded in normal pull history and pity state. No paid offer or store prompt appears here.
6. Offer optional Jest registration after the reward and pull, with a skip path. Current persistence is localStorage only; the screen must not promise cross-device recovery or that registration alone saves progress remotely. A genuine save-protection claim requires the later cloud-save package.
7. The tutorial ends cleanly on the ship, showing one next useful contract and one future away-team opportunity. Advanced systems reveal gradually through use, not a second mandatory text tutorial.

Existing saves keep earned crew, currency, purchases, reputation, routes, and completed tutorial status. A new tutorial script/version applies only to fresh players. An active version-three tutorial stays on its version-three flow until it finishes; it is not restarted or given the new first-win or welcome-pull rewards. Completed and veteran saves do not replay either tutorial. New-script interruptions resume at a stable beat. First-win, first-pull, and naming commits are idempotent. QA reset is separate from migration.

## Interfaces and implementation boundaries

- `starterShip` geometry is the authority for visible room polygons, doors, hallways, blockers, work anchors, station hit areas, and actor routing. Invalid paths report a debug error and settle the actor safely at its prior valid point; gameplay resolution does not depend on a decorative walk completing.
- Station assignments and crew availability are saved player state. A pure selector derives effective station outputs from roster, traits, ship upgrades, and injuries; the UI and simulation consume that same result.
- A pure combat transition takes `(encounterState, captainOrder?)` to `(nextState, events)`. Rendering consumes events; it does not decide rewards or outcomes. Persistence applies a revision check and exactly-once reward claim.
- A first-session state machine gates only relevant interactions, drives short cues, and records event timings. It does not invent a parallel combat or gacha rule set.
- A shared asset/style manifest records approved source/export paths, display sizes, family references, generator provenance, and shipped hashes. New portraits and movement assets must agree on recognizable identity.

## Verification and audit gates

Before an implementation plan is accepted, it must include tests written before behavior changes, exact affected save states, rollback strategy, and a QA-build-only deployment path. The initial package requires:

- deterministic simulation tests for crew assignment effects, enemy tells, emergency-order costs, loss recovery, pause/reload, and exact-once claim;
- first-session tests for skip/resume/migration, free curated pull, no duplicate reward, and no early paid prompt;
- geometry/path tests plus rendered recordings proving crew pass through the drawn doors and use the drawn stations, with no fallback teleport;
- phone-sized captures and real iPhone/Android passes for splash, assignment, threat, win, pull, naming, registration, and post-tutorial ship;
- a novice comprehension check: after one unprompted normal job, can the player explain why their crew assignment and emergency order mattered? Record time to first win and where they hesitate;
- a reproducible CSS/visual audit using Garrett's `mobile-game-design-basics-v11.zip` (SHA-256 `b83b3fa3e5f7ef1a3a278c335fa26b8f37f919fe84a903e7cc556969e8700760`) on the first QA build. Scope the relevant screens with Garrett, run its checklist/scripts, show before/after proposals, mark unverified render-only items, and change no audited UI without approval;
- a scoped read-only Grok or Claude audit of the first complete package diff, followed by local verification. External audit is not a substitute for personally running tests and phone QA.

Draft PR #1 stays unmerged. No Jest production activation, purchase activation, or new public deployment follows from approving this design or its implementation plan.
