# Audit: Phase 3, the world (2026-10-10)

**Reviewed:** commits `874e0ab..091e126` (campaign, transmissions, loyalty, contract generator, Almanac, enemy
factions and twists, wall retune), read at `74c227e`. That commit already fixed one bug:
- a chapter recruit's crew id came from `Math.random`;
- the guided economy test caught it;
- the fix is a regression test in `test/campaign.test.mjs`.

**Reviewer:** an independent fresh-context Claude session, standing in for the usual Codex "Luna" audit (Codex is
not installed in this cloud environment).

**Method:**
- read-only review;
- each finding reproduced by a Node script against the real modules;
- a 20,000-case fuzz of the client and server save checks.

Every finding is fixed under a regression test in `test/phase3_audit.test.mjs`, except where the Test line names
another file.

## High

**H1. A Loyal merc with three or more stars broke every fight they were in.**
- **Problem:**
  - Loyal raises a merc's role passive by a quarter. The fight's save check capped the passive at the role's best at
    five stars, without Loyal.
  - Nine mercs went over it, among them Wisp, the chapter 2 recruit.
  - Every fight-only card (story, risky jobs, walls, loyalty jobs) greyed out.
  - An Explore fight spent its fuel and then refused every beat.
- **Fix:**
  - The cap now includes the Loyal factor.
  - The factor lives in `src/data/loyaltyRules.js`, shared by `loyalty.js` and `ftlCombat.js`.
- **Test:** H1, a five-star Loyal best merc of every role. The fight is valid, a beat goes through and a reload keeps
  it.

## Low

**L1. Loyalty went to crew who did not fly the job.**
- **Problem:** an injured merc, one hired mid-job or an away team back before the claim earned a point.
- **Fix:** `contractFlyers` pays the crew the contract launched with (`participantIds`), never the captain.
- **Test:** L1.

**L2. Moving the device clock back and forth got around the two-a-day cap.**
- **Fix:** the day's tally starts over only on a later day, the same rule as the login calendar.
- **Test:** L2.

**L3. An edited save could switch a fight's faction rule off by deleting its block.**
- **Fix:**
  - Every saved real-time fight against a faction must carry the block (`fightCarriesFaction`), for contract and
    Explore fights. The guided first fight is exempt.
  - Two older tests loaded fights from before factions. Their saves now carry the block, as a current save would:
    - `fight_stall`, whose fixture gains `{ id: 'scrappers' }`;
    - `balance_pass`.
- **Test:** L3.

**L4. A risky card could name one enemy and fight another.**
- **Problem:** the safer route fought the beacon's weakest ship, which at seven beacons belonged to another faction.
- **Fix:** both routes fight the faction the card names. The safer one meets that faction's weakest ship there.
- **Test:** L4, every risky board over 40 days, early and late game.

**L5. A chapter recruit's reveal replaced the action's own.**
- **Problem:** the last story mission's reveal was lost, and so was a gate Discovery's travel result.
- **Fix:** session results carry extra `reveals`, shown after the action's own effect.
- **Test:** L5.

**L6. Story and loyalty tags on the active contract were not checked.**
- **Problem:** a prototype key such as `constructor` survived load.
- **Fix:**
  - Both tags are kept only when well formed and named by their own card's id.
  - Mission lookups use own keys.
- **Test:** L6.

**L7. With two mercs ready, only one card showed, and it swapped when the other pulled ahead.**
- **Fix:**
  - The card on show stays until played.
  - The waiting merc's dossier says their job comes next.
- **Test:** L7.

**L8. A board could show the same client twice.**
- **Problem:** Vell posted both the story card and a daily job.
- **Fix:** the daily offers skip the clients of the open and the next story mission.
- **Test:** L8.

**L9. Two-Tooth Marrik kept posting bounties after the story had him beaten.**
- **Fix:** story elites (`STORY_ELITES`) are out of the random bounty pool.
- **Test:** L9.

**L10. The board-seen analytics event stopped firing with a story card on the board.**
- **Fix:** it counts the three daily offers only.
- **Test:** L10.

**L11. Captains without walls could never finish the Almanac.**
- **Problem:** the two boss scenes played only when a wall card was reviewed.
- **Fix:** for those captains, a chapter's boss scene follows its last debrief.
- **Test:** L11, which walks the campaign with walls and without, and checks every story entry is seen in play.

**L12. Several design success tests were reported but not tested.**
- **Fix:**
  - `test/contract_economy_guided.test.mjs` now gates:
    - both chapters finished;
    - the first loyalty job won on days 15-28;
    - story and loyalty pay at most 15% of credits.
  - The server parity test has Phase 3 good and bad cases and fuzzes the three new fields.
  - The Ember retune's one balanced captain at day 15 is recorded as accepted in the design (§8).
- **Test:** the guided economy test, and `apps/server/test/unit/warpcrew-client-parity.test.ts`.

## Noted, not bugs

- **Test 3** is met for five of seven factions. Against Scrappers and Swarm the sharp captain is level with Auto,
  because their counters are crew and guns, not taps. The evidence says so.
- **Built differently from the design:**
  - a bond scene shows a notice on the ship rather than a toast;
  - bond scenes replay from the dossier;
  - campaign progress does not raise `story.chapter` (the gate Discoveries already do).
- **Edited saves:** both checks see only the shape of `campaign.done`. Emptying it replays story pay, but the wallet
  itself is just as editable.

## Checked and sound (from the audit)

- **No double rewards.** The story bonus, Loyal bonus and chapter recruit each pay once, and a forged offer id pays
  nothing.
- **No wedges.** Lost story missions return, and walls appear exactly when their missions are done.
- **Twists** never apply to walls or the tutorial job, and twist pay needs the contract and the fight to agree.
- **Fight validation** refuses edited faction timers, ion locks, freighter hull, waves and elites, and a mid-fight
  reload is identical.
- **Determinism and copy:**
  - no `Math.random` or `Date.now` in the new rules;
  - the board's flavour survives a save round trip;
  - text is escaped after `{ship}` is filled in;
  - all 34 art paths exist;
  - no digits or developer words in the new copy.
