# The first hour, music and fight feel (2026-10-10)

Garrett's feedback after Phase 3, before Phase 4 starts:
- Tooltips when a player taps the top currencies.
- Does the tutorial continue after the first battle? Do we explain contracts well enough?
- Will players know what "Berth" is? A quick tutorial on crew upgrades.
- Tutorials gated: one system at a time, quick and fun.
- Fewer words on screen, above all in a new player's first few contracts. Don't overwhelm or scare them away.
- Music: no song change when switching Ship, Contracts and Crew; smooth crossfades. Songs may change for fights
  and other real transitions, but tapping quickly around the menus must not flip songs back and forth.
- Fights should feel as good as FTL: more effects, whatever it takes.

Story missions stay a breather (Garrett, 2026-10-10).

## What a new player gets today (played on the QA build, fresh save, 390 px)

1. **The tutorial ends right after the first fight.** After "Bring cargo aboard" there are three short sheets: name
   the ship, a free recruit, sign-in. Then "Continue to ship" and the player is on their own with one button,
   "Crew ready · See contracts".
2. **Contracts are never taught.** The tutorial's fight accepts and launches its job for you, so the first board
   the player sees is the full one:
   - every card has up to twelve pieces of text: client, title, brief, twist, faction, story pay, four facts
     ("Normal fuel 2F", "Length 3 beats", "Danger", "Possible payout now"), the fight line and "Favored: Gunner";
   - the review sheet adds "Payable route fuel" and "Accepting spends no fuel. Fuel is spent by route actions."
3. **Fuel is never explained.** The first launch spends it without a word, and the fuel chip can't be tapped.
4. **"Berth" is never defined.** It means a crew slot: how many crew fly with you.
5. **Nothing teaches crew upgrades.** After each later claim the game jumps to a room or a dossier with no
   explanation.
6. **The gates leak.** Systems are meant to open one at a time (Shop and Log after two contracts, Explore after
   three). But anyone holding gems skips the gate, and the first story mission pays 10 gems, so everything opens
   at once. The login calendar also pops up on the first reload, before the player has seen a contract.
7. **Music:** Contracts plays the star-map song and every other tab the ship song, with no delay, so every
   Ship↔Contracts tap crossfades. Two player bugs as well:
   - a quick return restarts a song from the top;
   - a leftover timer can cut a fade short.
8. **The top bar** shows fuel, credits and medals (gems join later), as bare icons and numbers with no labels.

## A. The first hour

### A1. Lessons: one system at a time

A lesson is a small coach card that points at one thing:
- one or two short lines (at most 20 words);
- one button ("Got it", or the action itself);
- optionally a glow on the one control it is about.

Lessons live in a data table (`src/data/lessons.js`). Each has:
- an id;
- a trigger (a pure function of the save);
- the screen it shows on;
- its lines;
- an optional target selector.

Rules (`src/systems/lessons.js`):
- **At most one lesson at a time,** and only on its own screen.
- **Never on top of** a fight, a transmission, a reward reveal or any sheet.
- **At most one new lesson per screen visit,** so they never chain into a lecture.
- **In a fixed order:** a later lesson waits for every earlier one that has triggered.
- **Seen once, saved.** The ids go in a validated save field, `player.lessons` (both save checks, as in Phase 3).
- **"Tips: On/Off" in Log > Settings** turns them all off.

The lessons, in order, and what triggers each:

| Id | When | Screen | Says (draft) |
|---|---|---|---|
| contracts | Tutorial done, no contract yet | Ship → Contracts | "Contracts pay the bills. Tap one to see the job." |
| accept | First review sheet | Review | "Low danger is a safe start. Accept to take it." |
| launch | First accepted contract | Ship | "Launch spends fuel. You get one back every hour." (glow on the fuel chip) |
| route | First route choice | Route card | "Pick your route. The safe way pays less." |
| level_up | First claim after the tutorial, a level affordable | Crew | "Medals train your crew. Tap Level up." |
| upgrade | A room upgrade affordable, after level_up | Ship | "Credits upgrade the ship. Tap a glowing room." |
| log | Log unlocks (two contracts) | Ship | "New: the Log. Daily orders, the calendar and your Almanac." |
| risky | Third board visit | Contracts | "Risky jobs fight harder and pay more. Check the win odds." |
| explore | Explore unlocks (three contracts) | Contracts | the existing coach mark |
| hire | First free daily hire or 500 credits | Crew | "Hire crew at the beacon. A repeat hire adds a star." |
| crew_slots | First time crew outnumber the slots, or Quarters can upgrade | Crew | "Crew slots: how many fly with you. Upgrade Quarters for more." |
| level_cap | First merc at their level cap | Crew | "Level cap. Another copy adds a star and raises it." |
| away | Away unlocks with crew to spare | Contracts | "Away teams: spare crew run planet jobs while you fly." |
| factions | Fourth contract | Contracts | "Each enemy has a trick. The card says how to beat it." |
| moves | First fight with a crew move ready | Fight | "Tap a portrait to use their move." |

