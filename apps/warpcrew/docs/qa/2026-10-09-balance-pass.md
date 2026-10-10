# Balance pass (crew-matter Phase 1 step 3), 2026-10-09

Design: [crew-matter design](../superpowers/specs/2026-10-09-crew-matter-design.md) §4. Evidence (regenerated):
[encounter balance evidence](2026-09-22-encounter-balance-evidence.md), guided section.

## What changed

1. **Simulated captains grow their crew.** Every check-in they take the free daily hire, call up a reserve merc
   who is stronger than the weakest non-captain aboard, seat new crew on an empty station of their own role
   (everyone else stays free to fight fires and repair) and spend medals on crew levels, strongest fighter first.
   No paid hires. Cautious and balanced level before the day's fights; ambitious buys ship upgrades first and
   levels after (levels cost medals, upgrades credits, so they never compete). All through production code;
   the ledger reconciles on every run.
2. **Captains head for the next gate.** After a wall falls, a simulated captain on Explore heads for the next
   sector's gate beacon until it opens, and picks the event choice likeliest to open it. Before, a first gate
   visit that rolled a trade or a fight was never retried, so 6 of 15 captains never even reached the Veil wall.
3. **Threat no longer follows your crew.** The 82% pull-up toward your own power is gone from FTL-lite fights.
   Threat now comes from the encounter, the sector and a *reference crew power* for the day you are on (below).
   A stronger crew than the reference wins more; a weaker one loses more. The label thresholds are unchanged.
   The legacy order-based fights (old saves only) keep their old formula.
4. **Win odds on contract cards.** Each card (and the review sheet) says, for example,
   "Fight: Even · Win odds about 70%". The odds come from playing the real fight 8 times (fixed seeds per
   offer, the smart captain, Auto on) with your crew, stations, levels, ship and hull as they are now.
5. **Wall pools retuned** so each wall asks for one more win in a row per check-in, and later flagships fight
   at a higher threat floor:

   | Wall | Pool before | Pool now | Wins needed in one day | Threat floor |
   |---|---:|---:|---:|---:|
   | Spur | 100 | 100 | 3 | 1.2 |
   | Veil | 130 | 130 | 4 | 1.2 |
   | Ember | 160 | 180 | 5 | 1.25 |
   | Hollow | 190 | 220 | 6 | 1.3 |
   | Crown | 240 | 270 | 7 | 1.35 |

