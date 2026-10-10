# FTL-lite crew fights (ruleset v3)

Status: direction approved by Garrett 2026-10-04 ("FTL-lite": tap an enemy room to target it, weapons charge and fire on their own, hold to fire together, shield layers, fires and breaches, drag crew to repair, tap to pause; no reactor power juggling; still resolves if left alone).
Scope of this spec: phase 1 (fight rules, fight screen, one HUD). Phase 2 (hit feedback, distinct enemy ship art), phase 3 (sector map, real events) and phase 4 (runs ending in flagship fights) get their own specs.

## Why

Today a fight is a 6-second beat loop where the player taps at most one optional order and watches. The enemy is a sprite and one hull number. FTL's appeal is the second-to-second decisions: which room to hit, when to fire so shots land together, who repairs. On a phone that has to work with one thumb and still finish if the player looks away.

## Rules

Time runs in **1-second beats**, each simulated as four 250 ms ticks. A beat is still the unit that is saved and validated (`revision === beat`, contract `revision === entry + beat`), so reloads, Rally, boarders, walls and the economy simulator keep working. Everything is seeded and deterministic.

### Ships

Both ships have **rooms**. Each room has integrity 0–100. Damaged rooms work worse; at 0 the system is offline.

| Player room | Ship room | What it does |
| --- | --- | --- |
| Weapons | Workshop | Charges the weapons |
| Shields | Operations | Raises and recharges shield layers |
| Helm | Bridge | Evasion (chance an enemy shot misses) |
| Engineering | Engineering | Crew here repair faster |

Enemy rooms: **Weapons, Shields, Engines** (evasion), **Helm** (the pilot; at 0 the enemy cannot dodge and its weapons charge slower).

### Hull

- The player's fight hull **is the ship's hull** (0–100). What you see in the top bar during and after a fight is the same number. A fight no longer starts at a fresh 30.
- Enemy hull keeps the existing 42-point scale (walls keep their 42-point segments, Rally's 20% and Board's half-hull rules are unchanged).

### Weapons and targeting

- Sparrow carries two weapons: **Burst Laser** (2 shots, charges in 9 s) and **Heavy Laser** (1 big shot, 11 s). Staffing Weapons speeds charging; a gunner there speeds it more.
- Weapons fire on their own when charged, at the **target room**. Tap an enemy room to target it. Default target when the player never touches anything: Shields, then Weapons once shields are down (a sensible idle captain).
- **Hold**: toggle it and weapons wait until all are charged, then fire together. That is how you punch through layered shields.
- Each shot: if the enemy has a shield layer up, the shot pops it and does nothing else. Otherwise it may miss (enemy engines), or it hits: hull damage plus room damage, and a chance to start a **fire**.

### Shields

Layers, not a pool. Sparrow: 2 layers, one recharges every ~2 s while the Shields room works. Enemies: 0–2 layers by threat. A damaged Shields room caps the layers.

### Enemy behaviour

1–2 enemy weapons with visible charge bars. When one is about to fire, the room it is aiming at is marked on your ship (the old "tell"). Enemy crew slowly repair enemy rooms, so knocking out their weapons buys time rather than ending the fight.

### Crew

- Crew start at their stations. **Drag a crew member to a room** (or tap crew, then tap a room) to send them there. In a room they repair it, put out fires and fight boarders.
- A station left empty works at baseline only.
- Free crew (no station) go where the ship needs them. When nobody aboard is free, a room that is burning, boarded
  or offline with nobody in it draws one crew member from a station that is not in trouble (the engineer first),
  who goes back once the room is whole, so a fight left alone still ends (added 2026-10-10).
- Existing boarders land in a room and sabotage it; crew in that room fight them (this replaces the Repel button).

### Fires

A hit can start a fire. A burning room loses integrity every second and can spread to a neighbour; crew in the room put it out. This is the main reason to move crew mid-fight.

### Kept orders

- **Overcharge** (was Burn): 1 fuel, weapons charge 50% faster for 8 s. Unlock rule unchanged.
- **Board**: unchanged (enemy at or below half hull, seeded chance, +25% payout, injury on failure).
- **Rally / concede**: unchanged near-miss rules (Rally restores 40 hull on the 100 scale).
- **Pause**: tap to pause. Client only; the fight already holds while the app is hidden or off the ship tab.

### Balance target

Threat (0.6–1.6) still drives the enemy: hull, shield layers, weapon count, damage and charge time. Fights should last 30–60 s. A hands-off captain should win about as often as today at each threat label; a captain who targets and moves crew should win clearly more. The economy simulator measures both (hands-off and a scripted "good captain").

## Fight screen (portrait, one thumb)

1. **Top third: the enemy ship.** Its rooms drawn over the hull with system icons, integrity, fire and boarder markers, its shield layers as a bubble and its weapon charge bars. Tap a room to target it.
2. **Middle: your ship**, framed so all rooms are visible. Room damage, fires, crew and the incoming-fire marker show here. Drag crew between rooms.
3. **Bottom strip** (replaces the big panel): hull bar, shield layers, your two weapon charge bars, Hold toggle, Overcharge, Board and Pause. Rally and the result appear here too.
4. The top HUD shows the same hull and shields as the fight.

## Compatibility

- New normal fights (contracts, Explore jumps, walls) use v3. Fights already saved as v1/v2 finish under their old rules.
- The two guided tutorial fights stay on v1/v2 in this phase; teaching targeting in the tutorial comes once the v3 screen has settled.
- Commands (target, hold, move crew) change the fight's *intent* without advancing time. Each carries the current revision so a stale tap is refused.
- The economy simulator plays v3 fights hands-off; walls, gems and the drydock reports are re-run.

## Out of scope for phase 1

Reactor power, doors and oxygen, missiles and drones, distinct enemy ship art (phase 2), the sector map and events (phase 3).
