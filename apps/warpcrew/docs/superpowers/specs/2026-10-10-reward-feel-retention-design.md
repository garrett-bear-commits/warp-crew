# Phase 2 design: reward feel and retention (2026-10-10)

Status: **building** (Garrett, 2026-10-10: "start phase 2 after balance merges", Flora spending approved). Numbers are
starting values for the 30-day sims, not final. Follows the [deep dive](../../design/21-deep-dive-2026-10-09.md),
problems 3 ("rewards don't feel rewarding") and 4 ("retention loops pay nothing"). Music, the third item in the
deep dive's Phase 2 row, is already done.

## Why

- A normal hire is a toast and a purchase says "Purchase applied" with the same coin click as everything else.
- The daily plan (3 tasks) and the week goals pay nothing. The 7-day login bonus repeats and has no calendar.
- Stations show an output number that does nothing: nothing builds up while the captain is away.
- The shop is text rows with price buttons.

## Success tests (checked by tests and the 30-day sim)

1. Every reward goes through one reveal: hires, purchases, chests, the login calendar, achievements, the
   welcome-back haul and level-ups. Items fly to the wallet, counters roll up, and the sound matches the size.
   A test walks every grant path and checks it raises a reveal.
2. A free captain who checks in once a day earns more, and the free-play targets still hold:
   - free gems per week rise but stay under the budget below (so a 60-gem Rally still means something);
   - Phase 2 sources are at most a third of credits over 30 days;
   - the wall schedule from the balance pass moves by at most a day.
3. Away 8 hours, the welcome-back haul is worth about one contract at that point in the game; the hold caps it.
4. Nothing new is sold. There are no new SKUs and no Jest console changes. Chest odds are shown.
5. Saves stay valid: new fields have defaults, migrate from the current save, and the validator rejects edited
   values. Rewards can't be re-rolled by reloading.

## 1. One reward reveal

Presentation only, like `src/ui/music.js`: it never changes game state.

- `showReward({ source, title, items, tier })`, with each item one of `{ kind: 'credits'|'gems'|'medals'|'fuel'|
  'reputation'|'marks', amount }`, `{ kind: 'crew', templateId }`, `{ kind: 'shards', templateId, amount }` or
  `{ kind: 'chest', chest }`.
- A queue, so a login on a new day can stack calendar, idle haul and chest without overlapping.
- Cards pop in one by one. Each currency flies from its card to its top-bar chip, and the chip counts up.
- Tap to skip. With reduced motion, items appear without travel.
- The tier comes from the reward's gem-equivalent value: small (click), medium (chime), large (beacon), huge
  (fanfare, same as a Legendary hire). These are the existing Kenney sounds.
- Wired to: purchases (replaces "Purchase applied"), the calendar, chests, achievements, the welcome-back haul,
  crew level-ups and Ascension. The contract result screen keeps its layout but its rewards fly to the wallet.
- The hire reveal (pods) stays. The medals and shards from duplicates join it as cards.

## 2. 28-day login calendar (replaces the 7-day table in `src/systems/daily.js`)

- Each new game day, the next square can be claimed (one per day, at the shared midnight reset).
- **A missed day does not reset the calendar**: it waits. It is kind, it fits Jest's audience, and the streak is
  still counted for analytics.
- Each 28-day cycle escalates:
  - small currency on ordinary days;
  - a bigger day every 7 days;
  - day 14: 10 Contract Marks;
  - day 21: 50 gems;
  - day 28: **one guaranteed Epic-or-better hire**, using the gacha's existing `guaranteedRarity`. It adds no pity
    and grants no Marks, so the banner math is untouched.
- A calendar screen (from the top bar and Log) shows 28 squares, today's square glowing and the day-28 merc
  pod. Claiming opens the reveal.
- The current day-7 15 gems moves to the larger day-7 square, so week one pays about what it does today.

## 3. Daily orders and chests (the daily plan and week goals start paying)

- **Daily orders.** The daily plan grows from 3 tasks to 5, each worth points:
  - claim a contract (30);
  - improve ship or crew (20);
  - launch an away team (20);
  - make a jump on the star map (15);
  - win a fight (15).

  100 points opens the **daily chest**. The day's orders show on the hub as a points bar.
- **Weekly chest:** open 5 daily chests in a game week (Monday to Sunday).
- **Contents:** rolled from published tables of credits, medals, fuel, Marks, a small gem chance, and shards
  of an owned merc. Chests are free and never sold.
  - The roll is seeded from the save's seed and the day, so a reload never changes it.
  - The odds are shown on the chest ("Possible contents"), as Jest's rules for random rewards ask.
- The week goals (5 jumps, 3 wins, 2 expeditions) become the first rungs of achievements (section 5). The new
  weekly chest replaces them.

