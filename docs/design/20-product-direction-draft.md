# Warp Crew product direction

Status: approved product direction; implementation proceeds in reviewed packages  
Baseline: current build at `56693f4a6ea0cb7dce25c670e677d43a56db95e5`  
Provisional fairness assumption: all functional power can be earned through play

Approved by Garrett: 2026-09-21  
Approved direction: living ship first, short contract routes for active play, expeditions for away progression, and all functional power earnable through play

## The decision in one sentence

Make Warp Crew a **living-starship operations game**: the player returns to a ship full of visible people and problems, chooses a small contract route, makes one or two consequential command decisions, improves the crew or vessel, and sends an expedition away before leaving.

This uses the strongest existing foundations—the tall ship, crew, fuel, travel, encounters, expeditions, hulls, and timers—while fixing the current problem that most systems are lists whose outcomes happen immediately.

## Product promise

**Build the strangest, most capable mercenary crew in the galaxy aboard a ship that visibly grows with them. Take risky contracts, survive strange space, and turn a battered Sparrow into a legendary fleet—five satisfying minutes at a time.**

The promise has four parts:

1. **A living home:** crew walk, work, recover, argue, and celebrate in a ship the player understands spatially.
2. **A captain's choice:** each session contains a few legible decisions with different risks, rewards, and consequences.
3. **Endless ownership:** mercenaries, hulls, systems, cosmetics, routes, reputation, and lore produce overlapping progression horizons.
4. **Respectful brevity:** free players complete a satisfying daily chapter before encountering an optional way to continue faster.

## Three viable directions

### A. Living Ship Operations — recommended

The cutaway ship is the home screen and state display. Ready rewards, damaged systems, returning crew, available jobs, and story visitors appear in physical rooms. A daily contract route provides the active play. An expedition provides the away timer.

Strengths:

- makes the ship and four-direction crew animation central rather than decorative;
- gives upgrades an immediate visual payoff;
- naturally layers casual surface interactions over deeper crew and economy systems;
- creates contextual offer moments without opening on a store;
- preserves most current systems and content.

Risks:

- room geometry, art, character scale, and navigation must be rebuilt carefully;
- the home screen can become cluttered unless only the next useful states are emphasized;
- visible upgrades require more art states than text-only progression.

### B. Contract Route Runner

Each session is a three-to-five-jump route with branching events, escalating danger, and a final payout. Crew and ship choices change which branches are safe or profitable. The ship is primarily preparation and reward presentation.

Strengths:

- strongest immediate gameplay tension and replayability;
- fuel, risk, and route knowledge become meaningful;
- events and factions can deliver lore efficiently.

Risks:

- pushes sessions longer and makes interruption recovery harder;
- requires substantially more event, combat, and route content;
- weakens the living-ship fantasy and can resemble a lightweight roguelite.

### C. Mercenary Company Manager

The player recruits specialists, assembles multiple teams, dispatches them to timed jobs, and optimizes a growing fleet. The active layer is roster planning and collecting results.

Strengths:

- highly scalable collection and long-tail progression;
- clear demand for more crew, slots, timers, and cosmetic identity;
- naturally supports short check-ins.

Risks:

- the current auto-pick behavior becomes a spreadsheet unless crew abilities are much deeper;
- active travel and combat become secondary;
- aggressive timer monetization could make the game feel transactional.

## Recommended blend

Use Direction A as roughly 70 percent of the experience, Direction B as the active contract layer, and Direction C only for away expeditions and late-game fleet dispatch.

The player should describe Warp Crew as “the game where my weird crew lives inside my ship,” not “the game with a lot of menus.”

## The daily session

The target is one satisfying free session in five to ten minutes. The time is a design constraint, not a timer that ejects the player.

### 1. Return: 30–60 seconds

- The camera shows the most important ready state: an expedition shuttle docking, a repaired room lighting up, a visitor at the airlock, or a crew member holding recovered salvage.
- At most three claimable states are bundled into one arrival sequence.
- Rewards move visibly to their destination instead of appearing only as numbers.
- One sentence explains what changed while the player was away.

Player question: **What happened to my crew?**

### 2. Choose a contract: 45–90 seconds

Offer three large, readable contract cards:

- a reliable job with modest rewards;
- a risky job with a valuable target;
- a strange job carrying story, collection, or discovery value.

Each card shows fuel cost, expected duration, primary reward, danger, and the one crew or ship trait that matters. The player can inspect details, but the first decision remains understandable at a glance.

Player question: **What kind of captain am I today?**

### 3. Fly the route: 2–4 minutes

A normal contract contains two or three short beats, not a long level:

1. launch and route reveal;
2. one event, trade, salvage, or hazard decision;
3. an optional confrontation or final payoff.

Most beats consume one fuel. A session's free fuel should support a complete useful route before scarcity is presented. Choosing a more ambitious branch can spend additional fuel for more reward.

Player question: **Do I take the safe payout or push my luck?**

### 4. Improve something: 60–120 seconds

The payout should make at least one near-term improvement visible:

- repair or upgrade a room;
- level, rank, equip, or bond with a crew member;
- advance toward a hull or route milestone;
- choose one candidate or collection target.

Only the most relevant next improvement is promoted. Full collections and optimization remain available as optional depth.

Player question: **What changed because of this run?**

### 5. Set the next return: 20–45 seconds

The player selects an away expedition, confirms or adjusts the recommended crew, and sees the return time and main risk. The closing ship view shows the team depart and the next useful state without covering navigation with a coach card.

Player question: **What will be waiting for me?**

## Meaningful decisions without session bloat

The core session should contain three major decisions:

1. contract profile;
2. one route or encounter decision;
3. one improvement or away-team decision.

Everything else should either clarify those decisions or express their results. More buttons do not create more agency.

## Combat direction

Combat remains short and mostly automatic, but the player receives one consequential order after seeing an enemy tell.

Example order families:

- **Brace:** protect hull and injured crew, accepting a lower payout or missed pursuit;
- **Burn:** spend an engine or fuel charge to seize initiative and improve escape or victory odds;
- **Board:** risk crew injury for salvage, prisoners, or rare contract rewards.

Crew roles and ship systems alter the result of each order. The UI shows the likely consequence before confirmation. The animation then explains the choice: shields flare, engines overdrive, or an airlock team launches. Raw percentage bonuses may support the math but should not be the only visible distinction.

The first tutorial combat uses a guaranteed outcome and teaches one order. Later combat introduces the other orders and imperfect information gradually.

## Expedition direction

Expeditions are the main away timer and a crew-availability tradeoff.

- The game recommends a party but shows why each member was selected.
- The player may swap crew through large portraits rather than a compact text list.
- Destinations have one preferred role and one complicating trait.
- Success chance remains visible, but rewards, injury risk, and opportunity cost are equally legible.
- Repeated destinations visually deplete or evolve instead of only reducing a hidden multiplier.
- A returning team appears inside the ship with its result; collection is not a detached modal.

## Ship home direction

The ship is both navigation and the player's most important possession.

### Spatial rules

- One layout manifest defines visible room polygons, input hit regions, labels, doors, crew destinations, furnishing anchors, and camera focus.
- Touch regions may receive invisible padding to reach 44 by 44 CSS pixels, but padding cannot overlap a neighboring room's decision area.
- Tapping a room focuses it and opens one bottom sheet with its status and primary action.
- The full cutaway remains readable at 390 pixels wide; focus mode enlarges characters and room details without requiring pinch zoom.
- A debug overlay can display polygons, walkability, doors, anchors, and current tap ownership.

### Proposed Sparrow compartments

The final count must follow the approved art, but the starter experience needs recognizable functions rather than four oversized rectangles:

- Bridge / Navigation
- Crew Quarters
- Medbay
- Cargo Hold
- Workshop / Weapons
- Engineering
- Engines
- Airlock / Expedition Bay

Rooms should change visually at milestone levels. Early upgrades can use lighting, props, crew behavior, and localized effects before requiring wholly new hull illustrations.

## Crew identity and animation

Every mercenary needs continuity across portrait, roster card, walking sprite, work pose, and story appearance.

### Body-family strategy

Do not require 46 wholly independent animation sets for the first art pass. Author a small set of genuinely distinct directional body families, then add identity through heads, attachments, equipment, palettes, and selective bespoke animation.

Initial families could cover:

1. standard humanoid;
2. broad or armored humanoid;
3. small droid;
4. large mechanical body;
5. non-human biped with tail, crest, or wings;
6. floating, amorphous, or exceptional silhouette.

Exceptional characters—such as a cloud-being, living crystal, or ship-mind body—should receive bespoke treatment because their visual surprise is part of the collection value.

### Runtime contract

Each animation definition includes:

- source sheet;
- four direction rows;
- frame count and timing;
- authored crop rectangle;
- foot anchor;
- draw scale;
- room interaction offsets;
- optional shadow profile;
- reduced-motion idle fallback.

The renderer uses the actual frame motion. It does not add sinusoidal vertical bobbing.

## Progression horizons

### Minutes: the contract

Earn a payout, survive a consequence, and make one improvement.

### Days: the crew and Sparrow

