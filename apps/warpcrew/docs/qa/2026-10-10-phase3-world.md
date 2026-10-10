# Phase 3: the world, 2026-10-10

- **Design:** [the world](../superpowers/specs/2026-10-10-world-design.md).
- **Canon:** [world bible](../design/23-world-bible.md).
- **Fight engine evidence:** [faction mechanics](2026-10-10-faction-mechanics.md).
- **Art:** [Phase 3 art ledger](../art/2026-10-10-phase3-art-ledger.md), $1.74 of the $5 approved.

## What is in the game now

1. **The campaign, "The Long Jump", chapters 1 and 2** (`src/data/campaign.js`, `src/systems/campaign.js`).
   - Ten story missions:
     - Chapter 1: Vell's first job, Big Mabel, Two-Tooth, Static Song, Tarrow's Terms.
     - Chapter 2: Past the Gate, the Last Clinic, Wren's Trail, Crane's Debt, the Choir.
   - Each has a briefing and a debrief, a set piece and a story bonus.
   - The Spur and Veil walls are the chapter bosses, with a scene before the first attempt and one at the fall. The
     fall opens the next gate at once. Kal Vesper (chapter 1) and Wisp (chapter 2) join the crew.
   - A gold Story card sits at the top of the board. After each won mission, one ordinary contract opens the next.
   - Chapter 3 shows as "Ember Reach, coming soon".
2. **The story player** (`src/ui/transmission.js`).
   - A sheet at the bottom of the screen with the speaker's portrait in a scanline frame, and the line typed word by
     word. Tap to finish the line, tap again for the next panel, or Skip.
   - Chapter openers play over their scene with a title card.
   - The old gate cinematics play here too, and the random story beats now read as Discoveries.
   - Everything seen can be replayed in the Almanac. A briefing can be replayed from its card.
3. **Loyalty** (`src/data/bonds.js`, `src/systems/loyalty.js`). Each of the 46 mercs has:
   - two bond scenes;
   - a personal loyalty job (with the twist their role fits);
   - a debrief and a line once Loyal.

   About 7,000 words, written from each bio. Loyalty grows by one a contract or away team, at most two a day.
   - Trusted (10) and Close (25) open the scenes: a "wants a word" notice on the ship, and replays in the dossier.
   - At 40 their job joins the board.
   - Winning it makes them Loyal: their role passive counts a quarter more, they fight a little sharper, and the job
     pays 15 medals and 10 gems.
4. **The contract generator** (`src/data/clients.js`, `src/systems/contractFlavor.js`). Every daily offer gets:
   - one of twelve recurring clients with a portrait, each from a family and a sector;
   - a job whose title matches the client's brief;
   - a cargo line (40 of them);
   - on most risky jobs, a twist: escort, rush, bounty (a named elite), holdout or two waves.

   Cards show the client, the twist with its pay, and the enemy faction. Flavour rolls on its own seeded stream, so
   no pick, reload or balance number moved because of it.
5. **Enemy factions** (`src/data/factions.js`, `src/systems/ftlCombat.js`). Seven factions, each with its own
   trick, shown on screen, and a tell that names the counter:
   - corsair missiles;
   - scrapper boarders;
   - Swarm drones and regrowth;
   - Ice Raider ion;
   - Shade cloaks;
   - Warden harmonics;
   - the Eclipse doing both cloak and regrowth.

   See the [faction evidence](2026-10-10-faction-mechanics.md).
6. **The Captain's Almanac** (`src/systems/almanac.js`, `src/ui/almanacView.js`). Five sections, 177 entries, from
   a card at the top of the Log:
   - Story;
   - Crew files (silhouettes until hired);
   - Enemies (their trick, the counter, your record);
   - Places;
   - Discoveries.

   A twelfth achievement line, Archivist, pays at 25, 50 and 100%.
7. **Saves.** The campaign, loyalty and Almanac fields have defaults and clean up odd values on load. Both
   validators, the game's and the server's, refuse edited values.

## The 30-day sim (15 guided captains, one check-in a day, after the wall retune)

The sim now:
- plays the open story mission and any loyalty job before and after its strategy contract, keeping its wall fuel
  reserve;
- plays every fight with the new faction rules.