## 4. Idle income ("while you were away")

- Staffed stations earn credits per hour: a base, plus the role bonus that `stationOutputs` already shows, plus
  crew level. Engineering also trickles medals. The station numbers on the ship become real income.
- **The hold:** income stops at 8 hours to start; each Cargo level adds 1 hour, up to 16. So Cargo becomes worth
  upgrading, and checking in twice a day pays.
- **Welcome back, Captain:** after an hour or more away, a claim screen shows the haul (the reveal) and how full
  the hold got.
- **Rate:** tuned in the sim so a full 8-hour hold is about one average contract payout for the captain's
  progress.
- **Time:** accrual uses `trustedNow` (server time when available), ignores time running backwards and never
  passes the hold. Away crew (expeditions, injured) earn nothing.

## 5. Achievements

- About 30 achievements in six tracks, with 3–5 tiers each:
  - Combat (wins, flawless fights, signature moves used);
  - Crew (hires, levels, Ascensions, families);
  - Ship (upgrades, hulls);
  - Explore (jumps, events, beacons);
  - Walls (segments and walls broken);
  - Collection (mercs owned per rarity).
- **Rewards:** medals and credits, with gems on milestone tiers. Gems from all achievements together are capped
  by a **lifetime budget of 1,500 gems**. This is the core's rule for client-claimed rewards.
- **Definitions:** shaped like the core's `AchievementDefinition` (`packages/contracts/src/achievements.ts`,
  `client_claim` criteria on stats keys), so they can move server-side at the cut-over by switching on the
  `achievements` feature.
- **Screen:** under Log, with the tracks and progress bars. A finished tier gets a claim button and a dot on the
  tab; claiming opens the reveal.

## 6. Shop redesign

- **Sections:** Featured (one context offer, as the monetization plan's moments already decide), Gems (the five
  packs), Packs (starter kit, the wall pack for the wall you face), Commission (subscription), and Use gems
  (Rally, fuel refill, drydock skip; what gems buy).
- **Product cards:** art (gem piles from pouch to hoard, the starter crate, one image per wall pack, the
  Commission badge), the price, and contents as icons.
- **Value badges are computed, not invented.** "+12% gems" to "+40% gems" come from each pack's amount against
  the smallest pack's rate. "Best value" goes on the best gems per dollar. There are no fake discounts, timers
  or crossed-out prices, per the approved fairness rules.
- Unchanged: the catalog, prices, purchase flow and server verification.

## 7. In-app notices

- **Dots and a notice strip on the hub:** daily chest ready, calendar square ready, hold full, achievement to
  claim, and wall pack available (only where the monetization plan already shows it).
- **Jest text notifications** (`src/systems/notifications.js`) keep the one-a-day limit. "Hold full" joins the
  ladder as a candidate, and does not add a second message that day.

## 8. Economy and the 30-day sim

- The guided sim (`src/sim/contractEconomy.js`) plays every new source:
  - it claims the calendar square, the orders and chests, and achievements as earned;
  - it collects idle income at its daily check-in;
  - a second check-in variant measures the twice-a-day player.
- **Free gem budget:** about 25–35 gems a day averaged over 30 days, across the calendar, chests, achievements
  and the existing Commission-free sources. It is measured before and after; the evidence doc reports gems by
  source.
- `test:balance` regenerates the evidence, and the CI gate stays.

## 9. Art (Flora, personal workspace, approved 2026-10-10)

About 30 images in style C, using the Sparrow and the currency icons as style references. Expect about $2–3 of
the new $20.

| Group | Images |
|---|---|
| Shop | 5 gem piles, starter crate, 5 wall packs, Commission badge |
| Chests | daily and weekly, closed and open |
| Calendar | the day-28 merc pod, the Marks token, and a shard icon (currency icons are reused) |
| Achievements | six track badges (tier frames drawn in CSS) |
| Welcome back | a cargo-hold illustration and a hold icon |

The ledger records each image, its prompt, run id and cost, as before.

## 10. Build order

1. The reward reveal, wired to purchases, the login bonus and duplicate hires.
2. The calendar, with its sim and save migration.
3. Daily orders and chests, with the sim.
4. Idle income and the welcome-back screen, with the sim.
5. Achievements.
6. Shop redesign, with its art.
7. Notices.
8. Regenerate the evidence, a Luna audit (every finding fixed under a regression test), then the QA build.

## Defaults chosen (Garrett can change any)

- Missing a day pauses the calendar instead of resetting it.
- Day 28 gives a guaranteed Epic-or-better hire, not a chosen merc.
- The hold starts at 8 hours and grows by 1 hour per Cargo level, up to 16.
- Achievement gems are capped at 1,500 for a lifetime.
