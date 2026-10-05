# Sector map and events: implementation note

Implements `2026-10-04-sector-map-events-design.md` (FTL-lite phase 3). Decisions made while building it are marked **Decision**.

## Sector map

- `src/data/sectorMaps.js` holds one hand-placed map per sector (Spur, Veil, Ember, Hollow, Crown). Each map lists beacons with `x, y` in percent of the map box, plus undirected lanes. Lanes are global; a map draws a lane when both ends are on it.
- Gates sit on two maps: at the right edge of the sector they lead out of, and on their own map. The neighbour a gate connects back to is drawn on the gate's map as a dimmed "border" beacon, so the way back is always visible.
- **Jump rule**: a beacon can be jumped to when it is visible (existing `visibleNodes`: career day, story flags, Siege walls, all unchanged) **and** joined to your location by a lane. Spur Anchor is also in reach from anywhere when the hull is critical or when no lane from your location leads anywhere visible (**Decision**: a stranded or crippled ship can always limp home; nothing else teleports). Contract claims still move you to the contract destination, as today.
- Every career-day subset of each sector is connected: the day-1 Spur beacons form a connected graph around Spur Anchor, and every later beacon hangs off beacons that are visible before it. A data test checks this for every day and unlock step.
- You cannot jump to the beacon you are at (`already_here`); the old grid disabled it in the UI, now the session refuses it too.
- **Decision**: a gate whose sector you have already unlocked stays visible (`visibleNodes`), even if a later Siege-wall rule would hide it. Without this, a captain who opened the Veil before walls existed would have the Veil cut off from the Spur by lanes. For anyone who has not passed the gate, walls hide it exactly as before.
- Gates hidden behind an unbroken Siege wall show as a locked beacon ("Break the Spur siege wall") and cannot be selected.
- Map model (`src/systems/sectorMap.js`, `sectorMapModel`): beacons with type icon, visited count, fuel cost, `here`, `reachable` and a risk read. Risk read: the fight family of the beacon's most likely fight ("Pirates reported", "Swarm activity", "Scrappers working", "Ghost signals", "Wardens patrol"), the existing threat label for the strongest of those fights against the crew aboard now, and the fight share of arrivals ("Pirates reported · Even · 30% fight"). Quiet beacons say "No fights reported".
- UI (`src/ui/sectorMapView.js`): an SVG lane layer under absolutely positioned beacon buttons, sector chips above for unlocked sectors, and a beacon card under the map (name, blurb, risk read, what you might find, fuel, Jump). Tapping a beacon is `map-select` (UI state only); Jump is the existing `travel-to`. The old card grid remains only for the legacy script-2 tutorial path.

## Travel events

- `src/data/events.js`: 29 authored travel events. Each fits base outcome kinds (`trade`, `delivery`, `salvage`, `story`) and optionally sectors or beacons. Every visible beacon and non-combat outcome kind has at least two matching events (data test).
- A jump still rolls the beacon's weighted outcome as today. Combat opens the existing v3 travel fight. Any other outcome opens an event (**Decision**: the rolled outcome becomes the event's *base*; event results are fractions of that base, so each beacon's payout range cannot rise above today's values). Story base outcomes whose flag is already set keep today's instant consolation scrap.
- Saved state `player.activeEvent`: `{ version, eventId, templateId, nodeId, fromNodeId, base, seed, fuelSpent, openedAt }`. Jump fuel is spent when the event opens; location, visit count and jump count wait for resolution, like a travel fight waits for its claim.
- Choice shape: `{ id, label, need?: { role } | { captain }, cost?: { fuel | credits }, outcomes: [{ w, pay?, story?, hull?, injure?, fight?, hire?, text }] }`.
  - `pay`: 0 to 1 of the base reward, then the same scaling as today (visits, cargo, reputation, trader bonus).
  - `story`: applies the base story beat (same rewards and unlocks as today).
  - `hull`: hull damage (never below 1; stamps the dock-repair clock).
  - `injure`: one fighting crew member injured for the normal injury time.
  - `fight`: opens a v3 travel fight against the beacon's weakest combat encounter (sector default if the beacon has none). Fuel for the jump is already paid, so the fight costs nothing more; arrival happens on the fight claim.
  - `hire`: a named merc joins for the choice's credit cost when a berth is free and they are not already aboard.
- Requirements: a role needs a ready crew member with that role (the card names who does it); a captain need checks the captain template. Unavailable choices stay visible with the reason ("No Engineer aboard", "Bolt is away", "Needs 1 fuel", "No free berth").
- Odds: each choice lists its outcomes with their exact weights as percentages and the real numbers they would pay now.
- Resolution: `event-choose { eventId, choice }`. The roll is `hash(seed:choiceId)`, so the same choice always gives the same result (reloading cannot re-roll). The event is cleared in the same state change that pays, so it pays once; a stale or repeated tap fails with `stale_event` / `no_active_event`. The result shows on a result card held in UI state only (payout is already saved).
- Guards: no event while a contract, travel fight or encounter is active; contracts and jumps are refused while an event is open (`event_active`).
- Load: `normalizeEventState` runs in `migratePlayer`. A torn or tampered event (unknown template, base that is not one of the beacon's outcomes, template that does not fit, bad seed or fuel, or coexisting contract/fight) is dropped with a `travel_event_recovered` recovery entry and no payout.

## Contract route events

- `src/data/events.js` `ROUTE_EVENTS`: 8 authored route events replacing "Signal ahead". Picked deterministically from the contract's route seed among events that fit its profile, so a reload shows the same card.
- Each has two choices bound to the existing `secure` / `push` actions (**Decision**: route events do not add new outcomes, so contract reward bands, wall contracts, the economy baseline and route validation are unchanged). The card states the real stakes from the action preview: fuel, the fight and its threat label and victory prize, or the route payout.
- Buttons are the existing `contract-action` with an extra `choice` id; the session checks the choice belongs to the contract's event and matches the action, and records it in analytics.

## Economy

- The 30-day simulator picks route-event choices with its existing scripted route policy (cautious: the secure choice, ambitious: the push choice, balanced: unchanged rule) through the new choice ids.
- `auditExploreEvents` in `src/sim/contractEconomy.js` resolves every travel event for every fitting beacon and base outcome through the real resolver under three scripted policies (cautious: safest choice, balanced: best expected pay, ambitious: highest ceiling) and reports expected pay against today's instant value and the maximum single payout against each beacon's maximum. The report gains an "Explore events" section; the balance test asserts no event result exceeds its beacon's values.

## Tests

- `test/sector_map.test.mjs`: map data (every node placed, lanes valid, connected at every career day), jump rule, risk read, map render.
- `test/travel_events.test.mjs`: content counts and coverage, open/resolve/pay once, determinism, reload mid-event, tampering recovery, guards, role and cost gating, fight and hire outcomes, event card render.
- `test/route_events.test.mjs`: route event selection, choice/action binding, stale choice refusal.
