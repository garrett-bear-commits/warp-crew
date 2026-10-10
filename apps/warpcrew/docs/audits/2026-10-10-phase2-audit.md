# Audit: Phase 2, reward feel and retention (2026-10-10)

Reviewed commit: `117b79d` (Phase 2 code, `7d509a4..117b79d` minus the fight-stall and Crown-gem fixes).

**Reviewer:** an independent fresh-context Claude session, standing in for the usual Codex "Luna" audit (Codex is not
installed in this cloud environment).

**Method:** read-only code review, with each finding reproduced by a Node script against the real modules. The 30-day
sim ledger was checked in all 15 guided runs.

Every finding is fixed under a regression test in `test/phase2_audit.test.mjs`, except where the Test column names
another file.

## High

**H1. The login calendar paid again when the device clock was moved.**
- Problem: any day other than the last claim's paid, including an earlier one. Switching the clock between
  yesterday and today gave 56 squares and two Epic hires in one real day. This only applies when the game runs on
  the device clock (offline, or before the server answers).
- Fix: only a later day pays (`calendar.js`). The free daily hire uses the same rule (`daily.js`).
- Test: H1.

**H2. The star-map jump order never counted for captains with lost contracts.**
- Problem: `mapJumps` subtracted losses twice; they are already inside completed contracts. In the sim,
  wall-grinding captains missed the order (and the chest) on days they jumped.
- Fix: `exploreNudge.js` subtracts completed contracts only.
- Test: H2.

## Medium

**M1. Moving the clock forward and back refilled the hold.**
- Problem: a start time later than now was reset to now, so each round trip paid a full hold.
- Fix: the saved start is kept; nothing builds until real time passes it (`idle.js`).
- Test: M1.

**M2. The hold was paid at the rate and size at the moment of collecting, for the whole time away.**
- Problem: staffing stations, an away team coming home or a Cargo upgrade just before collecting paid backwards.
- Fix: the hold now banks what it earned whenever who earns or the hold size changes (`settleIdle`). That happens
  in every session action, on drydock builds, on injuries healing and on away teams returning. Only earning hours
  fill the hold. A version of this fix had a deadlock of its own: hours with nobody at a station filled the hold
  with nothing. The test caught it.
- Test: M2 (four cases).

**M3. The sim collected the hold before the away team came home.**
- Problem: the game does it the other way round at boot. Also, no test checked the Phase 2 credit share.
- Fix:
  - The sim now collects after the return.
  - `test/contract_economy_guided.test.mjs` gates the share (median at most a third, none above 45%), free gems
    (at most 35 a day), daily chests (at least 20 days) and that every source pays.
  - The evidence has a Phase 2 table.
- Test: M3, and the guided economy test.

**M4. The welcome-back and calendar sheets stayed open after claiming.**
- Problem: the session answers the claim and returns before `main.js` closed the sheet. The welcome-back sheet
  came back by itself ten minutes later.
- Fix: the flags are cleared before the session call.
- Test: `test/reward_reveal.test.mjs`.

## Low

**L1. The "Hold full" text was not rescheduled after collecting or changing stations.**
- Fix: `idle-claim`, `station-assign`, `calendar-claim`, `chest-open` and `level-crew` now refresh notifications.
- Test: `test/reward_reveal.test.mjs`.

**L2. The "Hold full" text could be a second text the next day, or arrive at night.**
- Fix: it is sent only for a fill time later the same day, between 08:00 and 21:00.
- Test: L2.

**L3. The reveal showed fuel that did not fit in a full tank.**
- Fix: the calendar and chests report the fuel actually added.
- Test: L3.

**L4. Collecting often lost the fractions.**
- Problem: hourly collects never paid Engineering's medals.
- Fix: fractions stay banked.
- Test: L4.

**L5. After square 28 the Log read "Day 0 of 28 claimed".**
- Fix: a finished cycle reads as finished until the next day.
- Test: L5.

**L6. An odd saved calendar or idle clock failed the save check, and the server had none of the Phase 2 rules.**
- Fix:
  - `migratePlayer` cleans both, so a load repairs them.
  - The server's `isWarpcrewPlayer` (`apps/server/games/warpcrew/policy.ts`) has the calendar, idle and
    achievement rules.
  - The parity test fuzzes all three.
- Test: L6, and `apps/server/test/unit/warpcrew-client-parity.test.ts`.

**L7. A crafted achievement id (`__proto__`) threw.**
- Fix: an own-key lookup.
- Test: L7.

## Not a bug, noted

The spec's twice-a-day check-in variant of the sim is not built.

## Checked and sound (from the audit)

- No double claims across reload or two tabs.
- Seeded chest and day-28 rolls survive a reload.
- The hire pity is untouched.
- Shards never go to the captain.
- Day and week keys are right across DST changes (New York, Lord Howe).
- No `Date.now` or `Math.random` in the new rules.
- Old daily-loop saves migrate.
- Achievement gems total 1,175, under the 1,500 budget.
- New renderers escape text, every new action is handled, and every new sheet can be closed.
