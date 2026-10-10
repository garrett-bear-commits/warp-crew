# Phase 4: live (2026-10-10)

The roadmap's Phase 4: "Season 1, season pass, event map and merc, leaderboards, The Rift". This is long-term
retention and the biggest revenue lever (deep dive, docs/design/21-deep-dive-2026-10-09.md).

Rules that hold:
- **Fairness:** all fighting power can be earned in play. The event merc is on the free track, and limited mercs
  come back.
- **Real money stays mocked:**
  - the premium track is built and testable with mock purchases;
  - its Jest product, real sales and minting wait for staging and Garrett's yes;
  - nothing sells below $1.99, and each product is its own SKU.
- **"Social later":** leaderboards are built behind a flag that stays off until Garrett turns them on. There are no
  guilds and no PvP.
- **One reset time:** seasons and weeks turn at local midnight on the game's own day and week keys
  (`localDayKey`, `weekKey`).
- **Free gems stay under 35 a day** (today 21-30), so the free track's gems are small.
- **Determinism:** event jobs, the Rift and rotations are seeded from the save and the day or week key. A reload
  never re-rolls.

## What the core gives us (mapped 2026-10-10)

game-core already has:
- live-ops schedule windows, flags and segments;
- content documents;
- leaderboards with seasons, server-timed runs, bounds and top-N review;
- an inbox and server achievements.

Warp Crew uses none of it yet: every feature is off in `apps/server/games/warpcrew/game.config.ts`, and the client
has no calls for it. The QA build has no server at all, so every live system must work offline from the built-in
calendar first. The server only adds the ability to move dates without a release, and the leaderboard.

## 1. Seasons

- **The clock.** A season is 6 weeks, defined in `src/data/seasons.js`:
  - id, name, theme;
  - start (a Monday), length;
  - event, pass, shop and rotation.
- **Season 1, "The Ember Uprising":** 2026-10-05 to 2026-11-15, so it is live in the QA build now.
  - The Forge Moon's workers rise against the owners of the Ash Ledger.
  - It is a taste of chapter 3 (Ember Reach) before the chapter itself.
- **Between seasons** only the Rift runs. With no next season defined, the last one reruns as a rerun.
- **Online,** a core live-ops window of kind `season` can move a season's dates without a release (§6). Offline the
  table rules.

## 2. The season pass

- **Tiers.** 30 tiers of 100 season points each.
- **Where points come from:**
  - daily orders (10 a milestone, up to 50 a day);
  - contracts (5);
  - event jobs (15);
  - Rift floors (5 each);
  - three weekly challenges (100 each).
- **Pace.**
  - A player who checks in daily finishes the free track around day 35.
  - Someone who plays every other day reaches the event merc (tier 20) around day 30.
  - The sim gates both.
- **Free track:**
  - credits, medals, fuel and event scrip;
  - a few shards;
  - **the event merc at tier 20**;
  - at most 100 gems over the season (about 2.4 a day).
- **Premium track** (mock checkout, SKU `wc_pass_s1`, suggested $9.99, waiting on Garrett) adds:
  - more of each reward and more gems (about 900 over the season);
  - a second copy of the event merc (a star);
  - a season portrait frame.

  Nothing on it is power that can't be earned free: stars also come from hires, and the merc returns in later
  banners.
- **Claiming.** Claims go through the reward reveal. A tier can be claimed any time before the season ends. At the
  end, unclaimed free rewards are paid out (via the reveal at the next visit).

## 3. The event: the Forge Moon rising

No new map. The event lights up the Spur map's own **Forge Moon** beacon and its neighbours:
- **Six event missions** with transmissions: a short arc with the union boss and a turncoat foreman. The last one,
  in week five, is a mini-boss.
  - They play like story missions: a gold "Event" card on the board, one at a time, a new one every few days.
- **Repeatable event jobs:** one or two "Uprising" cards on the board each day (a new client family). They pay
  **Forge scrip**, the event currency, plus normal pay.
