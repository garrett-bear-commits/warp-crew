# Enemy factions and twists in the fight (Phase 3), 2026-10-10

Design: [world design](../superpowers/specs/2026-10-10-world-design.md) §3 (twists in the fight) and §4 (factions).
Tests: `test/factions.test.mjs` (in `npm test`). Tables below the line are written by
`FACTION_EVIDENCE=1 node --test test/factions.test.mjs`.

## What the fights do now

Every crew fight (contracts, walls, Explore) carries its encounter's faction; the guided first fight does not.

| Faction | Encounters | Rule in the fight | Counter (in the tell) | What the sharp captain does |
|---|---|---|---|---|
| Corsairs | Pirate Scout, Pirate Wing, Corsair Ace, Corsair King | Their heavy gun (or an extra one) fires a **missile**: through shields, dodged by evasion. The ace and the king also **board**. | Crew the Helm to dodge; hit their Weapons. | Aims at their Weapons room; sends a free crew member to an empty Helm. |
| Scrappers | Scrapper Gang, Ember Raider | **Boarders**, as before, now for both. | Keep security free. | Sends a security officer (or gunner) to the boarded room. |
| Swarm | Eclipse Probe, Swarm Skirmish, Swarm Frigate Echo, Swarm Brood | Their cannon becomes **4 drones**: each takes a shield layer. The hull **regrows 1 a beat** unless one of their rooms burns, up to 15% of its hull per fight. | Set fires; finish them fast. | Fires as ready (no holding). |
| Ice Raiders | Ice Raiders | An extra **ion** gun: a hit freezes that room for 5 s (system offline), an engineer inside thaws it twice as fast; a hit on shields stalls them 4 s. Boarders as before. | An engineer thaws a room fast. | Aims at their Weapons; sends an engineer into a frozen room. |
| Shades | Veil Wraith, Hollow Shade | **Cloak** every 12 beats for 4 (first at beat 8): shots fired miss, held guns keep their charge, their guns keep firing. A Helm below half cannot cloak. | Hold fire while cloaked; wreck the Helm. | Holds while it is cloaked; just before a cloak, once their Shields room is below half, aims at the Helm. |
| Wardens | Crown Warden, Eclipse Throne | **Harmonics**: shields recharge twice as fast while their Shields room is above half. | Hit their Shields room below half. | Keeps aiming at Shields. |
| Eclipse | Eclipse Echo | **It learned**: cloak and regrowth together. | Both counters. | Holds only while cloaked, otherwise fires as ready. |

**Elites** (the Bounty twist): a name from `ELITE_NAMES` plus Armored (+1 shield layer), Veteran (repairs ×1.5),
Overclocked (guns charge 25% faster) or Heavy (+30% hull).

**Twists** (from `activeContract.twist`; never on Siege walls or the guided fight). Twist pay applies to a won fight;
a lost fight pays the usual salvage.

| Twist | In the fight | Met | Pay (credits) |
|---|---|---|---|
| Escort | A freighter (30 hull, 10% dodge, no shields) flies beside you; each volley has a 35% seeded chance to aim at it. | It survives | ×1.25, or ×0.7 if it is lost |
| Rush | A 30-second clock on the plate. | Won by beat 30 | ×1.35 |
| Bounty | The enemy is the named elite. | Always, on a win | ×1.4, medals ×1.5 |
| Holdout | Their guns hit 20% harder; still flying at beat 35 is a win. | A win | ×1.15 |
| Two waves | When the first ship falls a second arrives at 60% hull, fresh rooms and full shields. | Wave 2 falls | ×1.4 |

