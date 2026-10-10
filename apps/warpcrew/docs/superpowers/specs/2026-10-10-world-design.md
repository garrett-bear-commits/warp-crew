# Phase 3 design: the world (2026-10-10)

Status: **building**. Garrett, 2026-10-10: "lets carry on", then "feel free to rewrite and improve everything".
Art: up to $5 on his personal Flora account.

Follows:
- the [deep dive](../../design/21-deep-dive-2026-10-09.md) (row "3. World");
- the [universe proposal](../../design/22-universe-proposal.md), adopted and tightened into the
  [world bible](../../design/23-world-bible.md).

Numbers are starting values for the 30-day sims, not final.

## Why

- Nothing in the game tells a story in order. The 30 story beats are one-line toasts that fire at random on Explore
  jumps, and a beat reached through a contract is not shown at all.
- Every contract is one of 27 title-and-brief pairs, with no client and nothing that changes how it plays.
- Every enemy fights the same way: one four-room ship whose numbers scale with threat. Only three encounters board.
- The 46 written crew bios sit in a dossier. Nothing makes a merc yours over time.
- Nothing collects what you have seen.

## Success tests (checked by tests and the 30-day sim)

1. **A campaign you can finish.**
   - Chapters 1 and 2 (the Spur and the Veil) play start to end for a guided captain in the sim: ten story missions
     and the two Siege walls as chapter bosses.
   - Every mission has a briefing and a debrief transmission.
   - A content lint checks every panel: at most 30 words, a known speaker, and no developer words.
2. **Contracts read differently every day.**
   - Over 30 days, for Spur and Veil captains in three hulls (180 boards), the board shows at least 150 different
     cards and at least 40 client-job-twist combinations.
   - No board repeats a client, and every twist appears.
   - Each twist changes the fight or the pay, as written on the card.