**The jump after a claim.** The game still moves to the room or dossier after a claim, but the matching lesson
says why. The jump only happens while that lesson is still unseen.

### A2. Simple contract cards for the first contracts

Until a new captain (script 5) has finished four contracts, cards and the review sheet show only:
- the client row;
- the title;
- one line of brief;
- three chips: fuel, danger and win odds;
- the pay, as one line (story pay folded in);
- one button.

Hidden until then:
- length;
- the "Possible payout now" label;
- favored crew;
- twists (early boards roll none);
- the faction line.

Also hidden: the review's "Payable route fuel" label and the "Accepting spends no fuel" note. The fuel chip says it
once, and the launch lesson covers the rest.

From the fifth contract on, the full card returns, introduced by the factions lesson. Veterans, and anyone who
turns tips off, always see the full card.

### A3. Words

- **"Berth" becomes "crew slot"** wherever it names the mechanic. Lore uses stay (the Null Berth, a dock berth).
  - "Cargo aboard. Third berth open." becomes "Cargo aboard. Room for one more crew."
  - Quarters: "+1 crew slot".
  - Crew tab: "Crew slots 2/3".
- **The first three contracts' screens get a text pass:**
  - route card;
  - fight hints;
  - claim panel;
  - reward reveal.

  One idea per line, no developer words, at most two lines of help on any screen.

### A4. Gates that hold

- **Earned gems no longer skip the gate.** Only a purchase does (someone who paid has seen the Shop).
- **The login calendar and the welcome-back sheet wait** until the Log is unlocked (two contracts).
- **The daily-orders chip and the notice strip wait** for the Log too.

### A5. The tutorial carries on

The guided flow continues past "Continue to ship" into the first real job: Vell's "First Honest Job" story card.
- It plays its briefing, then the contracts, accept, launch and route lessons, then its fight and its claim.
- The free recruit is placed at a station too. Today their suggested station is only shown.

## B. Currency tips

Tapping a top-bar chip opens a small tip under it:
- name, a line on what it is for, and where more comes from;
- one tip at a time;
- a tap anywhere else, or 5 seconds, closes it.

**Fuel keeps its claim.** Tapping it collects any waiting fuel, and the tip says "Collected 2 fuel. One more every
hour; full in 3 h."

| Chip | Tip (draft) |
|---|---|
| Fuel | "Fuel. Launching a contract or jumping uses it. One comes back every hour." |
| Credits | "Credits. Every contract pays them. They buy ship upgrades, fuel and new crew." |
| Medals | "Medals. Contracts pay them. They level up your crew." |
| Gems | "Gems. Rare: from the story, the calendar, chests and the Shop. They hire crew and speed things up." |

## C. Music that stays put

- **One song for the whole ship:** Ship, Crew, Contracts, Away, Shop and Log all play the ship song.
- **The star-map song plays only on the Explore map.**
- **Fights and walls switch at once** (they are events). Coming back from a fight also switches at once.
- **A change between the ship and the map waits about 4 seconds** before it starts, and is dropped if the player
  taps back first.
- **Crossfades are equal-power,** about 2.5 s between the ship and the map, and 1.2 s into a fight.
- **The two bugs are fixed:**
  - a song keeps its place when you come straight back;
  - a stale timer can no longer pause a fading song.
- **If a third song is needed mid-fade,** the fading one dips out over 0.15 s instead of cutting.

## D. Fights that feel like FTL

Designed from a map of today's fight effects; see §D below once that map is in.

## Success tests

1. **A new captain meets one system per screen.** A walk through the first five contracts never shows two lessons,
   or a lesson over a sheet. Every lesson in the table fires in play, in order.
2. **The first four contract cards carry at most six pieces of text,** and from the fifth the full card is back.
3. **No player copy says "berth" for the mechanic.**
4. **The gates hold.** Shop, Log and gems open at two contracts and Explore at three, even with story gems in the
   wallet. The calendar never opens before the Log.
5. **Tapping each chip shows its tip,** and fuel still claims.
6. **Music:** ten quick Ship↔Contracts↔Crew taps never change the song. A ship↔map change starts only after the
   wait. Coming back keeps the song's place. A fight switches at once.
7. **Every existing suite passes,** the guided sim still finishes its 30 days, and the balance evidence is unchanged
   unless a gate moved and the report says why.
