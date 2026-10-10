# Phase 2: reward feel and retention, 2026-10-10

Design: [reward feel and retention](../superpowers/specs/2026-10-10-reward-feel-retention-design.md). Evidence
(regenerated): [encounter balance evidence](2026-09-22-encounter-balance-evidence.md).

## What is in the game now

1. **One reward reveal** (`src/ui/rewardReveal.js`). Cards pop in one by one, then fly to the top bar and the
   counters roll up. The sound matches the size, and rewards queue so they never overlap. It covers:
   - purchases, the Commission, away-team hauls and contract claims;
   - the login calendar, chests, achievements and the welcome-back haul;
   - every fifth crew level and the level cap.

   Hires keep their own pod reveal.
2. **Login calendar** (`src/systems/calendar.js`). 28 squares, one a day; a missed day waits instead of resetting.
   - Days 7, 14 and 21 are bigger squares.
   - Day 28 is a guaranteed Epic-or-better hire, rolled on its own stream, so hire pity and Marks are untouched.
   - The sheet opens on the first visit of a day, and the Log tab has a row for it.
   - Logging in no longer pays anything by itself.
3. **Daily orders and chests** (`src/systems/dailyLoop.js`, `src/systems/chests.js`).
   - Five orders, worth 120 points in all:
     - claim a contract (30);
     - improve ship or crew (25);
     - launch an away team (25);
     - make a star-map jump (20);
     - win a fight (20).
   - 100 points open the daily chest. So a captain can skip the jump or the fight on a day, but never the
     contract. (The spec had 30/20/20/15/15 with all five needed; the sim showed captains missing the fight or the
     jump most days, so the chest opened about a third of the time.)
   - Five daily chests in a game week (Monday to Sunday) open the weekly chest.
   - Each chest pays a fixed part plus one bonus from a published table. "Possible contents" on each chest shows
     the odds.
   - Rolls are seeded per save and per day or week, so a reload changes nothing. A shard goes to your
     highest-star merc.
4. **Income while away** (`src/systems/idle.js`).
   - Each staffed station earns 4 credits an hour, +2 with a crew member in their own role, +0.25 per crew level.
     Engineering also earns 0.5 medals an hour.
   - The hold is 8 hours, +1 per Cargo level, up to 16.
   - On the ship, a hold chip (bottom left) collects it, and it pulses when full. After an hour away, a
     welcome-back screen shows the haul.
   - A new station, level, Cargo upgrade or returning away team only pays from when it happens: the hold banks
     what the old setup earned. Only earning hours fill it.
   - If the clock runs backwards, the hold earns nothing until real time passes its saved start.
5. **Achievements** (`src/systems/achievements.js`): 11 lines × 3 tiers in the Log. Gems total 1,175 under the
   1,500 lifetime budget.
6. **Shop redesign** with art. The value badges are computed from real prices.
7. **Notices.**
   - A notice strip on the ship (right side) shows:
     - today's calendar square;
     - a ready daily or weekly chest;
     - an achievement to claim;
     - the wall pack while its offer is live.
   - The Log tab gets a dot.
   - "Hold full" joins the Jest text-notification ladder, skipped on a day another timed notice already lands
     (Jest sends at most one a day).
8. **Saves.** The calendar, idle clock and chest week have defaults, and the validator refuses edited values.

## The 30-day sim (15 guided captains, one check-in a day)

The sim now claims the calendar, collects idle income, opens chests and claims achievements every day.
"Phase 2 credits" means calendar + idle + chests + achievements.

| Captain | Credits, 30 days | Phase 2 share | Free gems a day (before) | Chest days | Walls fallen (day), before → after |
|---|---:|---:|---:|---:|---|
| cautious 4219 | 16,751 | 36% | 11.5 (3.3) | 30 | Veil 24 → 24 |
| cautious 17031 | 16,022 | 42% | 13.2 (2.7) | 30 | none past the Spur, both |
| cautious 88421 | 15,746 | 35% | 11.5 (3.3) | 30 | Veil 24 → 24 |
| cautious 240911 | 19,640 | 44% | 14.5 (3.3) | 30 | Veil 24 → 24 |
| cautious 990001 | 17,012 | 35% | 12.8 (3.3) | 30 | Veil 24 → 24 |
| balanced 4219 | 22,692 | 36% | 15.5 (4.0) | 28 | Veil 5 → 5, Ember 18 → 16 |
| balanced 17031 | 20,593 | 34% | 17.0 (4.0) | 28 | Veil 11 → 9, Ember 29 → 20 |
| balanced 88421 | 29,973 | 26% | 16.3 (4.0) | 28 | Veil 5 → 5, Ember 17 → 16 |
| balanced 240911 | 29,797 | 31% | 19.3 (4.0) | 28 | Veil 9 → 7, Ember 29 → 17 |
| balanced 990001 | 26,377 | 28% | 16.5 (4.0) | 29 | Veil 6 → 6, Ember 19 → 16 |
| ambitious 4219 | 24,678 | 31% | 18.7 (4.7) | 30 | Veil 9 → 9, Ember 14 → 12, Hollow 28 → 28 |
| ambitious 17031 | 25,532 | 31% | 21.0 (4.0) | 30 | Veil 9 → 6, Ember 19 → 12, Hollow — → 28 |
| ambitious 88421 | 28,836 | 29% | 18.7 (4.7) | 30 | Veil 5 → 5, Ember 7 → 7, Hollow 25 → 11 |
| ambitious 240911 | 26,721 | 35% | 21.7 (4.0) | 30 | Veil 13 → 12, Ember 27 → 16, Hollow — → 28 |
| ambitious 990001 | 33,143 | 25% | 20.0 (4.7) | 30 | Veil 5 → 5, Ember 8 → 8, Hollow 23 → 11 |