The fight result says what happened (`result.twist = { id, met }`), the payout reads it, and reward bands and win
odds play the same twisted fight (the sharp captain is one of the band's paths, so a met escort or rush shows).

## How the success tests were measured

- **Crews:** the balance pass's reference crews, frozen in `test/fixtures/reference-crews-day7.json`: the guided
  simulator's 15 captains at the end of day 7 (crew healed and aboard), so the numbers do not move when the sim does.
- **Fights:** each faction's encounters at a contested threat, where these crews win roughly 70-85% hands-off on the
  engine before factions: 1.5 for the first enemy class, 1.2 for the second, 1.0 for the heaviest; at hull 100 and 70;
  one distinct seed per fight. (At contract threat these crews win nearly every fight, so no rule can show.)
- **Policies:** Auto = no taps, abilities on Auto (today's targeting). Sharp = the new scripted captain. Smart = the
  simulator's captain (holds volleys while they have shields, shields then guns), for reference.
- **Before:** the same fights with the faction and twist blocks off and the old boarding list. That is today's engine
  exactly: its win counts equal a run of the same sample on the engine before this work (commit de4ccd7), and a
  golden replay of 75 fights (1,668 beats, kit and plain crews, boarders, tactics, a wall segment, the guided fight)
  hashes the same on both engines. Both are asserted in the test.

## Results

<!-- generated:start -->
In-suite sample (`test/factions.test.mjs`, 240 fights per faction, seeds from 5000; asserted on every run):

| Faction | Encounters | Fights | Before (Auto) | After (Auto) | Change | Sharp | Sharp vs Auto |
|---|---|---:|---:|---:|---:|---:|---:|
| Corsairs | pirate_scout, pirate_wing, pirate_ace, corsair_king | 240 | 67.1% | 62.9% | -4.2 | 82.9% | +20 |
| Scrappers | scrapper_gang, ember_raider | 240 | 67.1% | 68.3% | +1.2 | 67.5% | -0.8 |
| Swarm | swarm_probe, swarm_skirmish, swarm_frigate, swarm_brood | 240 | 68.8% | 68.3% | -0.5 | 67.9% | -0.4 |
| Ice Raiders | ice_raiders | 240 | 71.3% | 73.3% | +2 | 87.9% | +14.6 |
| Shades | veil_wraith, hollow_shade | 240 | 75% | 73.8% | -1.2 | 97.1% | +23.3 |
| Wardens | crown_warden, eclipse_throne | 240 | 81.3% | 85.8% | +4.5 | 100% | +14.2 |
| Eclipse | eclipse_echo | 240 | 84.6% | 85.8% | +1.2 | 100% | +14.2 |

Bigger sample (`FACTION_EVIDENCE=1`, about 960 fights per faction, seeds from 9000):

| Faction | Encounters | Fights | Before (Auto) | After (Auto) | Change | Sharp | Sharp vs Auto | Smart (sim captain), before → after |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Corsairs | pirate_scout, pirate_wing, pirate_ace, corsair_king | 960 | 66.1% | 65.3% | -0.8 | 84.5% | +19.2 | 66% → 63.6% |
| Scrappers | scrapper_gang, ember_raider | 960 | 69.2% | 69.2% | +0 | 68.2% | -1 | 67.1% → 68.2% |
| Swarm | swarm_probe, swarm_skirmish, swarm_frigate, swarm_brood | 960 | 64.9% | 63.2% | -1.7 | 62.9% | -0.3 | 63.8% → 61.3% |
| Ice Raiders | ice_raiders | 960 | 70.2% | 69.4% | -0.8 | 90.2% | +20.8 | 69.9% → 68.4% |
| Shades | veil_wraith, hollow_shade | 960 | 75.9% | 75% | -0.9 | 96.4% | +21.4 | 79.1% → 96% |
| Wardens | crown_warden, eclipse_throne | 960 | 85.1% | 84.7% | -0.4 | 100% | +15.3 | 94% → 100% |
| Eclipse | eclipse_echo | 960 | 83.5% | 83.6% | +0.1 | 99.8% | +16.2 | 94.7% → 96.3% |

<!-- generated:end -->

- **Success test 1 (each rule fires, old fights unchanged): met.** Missile, drone, ion, regrowth, cloak and boarding
  events all occur in their factions' fights; harmonics double the recharge (unit-checked); the golden replay is
  bit for bit.
- **Success test 2 (sharp at least 5 points over Auto where a counter exists): met** for Corsairs, Ice Raiders,
  Shades, Wardens and the Eclipse. Not met for the Scrappers and the Swarm, whose counters are crew and guns rather
  than taps (a security officer free, beams and crits for fires): there the sharp captain is level with Auto.
- **Success test 3 (Auto within 8 points of before, per faction): met**, within 5 on both samples.
- **Success test 4 (twists change the fight or the pay as written; saves): met.** The test plays each twist and
  checks its pay against the same fight without it; `validTwist` refuses unknown ids, elites on the wrong twist,
  unknown elite names or modifiers and extra keys; the validator refuses edited faction ids, cloak timers, ion
  locks, regrowth counts, freighter hull, wave, twist id, elite and the enemy's guns, and a fight whose twist no
  longer matches its contract; a reload mid-fight replays identically; a bad contract twist is dropped on its own.

## The balance gates (`test:balance`)

The Veil wall is now a Swarm fight (the Swarm Frigate Echo), so the crew-matter success test 2 in
`test/balance_success.test.mjs` plays drones and regrowth. Tuned to keep its shape (15 day-7 captains × 48 seeds;
"before" is the same test on commit de4ccd7):

| Ship hull | Typical crew, before → now | With a Legendary, before → now | Gain, before → now |
|---:|---:|---:|---:|
| 100 | 81.8% → 79.0% | 86.1% → 84.8% | +4.3 → +5.8 |
| 80 | 67.6% → 63.2% | 77.2% → 74.0% | +9.6 → +10.8 |
| 60 | 38.6% → 39.3% | 60.5% → 57.9% | +21.9 → +18.6 |

Success test 3 there (an idle Auto-on captain on the day-7 boards and the Veil wall): 90.6% before and after on the
old engine; 90% before and after now (the day-7 captains differ a little, since their first week's fights changed).
The 30-day economy gates pass; the regenerated evidence is in `2026-09-22-encounter-balance-evidence.md` and
`artifacts/contract-economy-30-day.json`.

## Tuning (the design's numbers were starting values)

| Rule | Design | Now | Why |
|---|---|---|---|
| Missile | one gun through shields | the heavy gun (or an extra gun) at 1× the cannon's damage, 15 s charge | at 1.4× (the heavy gun is 1.8×) a missile landed nearly every volley and Auto lost 28 points |
| Drones | many weak shots | 4 drones; past one shield layer they land 90% of what the cannon would, 80% room damage each | each drone strips a layer: 5 drones carrying 80% of the volley cost Auto 35 points; lighter drones made the Veil wall easy and cut what a Legendary adds there (the crew-matter gate in `test:balance`) |
| Regrowth | 1 a beat unless burning | the same, capped at 15% of the ship's hull per fight | uncapped, a weak two-crew Sparrow took 176 beats to kill an Eclipse Probe; at a 30-50% cap Legendary moves added under 15 points on the Veil wall at 60 hull |
| Ion | lock 5 s, stall shields | an extra gun every 16 s; lock 5 s, engineer thaws ×2, stall 4 s | in place of the heavy gun they got 21 points easier; as an extra gun every 11 s, 30 points harder |
| Cloak | every 12 for 4, Helm below half | the same, first cloak at beat 8 | — |
| Harmonics | +1 layer, ×2 recharge | ×2 recharge, no extra layer | with three layers a starter Sparrow's three-shot volley never reaches the Shields room, so the counter could not work |

Each faction's ship is tuned around its rule (`FACTION_LOADOUT` in `ftlCombat.js`) so Auto stays near before:
Ice Raiders' guns ×0.85; Shades' guns ×0.65 and repairs ×0.5; Wardens' guns ×0.6; the Eclipse's repairs ×0.5 and
one shield layer fewer. Corsairs, Scrappers and the Swarm needed nothing beyond their rule. The tuning was checked on
three seed sets (5000, 9000, 777): Auto stayed within 5 points of before on each.

## Notes for Garrett

- **The simulator's captain plays the hold counter by habit.** Smart holds volleys whenever the enemy has shields,
  which is exactly the cloak counter, and aims at Shields, which is the harmonics counter; with the compensation that
  keeps Auto level, Shades are clearly easier for it than before (79% to 96% in the bigger sample) and Wardens and the
  Eclipse a little (94-95% to 96-100%). The Hollow wall (Hollow Shade) will fall sooner in the 30-day sim; the wall
  retune in the world design §8 should pick that up. The Veil wall (Swarm Frigate) was tuned back to its old shape
  (above).
- **Swarm fights run a little longer.** A fresh two-crew Sparrow takes about 71 beats to kill an Eclipse Probe or a
  Swarm Skirmish instead of about 62 (regrowth); a day-7 crew about 23 instead of 21. Other factions' fight lengths
  barely moved for Auto, except cloakers (Auto wastes volleys into the cloak: about 42 beats instead of 27).
- **Weak crews against Shades:** the compensation that keeps a day-7 Auto captain level makes a fresh crew that
  holds its fire much stronger against a Veil Wraith (about 40% wins instead of 5% in a quick check).
- **Escort is a real risk.** Day-7 crews keep the freighter about 80-98% of the time up to threat 1.1 against Pirate
  Wings, and about 90% against anything at 0.9, but only 49-74% against a three-shot Swarm Brood or Veil Wraith at
  1.1 and 13-52% at 1.3 (the sharp captain keeps it most often). At ×1.25 kept / ×0.7 lost, an escort lost half the
  time pays slightly less than no twist. The contract generator may want to keep escorts off heavy enemies, or the
  freighter may want more hull.
- **The 30-day sim (regenerated evidence):** walls move by a day or two either way (the Ember Raider now boards, the
  Veil Frigate plays drones); the medians of walls broken are cautious 2 and balanced 3 (unchanged) and ambitious 3
  (was 4: one ambitious captain broke the Hollow on day 28 and no longer reaches it by day 30; another no longer
  reaches the Crown). Credits per day (median): cautious 558 to 542, balanced 879 to 729, ambitious 891 to 936. The
  balanced drop is mostly which captain reaches the Hollow by day 20: its 50 fuel-burning attempts (220 pool, 5 wins
  a session) crowd out Explore. Fight wins stay 98-100%.
- **Old saves:** a fight saved before factions has no faction block and plays exactly as it would have. Removing the
  block from a new fight is refused when the faction changed the enemy's ship (every faction but the Scrappers, whose
  fight is the same without it). A save edited to look exactly like an old fight (no block and the old enemy guns)
  is accepted, as old saves must be; a fight with a twist must also carry its faction, so twisted fights cannot.