6. **Bug fixed:** a crew that patched the hull above where a fight started (a medic's Field Surgery) could never
   claim the prize; a stuck Explore fight then blocked every contract for the rest of the run. Regression test in
   `test/balance_pass.test.mjs`.

## The reference curve and the threat formula

Reference crew power by **days played** (local days with a finished board contract, plus today; wall attempts
and the tutorial job do not count, so a captain who stays away is not punished). Points are the median first
fight of each day across the 15 guided captains (power model's crew side: fighting crew power plus crit and
hull bonuses); linear between points, held after day 30.

| Day played | 1 | 4 | 7 | 15 | 30 |
|---|---:|---:|---:|---:|---:|
| Reference power | 38 | 72 | 95 | 130 | 220 |
| Simulated median (final run) | 38 | 74 | 94 | 132 | 229 |

Threat = enemy power ÷ reference power when the enemy is the stronger one; otherwise the sector's base plus the
enemy's share of the rest: `base + (1 − base) × enemy ÷ reference`. Bases: Spur 0.8, Veil 0.84, Ember 0.88,
Hollow 0.92, Crown 0.96, so content you outgrew stays Favorable and later sectors fight back a bit harder.
Siege walls keep their floor. With nobody aboard who can fight, a fight is Deadly.

**Payouts do not scale with the reference power.** Rewards stay set by the encounter (later sectors already pay
more) and the existing site scaling. Scaling by the reference would raise every captain's pay with the calendar
and run ahead of the drydock prices.

**Saves:** fights in progress store their threat, and the loadout is rebuilt from it, so an old save's fight
loads and plays out with the threat it was saved with (tested).

## Before and after (15 guided captains, fights-first)

Median, with the worst seed in brackets. Fight wins count contract and Explore crew fights; wall attempts are
separate. Before = `main` at 414546e (no crew growth, old threat, old pools).

| Strategy | Fight wins days 1-7 | Fight wins days 1-30 | Wall attempts won | Credits per day | Walls broken | Veil broken | End crew power |
|---|---|---|---|---|---|---|---|
| cautious, before | 100% (100) | 100% (100) | 50% (19) | 357 (341) | 1 (1) | 1 of 5 | 35 (33) |
| cautious, after | 100% (100) | 100% (100) | 100% (86) | 419 (375) | 2 (1) | 4 of 5 | 185 (180) |
| balanced, before | 75% (0) | 80% (69) | 41% (7) | 405 (328) | 3 (1) | 3 of 5 | 35 (33) |
| balanced, after | 100% (100) | 100% (100) | 85% (32) | 619 (505) | 3 (3) | 5 of 5 | 238 (192) |
| ambitious, before | 78% (67) | 85% (38) | 100% (3) | 387 (290) | 1 (1) | 1 of 5 | 35 (33) |
| ambitious, after | 100% (100) | 100% (98) | 74% (33) | 649 (569) | 4 (3) | 5 of 5 | 237 (228) |

Walls, all 15 captains (after): Spur falls on arrival (median 1 day); the Veil is reached by 14 and falls for
all 14 (median 2 days); the Ember is reached by 10, falls for 10 (median 7 days); the Hollow is reached by 7,
falls for 3 (median 14 days); nobody reaches the Crown in 30 days. Before, the Veil fell for 5 of 15.
The one captain who never reaches the Veil (cautious, seed 17031) never opens the Veil gate: cautious captains
make one Explore jump a day and their contract moves them away from the gate each morning.

## Success tests

- **Test 2 (a Legendary in a typical day-7 crew wins a Dangerous contract 15+ points more often): not met as
  written.** Checked on the Dangerous Veil wall with the 15 simulated day-7 crews, swapping the weakest
  non-captain for each of the five hireable Legendaries (level 1, on their role's station), 16 seeds each.
  Results are printed by `test/balance_success.test.mjs`; see "Numbers from the final run" below. The gain is
  about 15 points only at the 60-hull repair line; with more hull the typical crew already wins most attempts
  and the Legendaries differ a lot (Onyx helps most; Harrow helps less than the merc he replaces). Two reasons:
  levels add +3 power for every rarity, so by day 7 a free captain's level 4-7 Commons are close to a fresh
  level-1 Legendary in fight grade; and Legendary moves charge in 20-24 beats against 12-14, so in a 30-beat
  wall fight they fire about half as often. The test guards what holds today (never worse on average, +15 at
  60 hull).
- **Test 3 (an idle Auto-on captain wins about as often as before on the same content): met.** Same day-7
  captains, their own boards and the Veil wall, idle policy with Auto on, old threat formula against new: equal
  win rates (see below).

## Win odds cost

8 fights per card took about 12-13 ms on this container (warm), about 40-50 ms for a three-card board the first
time a board is shown or after anything in the fight setup changes (crew, stations, levels, kits, ship systems,
guns, hull, day played); about 0.2 ms per board when cached. The cache key is the fight setup itself (a probe of
the fight that would start), so odds update the moment you swap crew. The game's render asks for odds; the
simulator and session actions do not, so the 30-day sims are not slowed.

## Judgement calls and open items for Garrett

- **Contracts are now nearly free wins** for captains who grow their crew (100% in every strategy). This comes
  from step 1, not the threat change: enemies keep their catalogue strength while a free captain's crew grows
  about sixfold in 30 days; the old formula with crew growth gives the same 98-100%. Walls are where the
  challenge is now. If contracts should bite again, the next lever is an enemy rank that grows with the
  reference crew (stronger guns as the reference rises), which changes the fight engine and its save checks, so
  I left it for your call.
- **Credits per day rose 17-68%** (more wins, more walls broken, later sectors' bigger prizes). Ship upgrade
  prices may want a look.
- **Test 2 shortfall** (above). Options: rarity-scaled level gains, faster Legendary charge, a stronger Harrow.
- **The Crown pays gems on every segment won**: the Eclipse Throne's own prize carries 8 gems, and a wall attempt
  that wins a segment pays the catalogue prize. No simulated captain reaches the Crown with the new pools, but in
  an earlier tuning run one captain earned about 180 gems there in a week. Consider dropping gems from segment
  wins.
- **A fight can stall forever** if every crew member aboard is stationed and the unmanned Weapons room burns
  out (stationed crew never leave their post). A real player can drag crew; an idle one cannot. The simulator
  now keeps crew without a matching station free, which avoids it; the engine has no stalemate guard.
- **Gate seeking** is new simulator behaviour (a real player chasing the next wall). It changes the Explore
  numbers in the evidence (more gate visits).

## Numbers from the final run

From `test:balance` (`test/balance_success.test.mjs`) on the committed code. Success test 2, Dangerous Veil
wall (threat 1.2), 15 day-7 captains × 16 seeds per crew:

| Ship hull | Typical crew | With a Legendary (mean of 5) | Gain | Zephyr | Onyx | Prism | Solace | Harrow |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 82.1% | 83.5% | +1.4 | 80.8 | 96.3 | 82.5 | 84.2 | 73.8 |
| 80 (typical attempt: median 79) | 65.4% | 74.8% | +9.4 | 73.3 | 91.3 | 74.2 | 70.0 | 65.0 |
| 60 (repair line) | 40.0% | 57.4% | +17.4 | 50.0 | 80.8 | 62.1 | 57.5 | 36.7 |

Success test 3, idle captain with Auto on, 416 fights on the same content: 89.9% before, 89.9% after.
