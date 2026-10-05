# Combat walls, retention rhythm and boarding — design proposal

Status: proposal for Garrett's approval. Nothing here approves prices, grant amounts or live offers.
Builds on: [product direction draft](../../design/20-product-direction-draft.md) monetization principles, [Jest monetization research](../../research/2026-09-21-jest-platform-monetization.md).
Shipped so far (branch `claude/hud-overhaul`): real-time crew fights for every contract, threat-scaled damage, salvage on loss, Brace/Repair/Burn/Board, captain stays aboard, readiness readouts.

## 1. What a good day in Warp Crew looks like

Target: two to three short check-ins a day, each with a reason to open the app and a reason to come back.

| Check-in | What the player does | What pulls them back |
| --- | --- | --- |
| Morning (3–5 min) | Claim overnight fuel, fight one contract (30–60 s), send an away team (2–4 h). | Away team returns midday; fuel refills. |
| Midday (2–3 min) | Collect the away team, level a crew member or buy an upgrade, second contract if fuel allows. | Daily milestones 2/3; injured crew heal. |
| Evening (3–5 min) | Finish milestones, try the chapter wall (boss contract), send the overnight away team (6–8 h). | Overnight return; tomorrow's board and the wall. |

Levers already in the code: fuel 1/h (cap 10), away timers, injuries, daily milestones (contract / improve / away), daily board, free daily hire.

## 2. Walls

A wall is a chapter-boss contract whose threat is **Deadly (≥1.3)** for a player who arrives on the expected day. The existing threat readout is the wall meter: players watch it fall from Deadly → Dangerous → Even as they grow.

- **Placement:** one wall per chapter. The first wall should arrive around day 3–4 for a free player, after the first session is fully satisfying (principle 1).
- **Free path (target 2–4 days per wall):** crew levels (medals), ship upgrades (credits), better recruits (daily free hire, reputation), smarter staffing (gunner on Weapons is worth ~30–40 win-rate points at high threat).
- **Persistence breaks walls — proposed "Siege" rule:** hull damage dealt to a chapter boss persists until the next daily reset. A losing attempt still chips the boss, pays salvage, and makes the next attempt easier. Coming back twice a day literally wears the wall down.
- **Losses stay worthwhile:** salvage (already shipped) plus boss chip damage, so attempts never feel wasted.

## 3. Wall breakers and skips (paid — to model, not to build yet)

Every paid item accelerates something a free player can already earn (principle 3). Offers appear only when the player is at a wall they understand (principles 2 and 7).

| Product role | What it does at a wall | Free equivalent |
| --- | --- | --- |
| Wall-breaker pack (contextual, once per wall) | A targeted recruit choice (e.g. gunner or engineer), a ship-upgrade kit, a few medals. | Daily hires, credits, medals over 2–4 days. |
| Premium currency bundle | Pulls, luck, hull purchases. | Daily login gems, reputation gates. |
| Skips | Recall an away team now; heal an injury; refill fuel; finish a timed upgrade. | Waiting. |
| Captain's subscription | Daily gems, a fuel reserve, cosmetic identity. No exclusive combat power. | — |

Skip value needs timers worth skipping. Proposal: ship upgrades above level 3 take real build time (30 min → 8 h), making "finish upgrade" a natural skip and a reason to check back.

**Blocked before any live sale:** verified purchase authority, idempotent grants and cross-device save (see research doc gaps). These stay on the roadmap ahead of offers.

## 4. Combat depth, introduced slowly

| Phase | Unlock (guided-flow captains) | Mechanic | Status |
| --- | --- | --- | --- |
| 0 | Start | Brace, Repair, seeded volleys, crew crits | Shipped |
| 0 | 3 contracts | Burn (1 fuel, +3 damage for 3 beats) | Shipped |
| 0 | 5 contracts | Board (below half enemy hull; +25% on success, injury on failure) | Shipped |
| 1 | ~8 contracts / chapter 2 | **Enemy boarders** (below) | Proposed |
| 2 | Chapter 3 | Hull breaches and fires in rooms; engineers respond | Proposed |
| 3 | Chapter walls | Multi-phase bosses with Siege persistence | Proposed |

### Enemy boarders (phase 1)

Enemies whose tell already says they board (Scrapper Gang, Ice Raiders, Corsair King) can dock a boarding party mid-fight.

- A tell warns one beat ahead: "Clamps on the Cargo airlock."
- 2–3 hostile sprites (the crew rig's alien/droid families in raider colours) walk in from the airlock toward a target room and **sabotage it**: that station's output drops each beat they stay.
- Player response: tap **Repel boarders** and pick a crew member; they walk to the room and fight. Security and gunner roles repel faster. Pulling someone off Weapons to do it is the trade-off.
- Resolution is seeded and beat-based like everything else, so saves, replays and reward bands stay deterministic.
- Ignored boarders take the room offline until the fight ends. Failure never ends the fight on its own.

This reuses the ship's pathing, walk rig and room hit targets, and turns the ship view itself into part of the fight.

## 5. What to measure once analytics are live

Win rate by threat band and staffing; days spent at each wall; sessions per day and D1/D7 retention; salvage-vs-win share; offer views and conversion at walls; skip usage by timer type.

## 6. Decisions needed

1. Approve the daily rhythm targets and first-wall timing (day 3–4).
2. Approve the Siege rule (boss damage persists until daily reset).
3. Approve timed upgrades above level 3 so skips have value.
4. Approve enemy boarders as the next combat package (phase 1).
5. Confirm purchase authority and cloud save come before any live wall-breaker offer.
