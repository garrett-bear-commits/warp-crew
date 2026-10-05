# Sector map and events (FTL-lite phase 3)

Status: part of the FTL-lite plan Garrett approved on 2026-10-04 ("Get it done"). Phase 1 (fights) shipped in 27de6ce; phase 2 (ship and enemy art) is in progress separately.

## Why

FTL's map makes every jump a decision: where to go next, what you might find, whether you can afford the fuel and the risk. Its events are short stories whose choices depend on your crew and equipment. In Warp Crew today:

- **Explore** is a grid of "JUMP" buttons with a fuel cost and a credit range.
- Jumps resolve instantly to a weighted outcome (`src/data/sectors.js` `outcomes`: trade, salvage, delivery, story, combat), with one line of log text.
- The contract route "event" is one sentence ("Signal ahead. What should the crew do?") with Secure / Push buttons and no stakes shown.

## Goals

1. **A real sector map.** Each sector (Spur, Veil, Ember, Hollow, Crown, as in `src/data/sectors.js` and `src/data/galaxies.js`) is a node graph: positioned beacons joined by lanes. Only nodes joined to your current location by a lane can be jumped to. The map shows node type icons, your ship, visited nodes, fuel cost, and an honest risk read ("Pirates reported · Even", using the existing threat labels). Gates to the next sector stay behind Siege walls exactly as today. Tap a node for its card (name, blurb, what might happen, Jump).
2. **Events instead of instant outcomes.** Non-combat arrivals (trade, salvage, delivery, story) and the contract route signal open an **event card**: two to four sentences of situation, then two or three choices with their stakes stated plainly (cost, reward range, risk such as hull damage, injury or a fight). Some choices need a crew role or captain type (for example "[Engineer] Patch their drive", "[Gunner] Warning shot") and show who would do it; unavailable ones show why. Risky choices state honest odds. Outcomes can pay currencies, cost fuel or hull, injure crew, start an FTL-lite fight (existing v3 travel fight path), offer a hire, or set story flags.
3. **Content.** At least 24 authored travel events across node types and sectors, and at least 6 contract route events replacing "Signal ahead". Same gritty, plain-spoken voice as the existing copy. No placeholder text.

## Rules

- Deterministic and save-safe like fights: a pending event is saved (`player.activeEvent` or similar), validated on load (tampered or stale state is recovered without payout), resolved once with a seeded roll, and never pays twice. A reload mid-event shows the same card.
- One thing at a time: no event while a contract or fight is active (mirror the existing `travel_fight_active` / `active_contract` guards).
- Payout ranges stay within today's outcome values for each node so the 30-day economy holds; the economy simulator resolves events with a scripted policy and the balance evidence is regenerated (`npm run test:balance`).
- The first session (tutorial scripts 4 and 5) must play exactly as now.
- Mobile portrait, one thumb, 375×812. Match the existing visual language (`src/ui/style.css` tokens, `hudView.js` icons, the FTL-lite fight screen in `src/ui/ftlView.js`).

## Out of scope

Pursuit pressure (FTL's rebel fleet), new sectors, store screens, and the fight engine itself.
