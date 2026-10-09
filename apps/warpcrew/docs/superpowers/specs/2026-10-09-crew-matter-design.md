# Phase 1 design: make the crew matter (2026-10-09)

Status: **design, approved in principle** (Garrett agreed with the deep dive's step order on 2026-10-09). Numbers
are starting values for the balance sims, not final. Builds on the FTL-lite fight
(`docs/superpowers/specs/2026-10-04-ftl-lite-combat-design.md`, `src/systems/ftlCombat.js`).

## Why

Today a merc counts in a fight only by role: ×1.15 for manning a room, ×1.3 for the matching room. Power, rarity
and bonuses are ignored, crit never crits, and contract threat pulls enemies up to 82% of any power you have
above their listed level. A Legendary plays like a Common, so the gacha has nothing to sell. This package makes
each merc visible and felt in every fight, and makes collecting them worth it.

## Success tests (checked by sims and tests, not by feel alone)

1. Every merc has a passive that changes fight numbers and an active ability with a visible effect, an event and
   a bark.
2. With the ship fixed, swapping a typical day-7 crew (Common and Uncommon) for one with a Legendary raises the
   win rate on a "Dangerous" contract by at least 15 points.
3. A fully idle captain with **Auto** on wins about as often as today's idle captain on the same content (so idle
   play doesn't get harder). An active captain who taps abilities well wins more.
4. The fight still runs in deterministic beats, saves and reloads mid-fight, and the save validator rejects
   edited ability state.
5. Fights stay 30–60 s (the tutorial fight 15–20 s).

## 1. Crew stats inside the fight

Each fighting crew member enters the fight with:
- `templateId`: which merc;
- `grade` 0–1, from effective power (base × stars, plus level and rank; `src/data/crewRoster.js`), roughly
  `(power − 8) / 50`. A level-1 Common is about 0.04, a level-1 Legendary about 0.45 and an Apex about 0.9.

**Station mastery** replaces the flat ×1.15 / ×1.3:
- the matching role in a room gives about 1.25 + 0.35 × grade;
- any other crew member in a room gives about 1.10 + 0.15 × grade;
- a pilot at the helm adds about 10 × grade evasion.

**Role passives become real** (the data fields already exist; today most do nothing in a fight):

| Field | Today | In the fight |
|---|---|---|
| `critChance` (gunners) | turned into pre-fight power only | each player shot can crit: ×1.5 hull damage, +10 room damage, a "CRIT" pop |
| `repairBonus` (engineers) | partly | repair and extinguish speed × (1 + bonus) |
| `assistCharge` (medics) | old assist path only | every crew member's ability charges × (1 + 2 × bonus) |
| `tradeCredits` (traders) | trade payouts | fight salvage on a win also gets + this much |
| `expeditionSuccess` (scouts) | away teams | enemy evasion − (bonus × 100) points |
| `pirateResist` (security) | pre-fight power | damage to boarders × (1 + bonus × 3); boarder sabotage × (1 − bonus) |
| `fuelCostReduce` (pilots) | travel fuel | unchanged (travel); the fight uses the helm evasion above |

## 2. Active abilities ("signature moves")

- Every crew member has one ability. It charges while they are aboard, starting at 50%, with a charge time in beats
  (about 12–25; stronger moves charge slower). Medics speed everyone's charge.
- **Tap a portrait** on the fight's crew rail when its ring glows to use the ability. The command is
  `{ type: 'ability', crewId }`; it applies at the start of the next beat, like a move.
- **Auto** toggle (remembered per player): the scripted policy casts each ability when it is useful (for example,
  Patch Job when a room is below 70% or burning, Bribe when an enemy gun is about to fire). The economy sims use
  the same policy, so balance includes abilities.
- The effect library (each effect has parameters; kits combine one or two):

| Effect | What it does |
|---|---|
| `charge` | all player weapons gain X% charge now |
| `extraShots` | the next volley fires +N shots per weapon |
| `pierce` | the next N shots ignore shields |
| `sureHit` | the next N shots can't miss; +X% room damage |
| `evade` | +X evasion for N beats |
| `dodgeNext` | the next N enemy shots miss |
| `shieldBurst` | restore all shield layers; optionally +1 layer over max for N beats |
| `repair` | repair X integrity in the worst room (or all rooms); puts out the fire there |
| `hullPatch` | restore X hull |
| `haste` | crew repair, extinguish and repel ×X for N beats |
| `stall` | enemy weapons stop charging for N beats |
| `drain` | knock out N enemy shield layers; stall their recharge |
| `strike` | X integrity damage to the targeted enemy room, plus optional hull damage |
| `ignite` | start a fire in the targeted enemy room |
| `brace` | enemy hull damage halved for N beats |
| `lastStand` | once per fight: if the hull would reach 1 in the next N beats, it holds at X instead |
| `salvage` | +X% credits on a win this fight |
| `rewind` | every enemy weapon's charge resets to 0 (Apex) |

**Presentation:** the portrait slides in with the move name in a comic-style banner ("SHORT FUSE!"), the effect
plays on its target (shield flare, repair sparks, enemy guns sputtering), and the merc says their quote line.
Long-press a portrait to read the ability card.

## 3. Kits for all 50 mercs

Rarity sets how much a kit changes play:
- **Common:** the role's standard move.
- **Uncommon:** the standard move with a twist.
- **Rare:** a unique move.
- **Epic:** a unique move with a second effect.
- **Legendary and above:** a move that breaks a rule.

Charge times are starting values.

**Standard moves by role** (Commons, including the four captains as "Captain's Order"):

| Role | Move | Effect | Charge |
|---|---|---|---|
| Pilot | Hard Burn | evade +25 for 3 beats | 14 |
| Gunner | Hot Barrels | charge +40% | 14 |
| Engineer | Patch Job | repair 40 in the worst room | 12 |
| Medic | Stim Round | haste ×2 for 4 beats | 14 |
| Scout | Mark Target | sureHit 3 shots, +50% room damage | 14 |
| Trader | Bribe the Gunner | stall 3 beats | 18 |
| Security | Hold the Door | ×3 damage to boarders for 4 beats; with no boarders aboard, brace 2 beats | 14 |

Commons: Rex, Tess (Hard Burn); Jen, Dax (Hot Barrels); Bolt, NUB-4 (Patch Job); Moss-3 (Stim Round); Juno
(Mark Target); Plip, Pip (Bribe); Greaves (Hold the Door).

**Uncommon (standard plus a twist):**

| Merc | Move | Twist |
|---|---|---|
| Kira Nyx | Short Fuse | Hot Barrels, and the next volley fires +1 shot |
| Syla | Harmonic Haggle | Bribe, and drain 1 enemy shield layer |
| Rook Halden | The Stare | Hold the Door for 6 beats |
| Nemi-Vox | Echo Ping | Mark Target for 4 shots |
| Cogwheel | Thesis Defense | Patch Job on the two worst rooms |
| Yara Quell | No Waiting Room | Stim Round, and repair 10 in every room |
| Brink | Static Plot | Mark Target, and −10 enemy evasion for 4 beats |
| Oso Brack | The Quiet Way | Hold the Door, and brace 3 beats |
| Orla Finch | Pass the Clamp | Stim Round for 6 beats |
| Tink | Enthusiastic Maintenance | Patch Job, and put out every fire |

**Rare (unique):**

| Merc | Move | Effect |
|---|---|---|
| Vorn | Four-Arm Oath | shieldBurst with +1 layer over max for 6 beats; no boarder sabotage meanwhile |
| Quill | Cold Read | pierce: the next volley ignores shields |
| Isa Mender | Field Surgery | hullPatch 8 |
| Drift | Borrowed Wind | dodgeNext 2 |
| HEX-19 | Target Lock | sureHit 4, and those shots crit |
| Kal Vesper | Customs Cutter | evade +20 for 4 beats, and slow enemy charge 30% |
| Vex | The Note Lands | one free 6-damage shot that ignores shields |
| Moth Vale | Already Sold It | stall 4, and salvage +20% |
| Reed-7 | Floor Plan | the targeted enemy room takes ×2 room damage for 6 beats |

**Epic (unique plus a second effect):**

| Merc | Move | Effect |
|---|---|---|
| ADA-7 | I Feel It | all other abilities +50% charge, and haste ×2 for 3 beats |
| Skarn of Glass | Cleave Along the Grain | strike 40 on the targeted room, plus 4 hull |
| Lora Chen | Better Lighting | stall 5, and drain 1 |
| Wisp | Already in the Room | the targeted enemy room goes offline (integrity 0) |
| Rune Calder | The Rib Sings | repair 50 in all rooms; put out every fire |
| Ashen Kade | The Interesting Part | brace 5 beats |
| Nyx Hollow | The Hallway Moved | every enemy shot misses for 3 beats |
| COIL | Yard Alive | shieldBurst, and shield recharge +50% for 6 beats |

**Legendary, Mythic and Apex (rule-breakers):**

| Merc | Move | Effect |
|---|---|---|
| Zephyr | Laugh at Gauges | evade +40 for 6 beats; every dodge adds +15% weapon charge |
| Captain Onyx | The Sequel | every weapon fires now at full charge, +1 shot each |
| PRISM | I Am the Hull | hullPatch 20, and every room back to 100 |
| Solace | Later | lastStand at 25 hull for 8 beats (once per fight), and haste ×2 for 4 beats |
| Harrow | A Better Angle | sureHit 3, and each hit also damages an adjacent room |
| Eclipse (Mythic) | Hunt Instinct | a Swarm drone volley: 3 shots × 5 damage through shields, and ignite their weapons room |
| ARCHON (Mythic) | Editing | hullPatch 15, shieldBurst, every room back to 100, and −1 enemy shield max for the fight |
| Voidwake (Apex) | Revoke Distance | rewind every enemy weapon to 0 and fully charge ours |

## 4. Threat and balance

- **Retire the 82% pull-up inside FTL fights.** The enemy loadout comes from the encounter, the sector and a
  *reference crew power for that point in the game*, not from your actual crew. A stronger crew then wins more
  instead of being matched.
- **Pre-fight odds come from the fight itself.** The contract card runs the real fight a few times (8 seeds,
  smart policy, Auto on) with your actual crew and ship, and shows "Win odds about 70%" plus the label. It is
  honest and updates when you swap crew.
- **Walls** keep fixed pools; with crew now mattering, retune the pools so the Veil wall falls inside 30 days for
  most simulated captains. Today no simulated captain broke it in 30 days.
- **Regenerate the evidence** (`test:balance`) and keep the free-play targets: day-7 and day-30 win rates,
  credits per day, walls broken.

## 5. Progression after the hire

- **Level cap by stars:** 1★ 10, 2★ 15, 3★ 20, 4★ 25, 5★ 30. Ascension raises it to 40, 50 and 60. This stops a
  maxed Common out-powering an Apex and gives duplicates purpose.
- **Duplicates never become pocket change:**
  - each copy up to 5★ adds a star (as today);
  - after that, copies become that merc's **shards**;
  - shards pay for **Ascension**: Veteran → Elite → Legend. Each step makes the ability stronger (charge −2
    beats or a bigger effect) and adds a portrait frame and aura.
- **The dossier** shows the kit, the quote and the bio (already written for all 46; never shown today) and the
  family.

## 6. Families (synergies)

The 23 faction tags fold into eight families (details in `docs/design/22-universe-proposal.md`). Two aboard
give a small bonus, four aboard a big one:

| Family | 2 aboard | 4 aboard |
|---|---|---|
| Haulers' Union | +10% fight salvage | +25% salvage, and +1 fuel back on a win (once a day) |
| The Yards | +15% repair speed | +30% repair, and abilities start 75% charged |
| Free Wings | +3% crit | +6% crit, and crits start fires |
| Remnant Navy | +10% shield recharge | +20% recharge, and 1 free shield layer at the start |
| Haven | +10% ability charge | +20% charge, and lastStand at 10 hull once per fight |
| The Survey | −5 enemy evasion | −10, and you see enemy aim 1 beat earlier |
| The Choirs | +15% ion effect | first enemy shield layer down at the start |
| The Unbound | +10% ability strength | +20%, and one random ability starts full |

The crew screen shows family badges and which bonuses are live.

## 7. Hiring (gacha)

- **Banners:**
  - *Open Channel* (standard, always on).
  - *Between Jobs* (featured): a 14-day rotation with one featured Legendary or Epic plus two rate-up Rares.
    When a pull lands on the featured rarity it is the featured merc half the time; a lost coin flip makes the
    next one at that rarity guaranteed featured.
  - Limited event mercs come later with seasons, and they rerun (fairness rule: nothing is permanently
    paid-only).
- **Contract Marks (spark):** every pull gives 1 mark. 200 marks hire the featured Legendary directly; 80 hire a
  featured Epic. At the end of a rotation, leftover marks carry over.
- **Odds shown in the game:** an odds screen per banner (the rates, including your current reputation and Luck
  boosts) and visible pity counters for Rare and Legendary.
- **Rarity inflation capped:** reputation and Luck together can lift Legendary-or-better to at most about 3% per
  pull (today it can reach about 29%), and Mythic plus Apex to at most about 0.6%. Base rates stay. Legendaries
  stay special.
- **The reveal:**
  - each pull is a docking pod;
  - its rarity colour shows as it lands: grey, green, blue, purple, gold, crimson, prismatic;
  - Legendary and above get a "priority transmission" sting and a full-screen portrait with the merc's quote;
  - a 10-pull ends on a 10-card results grid;
  - new mercs get a NEW tag, duplicates show the star or shards gained;
  - each rarity has its own sound (placeholder Kenney sounds until the music pass).
- **Where pulls run:** on the device for now, from a seeded per-player stream (no `Math.random`), so each result
  is reproducible and auditable. Server-run pulls would need a core change: game-core keeps the save on the
  client and only checks plausibility on the server (`docs/using-the-core/intended-use.md`). So they come with
  social features (leaderboards, guilds), as Garrett planned. Until then the server's economy anomaly checks
  watch gem balances against purchases and earn rates.

## 8. Build order inside Phase 1

1. **Engine:** fight crew carry `templateId` and `grade`; station mastery; real passives (crit and the rest); the
   ability effect library; ability charge and commands; the Auto policy; save validation; kits for all 50 as
   data. Tests for each effect, determinism, reload mid-fight, and validator rejection of edited ability state.
2. **Fight UI:** charge rings on the crew rail, tap to cast, a cast banner, effect visuals, barks, long-press
   cards, and the Auto toggle.
3. **Balance:** reference-power threat, simulated pre-fight odds, retuned wall pools; regenerate the evidence.
4. **Progression:** star level caps, shards, Ascension, and the dossier with kit and bio.
5. **Gacha:** banners and rotation (data-driven schedule), marks, the odds screen, the inflation cap, and the
   reveal plus 10-pull grid.
6. **Families:** synergy bonuses and badges.

Each step is merged with every suite green and phone-size screenshots. An independent review (a fresh-context
Claude reviewer; Codex isn't installed in this environment) checks steps 1, 3 and 5.