3. **Enemies fight differently.**
   - Each of the six enemy factions has a mechanic that fires in its fights and is shown on screen, plus a tell that
     names the counter.
   - Playing the counter (the sim's "sharp" policy) wins at least 5 points more often than ignoring it, on the same
     seeds.
   - An Auto captain's win rate per faction stays within 8 points of today's.
4. **Mercs become yours.**
   - Every merc has two bond scenes and a loyalty mission, written from their bio.
   - A merc who flies most days reaches the loyalty mission in about three weeks.
5. **The Almanac.** Every entry has a way to unlock it in play (a test walks them), and the completion counts are
   right.
6. **Saves stay valid.**
   - New fields have defaults and migrate from today's save.
   - The client and server validators refuse edited values.
   - Rolls can't be redone by reloading.
7. **The economy holds.**
   - Story missions and loyalty missions add at most 15% of credits over 30 days.
   - The wall schedule is then retuned back to the balance pass's targets (below), since Phase 2 already pulled it
     forward.

## 1. Transmissions (the story player)

Presentation only, like the reward reveal: it never changes game state.

- `showTransmission({ id, panels: [{ speaker, text, mood? }], art?, kicker? })`. Transmissions queue with reward
  reveals, so a debrief plays before its rewards fly.
- **One sheet, bottom of the screen:**
  - a signal header with the speaker's name and where they are calling from;
  - their portrait in a scanline frame;
  - the line, typed out (a tap finishes the line, the next tap goes to the next panel);
  - an optional scene behind it;
  - Skip.
- **Speakers:**
  - the recurring cast (world bible);
  - any merc (their portrait);
  - `captain` (the player's captain);
  - `blackbox` (the lost captain's log, in static);
  - `choir` (no face, a waveform).
- **Sound:** a radio chirp on open and a soft blip per panel. Reduced motion skips the typing.
- **Every transmission is saved by id** once seen, and can be replayed in the Almanac.
- **The gate cinematics** (Veil, Ember, Hollow, Crown) move into this player as one-panel transmissions with
  their scene.

## 2. The campaign: "The Long Jump", chapters 1 and 2

`src/data/campaign.js` (content) and `src/systems/campaign.js` (rules).

**A chapter** is five story missions and a boss. The boss is that sector's Siege wall, so walls become the
chapter finales instead of a separate system.

**A story mission** is a contract. Its gold Story card sits at the top of the board while it is open.
- It costs the normal 2 fuel and uses the normal stages (briefing, route, fight, return, claim).
- It carries:
  - a briefing transmission (on Review);
  - a debrief transmission (on claim);
  - a set-piece rule (a twist and the enemy faction's mechanic, §3 and §4);
  - authored rewards.
- **It unlocks** when the previous mission is claimed and the captain has finished one ordinary contract since.
  ("Vell has another job once you've done some honest work.") The first mission opens straight after the tutorial.
- Chapter 2 also needs the Veil open.
- **A lost story mission** can be retried. It stays on the board, and the hull damage follows the normal rules.

**The boss:**
- The wall offer appears only once the chapter's five missions are done (and its minimum day has come).
- When the wall falls, its gate opens at once (as built: before, a fallen wall only showed the gate beacon, and the
  gate still had to be rolled open there, which contradicted "the Veil Gate is open").
- A transmission plays before the first attempt and another when the wall falls.
- The fall completes the chapter. A named merc joins the crew (the reveal), and the next chapter's first
  transmission plays.

**Script-3 captains** (no walls) get the missions too. Their chapter ends when its gate opens.

Chapter 1, **Cheap Ship, Bad History** (the Spur):

| # | Mission | Client | Set piece |
|---|---|---|---|
| 1 | First Honest Job | Auntie Vell | A clinic delivery to Hope's Rest. A pirate scout tests you. |
| 2 | Big Mabel | Haulers' Union | **Escort** an old freighter down Dust Lane past corsair raiders. |
| 3 | Two-Tooth | Silas Crane (rival) | **Bounty** on a corsair ace. Crane wants the same bounty. |
| 4 | Static Song | Hope's Rest clinic | **Two waves** of Swarm drones at the colony. |
| 5 | Tarrow's Terms | Commodore Tarrow | **Holdout**: survive her gunnery drill at the Veil Gate. |
| Boss | The Corsair King | — | The Spur wall. The fall opens the Veil Gate. |

Chapter 2, **The Veil** (Veil Edge):

| # | Mission | Client | Set piece |
|---|---|---|---|
| 1 | Past the Gate | Commodore Tarrow | First Veil jump. A wraith that **cloaks**. |
| 2 | The Last Clinic | Haven | **Escort** a hospital ship out of Swarm space. |
| 3 | Wren's Trail | the black box | **Rush**: salvage the old captain's buoy before the brood arrives. |
| 4 | Crane's Debt | Silas Crane (ally now) | **Two waves** of brood ships. Crane's guns strip their first shield. |
| 5 | The Choir | the Choir | An Eclipse echo that cloaks and regrows. |
| Boss | The Swarm Frigate | — | The Veil wall. The fall opens the road to Ember Reach. |

- Chapter 3 shows as "Next chapter: Ember Reach. Coming soon" with one teaser transmission.
- **Chapter rewards:** chapter 1, a Rare merc joins; chapter 2, an Epic. Both are chosen from the roster to fit the
  story (world bible).
- **Mission rewards:** about one contract's pay, plus 10-20 gems each. Chapters 1-2 total 150 gems.
- **The old random beats** become **Discoveries**. They keep their flags, rewards and gate openings, are shown as
  "Discovery" on the event card (not "Story"), and fill the Almanac's sector notes.
- **`story.chapter`** keeps gating hulls and beacons, but campaign progress also raises it (the higher of the two).
  The Log shows the campaign chapter.

## 3. The contract generator

The board keeps its shape, so the balance curve, the sim and the save checks still hold:
- three daily offers, one each of reliable, risky and strange;
- ids `offer_<day>_<profile>`;
- the same destination and encounter picks (same rng order).

On top, every offer gets a seeded flavour from its own stream (`hash(offer.id + ':flavor')`), so adding flavour
changes no existing pick:

- **Client**: 12 recurring clients, each from a family, each with a portrait (world bible). A board never shows
  the same client twice.
- **Job**: 6 per profile:
  - reliable: haul, deliver, ferry, resupply, courier, tow;
  - risky: intercept, clear the lane, bounty, escort, hold the line, collect a debt;
  - strange: investigate, recover, listen, salvage, chart, retrieve.
- **Cargo**: 40 nouns, mostly dry jokes ("forty crates of coolant", "a sealed reliquary, do not shake").
- **Brief**: each client has four brief lines, filled with `{cargo}`, `{place}` and `{enemy}`. They are written in
  the client's voice.
- **Twist**, on most risky offers (as built: only risky jobs always fight, so a twist on a reliable or strange job
  would often never happen; bounty, escort and holdout jobs always carry theirs, the others roll none, rush or two
  waves):

| Twist | Rule in the fight | Pay |
|---|---|---|
| Escort | A freighter (30 hull) flies beside you. Each enemy volley has a 35% chance to aim at it. | ×1.25 if it survives, ×0.7 if not |
| Rush | A 30-beat clock. Win before it runs out for the bonus. | +35% if in time |
| Bounty | The enemy is a named elite with one modifier (§4). | ×1.4, +50% medals |
| Holdout | Survive 35 beats or destroy them. The enemy hits 20% harder. | ×1.15 |
| Two waves | When the first ship falls, a second arrives at 60% hull. | ×1.4 |

- **The card shows:** the client's portrait and name, the job title, the brief, the twist chip with its rule in
  one line, the enemy faction chip ("Corsairs · missiles"), and the existing danger, payout and odds.
- **Reward bands and fight odds** run the twist too (the twist travels into `startCrewFight`), so "Possible
  payout now" stays true.

## 4. Enemy factions

Each encounter gets a `faction` (one table, `src/data/factions.js`), and each faction one mechanic. Fights with a
mechanic carry it in the fight state, so the validator rebuilds and checks it like the rest of the enemy.

| Faction | Encounters | Mechanic | Counter (in the tell) |
|---|---|---|---|
| Corsairs | pirate_scout, pirate_wing, pirate_ace, corsair_king | **Missiles**: one gun fires a missile that flies through shields. A missile can be dodged. | Crew the helm and engines to dodge. Aim at their weapons. |
| Scrappers | scrapper_gang, ember_raider | **Boarders** (as today, now for both). | Keep security free; repel fast. |
| Swarm | swarm_probe, swarm_skirmish, swarm_frigate, swarm_brood | **Drones and regrowth**: volleys of many weak shots strip shields. The hull regrows 1 a beat unless it is on fire. | Set fires (beams, crits). Burn them down fast. |
| Ice Raiders | ice_raiders | **Ion**: a hit locks that room for 5 s. Hits on shields stall the recharge. Boarders as today. | An engineer thaws a room twice as fast. |
| Shades | veil_wraith, hollow_shade | **Cloak**: every 12 beats they cloak for 4. Shots miss while they are cloaked; held weapons keep their charge. | Hold fire while cloaked. Hit their helm below half and they can't cloak. |
| Wardens | crown_warden, eclipse_throne | **Harmonics**: +1 shield layer, recharged twice as fast while their shields room is above half. | Aim at shields. Ions and missiles. |
| Eclipse | eclipse_echo (and the Throne) | **It learned**: cloak and regrowth together. | Both counters. |

**Elites** (Bounty twist, and later The Rift): a name ("Two-Tooth Marrik") plus one modifier:
- Armored: +1 shield layer;
- Veteran: repairs ×1.5;
- Overclocked: guns charge 25% faster;
- Heavy: +30% hull.

**Auto and the sims:**
- Auto keeps today's targeting.
- The sims gain a **sharp** policy that plays each counter: holding fire when cloaked, aiming at the cloaking helm,
  aiming at shields against Wardens.
- That is how test 3 is measured.

**Tells:** the encounter tells are rewritten to name the mechanic and the counter. They stay unique, at most 80
characters, with no digits.

## 5. Bonds and loyalty

- **Loyalty** is per merc (by template, so it survives the reserve), from 0 to 60.
  - +1 for each contract or story mission aboard, won or lost;
  - +1 for each away team;
  - at most 2 a merc a game day (as built: the first sim run gave the first loyalty job on day 7, because wall
    attempts count as contracts; with the cap it lands around day 21).
- **Captains have none.** They are you.
- **Levels:**
  - **Trusted (10):** bond scene 1, two panels in their voice, from their quote and a new line;
  - **Close (25):** bond scene 2, two or three panels, from their history;
  - **Loyalty mission (40):** a personal gold card on the board, themed on their origin and faction:
    - the destination is their origin beacon, or one in its sector;
    - the twist fits their role (gunner bounty, medic escort, scout rush, pilot holdout, and so on);
  - **Loyal:** the mission claimed. Their passive is +25% and their fight grade +0.05 (sharper at their station;
    as built, instead of a faster move, which would have needed a per-merc charge rule in the fight engine), the
    dossier shows them as Loyal with their new line, and the job pays 15 medals and 10 gems on top of the fight.
- **Shown on:** the dossier (bond meter, scenes to replay), a toast when a scene unlocks (the scene plays from the
  notice strip), and the Almanac.
- **Writing:** 46 mercs × (2 scenes + mission briefing + debrief), about 7,000 words, by writer sub-agents from a
  style guide and each bio. I review it, and the content lint checks it.

## 6. The Captain's Almanac

A full-screen book, opened from a big card at the top of the Log tab. It has five sections, each with a
completion count:

| Section | Entries | Unlocked by |
|---|---|---|
| Story | campaign transmissions, by chapter | seeing them (replay) |
| Crew files | 50 | hiring them: portrait, family, quote, history, bond scenes. Unhired: silhouette, rarity and "answers the hiring beacon" |
| Enemies | 7 factions + 16 ships | the first fight: mechanic, counter, your wins and losses |
| Places | 51 beacons | visiting |
| Discoveries | the 30 old beats + black-box logs | finding them |

- **Achievements gain an "Archivist" line** (25 / 50 / 100% of entries: 15 / 30 / 60 gems). Achievement gems
  stay under the 1,500 budget (1,175 → 1,280).
- **Save:** `almanac = { crew: [templateIds ever hired], enemies: { id: [won, lost] }, seen: [transmission ids] }`.
  Places and discoveries are read from what the save already has (`stats.visits`, `flags`).

## 7. Saves

New top-level fields, each with a normalizer in `migratePlayer`, a rule in both validators and a `QA_FIELDS`
entry on the server:

- `campaign = { done: [missionIds], since: n }`, where `since` counts ordinary contracts since the last story
  mission;
- `loyalty = { [templateId]: points }` and `loyal: [templateIds]`;
- `almanac` (above).

**Rules:**
- No version bump: the new fields are optional.
- `activeContract` gains optional `story`, `loyalty`, `twist` and `flavor`. The contract state check keeps them
  only when they are well formed.
- The fight state gains optional `faction`, `elite` and `twist` blocks. `validFtlBody` rebuilds them from the
  encounter and the twist, and refuses edits.

## 8. Wall schedule after Phase 3

Phase 2 pulled the Ember wall about a week forward for balanced captains, and Garrett left it open. Story rewards
add a little more.

**The call (mine, since Garrett said to improve freely):** after Phase 3's sim, retune the Veil, Ember and
Hollow pools so that:
- balanced captains break the Ember on days 17-29 again;
- ambitious captains break the Hollow from day 23.

Those are the balance pass's numbers. The rewards still make a daily player faster; the walls just ask a little
more of them.

## 9. Art (approved: up to $5, personal Flora, style C, GPT Image 2.5)

About 23 images. Every prompt, cost and output goes in a ledger.

- 5 cast portraits: Auntie Vell, Silas Crane, Commodore Tarrow, the Choir's signal, Captain Wren Halloway.
- 10 client portraits (the recurring clients not in the cast).
- One faction icon sheet (7) and one twist icon sheet (5).
- Two chapter title cards, an Almanac header and the escort freighter, side view.
- Up to two set-piece scenes.

## Build order

1. World bible and campaign script (chapters 1-2, all transmissions).
2. Transmission player, campaign rules, story cards, walls as bosses, Discoveries.
3. Faction mechanics, elites, twists in the fight engine, tells, the sharp policy.
4. Contract generator (clients, jobs, cargo, briefs, twists on the card).
5. Loyalty, bond scenes and loyalty missions (writer sub-agents in parallel with 3-4).
6. The Almanac and the Archivist achievements.
7. Art pass.
8. Sim, balance retune, evidence; an independent audit with every finding fixed under a regression test; merge
   and publish.