- **The event shop** (Log or Shop tab), with limits:
  - event merc shards;
  - fuel, medals and credits;
  - an event chest;
  - the season frame.

  Leftover scrip turns into credits when the season ends.
- **The event merc:** a new Epic with a kit, a family, a bio, two bond scenes and a loyalty job (same as the 46). It
  needs a portrait and small figure art (see questions).
- **Weekly rotations** (seeded by week key), one a week, shown on the board's header:
  - "Salvage week": contracts pay +50% scrip;
  - "Boss rush": walls already broken can be replayed for scrip;
  - "Swarm incursion": beat 12 Swarm ships for a chest.

  The three weekly challenges come from the week's rotation.

## 4. The Rift

The endless frontier past the story. It opens once the Veil wall falls (chapter 2 done).
- **A dive** is a chain of fights ("floors") with rising enemy power.
  - Each floor stacks one more modifier: elite modifiers and faction tricks.
  - Hull carries over between floors, as in FTL.
  - Between floors you pick one of two boons, for example "Patch 30 hull", "Shields +1 layer this dive" or "Guns
    charge faster".
  - Cash out any time between floors; losing ends the dive with what you banked.
- **Cost.** A dive costs 2 fuel. One dive a day has its first floor free.
- **The weekly seed is the same for every player** (from the week key), so a future leaderboard is fair.
- **Rewards:** season points and scrip per floor, plus weekly milestones at floors 5, 10, 15 and 20, paid once a
  week.
- **Offline** you see your best floor this week and ever.

## 5. Leaderboards (flagged off)

- One board, `rift_weekly`, the deepest floor this week, on the core's leaderboard feature:
  - the server stamps the run's start and checks its time;
  - the score has bounds;
  - the summary is the floors and the fights' seeds, so the server can bound it.
  - The top 20 is held for review.
- The core has no automatic weekly rollover, so it needs a small scheduled job or an admin step. That is staging
  work.
- **Hidden behind the flag `rift_leaderboard`** until staging passes and Garrett turns it on.

## 6. Server plumbing

- Turn on the core's `liveops` for Warp Crew, with:
  - typed flags (`rift_leaderboard`, `season_premium`);
  - schedules of kind `season` and `rotation`.
- The client reads `/v1/config` when online and falls back to the built-in calendar offline.
- **New save fields:**
  - `season`: `{ id, points, claimed: { free, premium }, scrip, shop, weekly }`;
  - `rift`: `{ week, best, bestEver, dive }`.

  Both get defaults, clean-up on load and checks in both validators (as in Phase 3), plus the server parity test.
- **Premium ownership** comes from the purchase grant, never from the save alone.

## 7. Evidence

The 30-day sim gains seasons:
- points a day;
- the day each captain reaches tier 20 and finishes the free track;
- scrip earned and spent;
- the Rift's best floor;
- free gems a day (still at most 35).

The guided test gates these. The balance evidence is regenerated.

## Build order

1. **The season clock,** pass (free track), points and claims, with saves and tests.
2. **The event:** Forge Moon missions and transmissions, Uprising jobs, scrip, the event shop, the event merc (art
   after Garrett's yes).
3. **The Rift:** dives, floors, boons, weekly seed, personal bests.
4. **Weekly rotations and challenges.**
5. **Server:** liveops on, schedules, flags, and the leaderboard behind its flag.
6. **The premium track** on mock checkout.
7. **Sim gates,** an independent audit, then merge and publish.

## Questions for Garrett

1. **Art:** about $2 on your personal Flora account for:
   - the event merc's portrait;
   - an event card scene;
   - the pass banner;
   - the Rift's look.
2. **The premium pass:** is $9.99 right? Its Jest product gets created only at staging, with your yes.
3. **Leaderboards:** turn on at staging, or keep them off until Jest numbers say social is worth it?
4. **Season length:** is six weeks right? (The deep dive suggested 4-6.)