| Captain | Chapter 1 done (day) | Chapter 2 done | First Loyal (count) | Walls broken past the Spur (day) | Credits, 30 days | Story + loyalty share | Free gems a day |
|---|---:|---:|---|---|---:|---:|---:|
| cautious 4219 | 5 | 14 | 20 (3) | Veil 14 | 33,187 | 9% | 21.5 |
| cautious 17031 | 5 | 12 | 20 (3) | Veil 12 | 31,013 | 10% | 23.5 |
| cautious 88421 | 5 | 14 | 20 (3) | Veil 14 | 30,611 | 11% | 21.5 |
| cautious 240911 | 5 | 14 | 20 (4) | Veil 14 | 32,964 | 11% | 24.8 |
| cautious 990001 | 5 | 12 | 20 (3) | Veil 12 | 32,666 | 10% | 22.8 |
| balanced 4219 | 4 | 9 | 20 (3) | Veil 9, Ember 22 | 28,841 | 10% | 23.8 |
| balanced 17031 | 4 | 9 | 21 (3) | Veil 9, Ember 15 | 33,680 | 9% | 25.8 |
| balanced 88421 | 4 | 9 | 20 (4) | Veil 9, Ember 22 | 26,304 | 14% | 24.2 |
| balanced 240911 | 4 | 12 | 20 (3) | Veil 12, Ember 22 | 30,604 | 10% | 26.8 |
| balanced 990001 | 4 | 9 | 22 (4) | Veil 9, Ember 17 | 35,374 | 10% | 25.5 |
| ambitious 4219 | 4 | 8 | 20 (4) | Veil 8, Ember 15 | 30,764 | 11% | 25.8 |
| ambitious 17031 | 4 | 8 | 20 (4) | Veil 8, Ember 18 | 35,212 | 10% | 29.0 |
| ambitious 88421 | 4 | 8 | 20 (4) | Veil 8, Ember 16 | 30,255 | 12% | 25.8 |
| ambitious 240911 | 4 | 8 | 20 (4) | Veil 8, Ember 17, Hollow 28 | 34,536 | 11% | 30.3 |
| ambitious 990001 | 4 | 8 | 22 (4) | Veil 8, Ember 12, Hollow 28 | 34,049 | 11% | 27.8 |

- **The Spur wall** falls on day 4 or 5 for everyone. It used to fall on day 3 or 4; it now waits for chapter 1's five
  missions.
- **Every story mission was won.** A few took a second try: one captain lost two, another one.
- **Story missions are easier than the board's risky jobs.** They are first-time content; the walls are the
  difficulty.

### The wall retune (design §8)

Phase 2 pulled the walls forward, and Phase 3 more so: story pay, two story recruits, and gates that open as soon as
their wall falls.

| Run | Pools and threat floors (Ember / Hollow / Crown) | Balanced Ember | Ambitious Hollow | Crown |
|---|---|---|---|---|
| Phase 3 before the retune | 180 at 1.25 / 220 at 1.3 / 270 at 1.35 | days 12-16 | day 15-29 (3 of 5) | days 22-26 (2 of 5) |
| Sixth Ember segment | 220 at 1.25 / 270 at 1.4 / 320 at 1.45 | never | day 28 (1 of 5) | never |
| **Chosen** | **180 at 1.45 / 270 at 1.4 / 320 at 1.45** | **days 15-22** | **day 28 (2 of 5)** | **never** |

- **Why not a sixth Ember segment:** that is a fuel wall, not a harder fight. Six wins in one check-in cost twelve
  fuel.
- **What changed:** the Ember now fights harder at the same five segments, and the Hollow and Crown each take one
  more segment.
- **Cautious captains:**
  - They break the Veil on day 12-14 (it was 24 before Phase 3).
  - Their credits roughly doubled (31-33k against 16-20k), because the Veil's richer contracts open sooner.
  - I left that: three weeks stuck in the Spur was too long.

## Success tests (design)

1. **A campaign you can finish: met.**
   - Every simulated captain finishes chapters 1 and 2.
   - `test/campaign.test.mjs` lints every panel: at most 30 words, a known speaker, numbers in words.
2. **Contracts read differently every day: met.** `test/contract_generator.test.mjs`, over 180 boards:
   - at least 150 different cards and 40 client-job-twist combinations;
   - no repeated client on a board;
   - every twist appears.
3. **Enemies fight differently: met for five of seven factions** ([evidence](2026-10-10-faction-mechanics.md)).
   - Auto stays within 1.7 points of before for every faction.
   - Playing the counter wins 15-21 points more against corsairs, Ice Raiders, Shades, Wardens and the Eclipse.
   - Scrappers and Swarm are countered by what you bring (free security, beams and crits for fires), not by taps
     in the fight, so playing sharp is level there.
4. **Mercs become yours: met.**
   - All 46 mercs have their writing (`test/loyalty.test.mjs` lints it).
   - The first loyalty job lands on day 20-23 in the sim.
5. **The Almanac: met.** `test/almanac.test.mjs` checks:
   - every entry can be opened in play;
   - a captain with everything reads 100%;
   - the screen hides what isn't open.
6. **Saves stay valid: met.**
   - Defaults, migration and clean-up are in place.
   - Both validators refuse edited values; the server parity test passes.
   - Flavour, twists and story are seeded, so a reload rolls the same card.
7. **The economy holds: met.**
   - Story and loyalty pay are 9-14% of credits (at most 15%).
   - Free gems are 21-30 a day (Phase 2: 11-22), under the 35 a day ceiling.
   - The walls are retuned (above).

## For Garrett

- **Play it in the QA build:**
  - the chapter 1 opener and Vell's first job;
  - a bond scene ("wants a word" on the ship);
  - the Almanac (Log);
  - a cloaking Shade or a corsair missile in a fight.

  Do the voice and pacing work for you?
- **Story missions are easy** (every captain won them all, mostly first try). Make chapter 2 harder, or keep the
  story as a breather between walls?
- **Cautious captains now leave the Spur by day 12-14** (was 24) and earn about twice the credits.
- **Not built:**
  - chapters 3-5 (Ember Reach is "coming soon");
  - pair bonds between two mercs;
  - a client standing or shop per family.