Open rooms, recruit specialists, repair weaknesses, improve systems, and resolve a local story arc.

### Weeks: reputation and hull identity

Reach new factions and galaxies, complete collection sets, choose specialized hull strengths, and unlock visible ship transformations.

### Months and beyond: fleet and mastery

Build multiple purpose-driven hulls, field specialist companies, pursue prestige cosmetics and rare mercenaries, complete faction campaigns, and enter renewable seasonal contract maps.

The nine existing hulls can seed this structure, but later hulls should not be only larger numerical containers. Trade, combat, expedition, collection, and strange-technology identities need different play incentives and visible interiors.

## Lore delivery

Required lore stays brief; optional lore can be rich.

- Contract cards use one evocative sentence.
- Required transmissions use two or three short panels with a character portrait.
- Crew react inside the ship after consequential events.
- Discoveries add optional dossier entries for players who want depth.
- Repeated locations change copy and appearance as their state changes.
- Internal roadmap language never appears in the player-facing universe.

The tone should be dangerous, funny, and strange rather than encyclopedic. Characters carry the lore; logs support it.

## Monetization principles — provisional

These principles assume all functional power is earnable through play. They remain subject to approval and simulation.

1. The first free session is complete and satisfying before a fuel shortage or paid offer.
2. Purchases accelerate a goal the player already understands; they do not introduce an unexplained system.
3. No mercenary, hull function, combat order, or progression tier is permanently payment-exclusive.
4. Paid collection always has transparent odds, pity, duplicate value, and a deterministic long path to a chosen target.
5. Fuel buys optional continuation or an ambitious branch, not relief from an intentionally empty session.
6. Cosmetics and identity carry high-end spending without destabilizing balance.
7. Timed offers are contextual and truthful; no fake scarcity, false discounts, or tutorial ambushes.
8. Prices come from authoritative platform product data.
9. Paid grants require verified, idempotent authority before launch.

### Product roles to model

- **Starter bundle:** a Sparrow paint, a useful but earnable crew choice, premium currency, and fuel after the player completes an upgrade and understands the contents.
- **Fuel extension:** a small immediate refill and a better-value reserve pack for players who choose to continue a route.
- **Crew collection:** pulls plus deterministic target progress, with direct candidate offers used selectively.
- **Captain's subscription:** predictable premium currency, cosmetic identity, and convenience; no exclusive combat power.
- **Seasonal contract pass:** a free reward track plus paid cosmetics, collection choice, and acceleration after the core loop is stable.
- **Fleet cosmetics:** hull paints, room themes, engine trails, uniforms, portraits, and arrival effects.

Exact prices, amounts, offer frequency, subscription benefits, and conversion values require the economy simulation. Nothing in this draft approves those numbers.

## First-session outline

1. **See the Sparrow in trouble.** One urgent room is highlighted; no wall of HUD text.
2. **Accept a distress contract.** The single available card teaches cost, reward, and danger.
3. **Launch.** The ship leaves visibly and the player sees the short route.
4. **Read one enemy tell and issue one order.** The result is guaranteed but visually tied to the choice.
5. **Bring the reward home.** Currency repairs or powers a visible ship element.
6. **Recruit Jen.** She enters through the airlock, walks with the real four-direction animation, and takes a station.
7. **Choose the next contract from three profiles.** This is the transition from tutorial to real play.
8. **Launch an away expedition.** The player leaves with a concrete return promise.
9. **Offer account protection only when real cross-device persistence exists.** Until then, make no recovery claim.

The tutorial should end, not become a permanent card. Contextual hints can appear once near the relevant control and disappear after the action.

## Success questions

The first playable package should answer these questions with evidence:

- Can a new player explain the contract, fuel, crew, and ship relationship after one session?
- Does the player make at least three understood choices rather than tapping through rewards?
- Does the ship visibly change within the first session and again within the first day?
- Can the player stop after five to ten minutes feeling complete rather than blocked?
- Does an optional continuation purchase appear only after that complete loop?
- Are mercenaries recognizable when walking at phone size?
- Do room taps select what the art implies?
- Does the player know what will be ready on return?

## Deliberate non-goals for the first redesign package

- real-time tactical combat;
- manual joystick movement;
- a full fleet dispatch simulator;
- dozens of new currencies;
- 46 bespoke animation sets before body-family tooling works;
- live subscriptions or passes before purchase and save authority exists;
- expanding content counts before the existing first-session and daily loop are proven.

## Implementation sequence

The approved direction is implemented as separately reviewable packages. The first package specifies the Sparrow layout and animation contract. Later packages cover the exact first-session flow, daily-loop states, combat and expedition decisions, and economy simulation inputs.