"Before" is the balance pass with the two 2026-10-10 fixes, without Phase 2 (commit 433a828). The Spur falls on day
3 or 4 for everyone, before and after. Free gems a day by source (mean): calendar 4.8, achievements 4.9, weekly
chest 3.2, daily chest 1.8, walls 2.0. Numbers are after the audit fixes ([audit](../audits/2026-10-10-phase2-audit.md)):
the hold now banks when the setup changes, and the jump order counts for captains with lost contracts, so daily
chests open on 28-30 days of 30.

## Success tests

1. **Every reward through one reveal: met.** `test/reward_reveal.test.mjs` checks every grant path raises a
   reveal.
2. **A free captain earns more:**
   - **Free gems: met.** They rise from 3-5 a day to 11-22, under the 25-35 a day budget, so a 60-gem Rally still
     means something.
   - **Phase 2 at most a third of credits: right at the line for the median captain (33.5%), not met for all.**
     - Cautious captains are at 35-44%, because their other income is small (one contract a day).
     - Balanced and ambitious captains are at 25-36%.
     - `test/contract_economy_guided.test.mjs` now gates this: median at most a third, no captain over 45%.
   - **The wall schedule moves by at most a day: not met.**
     - Cautious captains are unchanged.
     - Balanced captains break the Ember on day 16-20 instead of 17-29.
     - Ambitious captains break the Hollow 12-14 days sooner in two runs, and reach it for the first time in two
       others.

   I traced it in the sim: credits pay for the hull repairs between wall attempts (balanced captains), and gems
   buy Rallies (ambitious captains). Cutting every Phase 2 credit and gem down to almost nothing still left the
   Ember a week or more early, so I did not chase this further; it is a design call (below).
3. **Away 8 hours ≈ one contract: met for a staffed crew.**
   - Three stations at level 1 earn about 150 credits in 8 hours (tested); early contracts pay 60-260.
   - The simulated captains staff only the stations matching their crew's roles (1-2), so they collect about
     half that.
4. **Nothing new sold, chest odds shown: met.** There are no new SKUs and no Jest console changes.
5. **Saves stay valid: met.**
   - New fields have defaults and old saves migrate.
   - The validator refuses an edited calendar, idle clock or achievement count.
   - Chest rolls and the day-28 hire are seeded and can't be re-rolled by reloading.

## Effect on the balance pass's Legendary test

A day-7 crew is a bit stronger with Phase 2 (more medals, more upgrades). On the Dangerous Veil wall at full hull it
wins 83.8% of attempts instead of 78.5%. So a fresh level-1 Legendary adds less than before:
- +2.1 points at full hull (was +5);
- +7.7 at 80 hull (was +8.5);
- +21 at 60 hull (was +20).

The test's "a Legendary never makes a typical crew worse" check at full hull sat inside its own noise with 16 seeds
per crew (it read −2.4 on one run). It now plays 48 seeds per crew, 720 fights per Legendary, about 14 s longer.
I tried faster Legendary charge and fewer Phase 2 medals; neither moved it.

## For Garrett

- **Walls come sooner with Phase 2** (above). Options:
  - accept it (the rewards are meant to speed a daily player up);
  - raise the Ember and Hollow pools (e.g. 180 → 220 and 220 → 280);
  - trim the free gems further, mainly the calendar (5 a day) and achievements (5 a day);
  - make Rally dearer.

  I left the pools alone; say which you prefer.
- **Daily-order points** changed from the spec (above) so the chest is reachable on a normal day.
- **Cautious captains** get 35-44% of their credits from Phase 2.
- **Not built yet:**
  - the spec's twice-a-day check-in variant of the sim;
  - Jest notification copy review (the "Hold full" text is new).
