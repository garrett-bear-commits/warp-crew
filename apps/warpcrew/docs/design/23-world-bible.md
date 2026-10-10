# Warp Crew world bible (2026-10-10)

The canon for Phase 3 and after. It adopts the [universe proposal](22-universe-proposal.md) (Garrett, 2026-10-10:
"feel free to rewrite and improve everything") and fixes the names. Game data is the source of truth for wording:
- the campaign script: `src/data/campaign.js`;
- speakers and clients: `src/data/speakers.js`;
- enemy factions: `src/data/factions.js`.

## The frontier in one paragraph

Faster-than-light travel only works along the **Lanes**, ancient corridors between the stars. The **Lane Compact**
mapped them, gated them and got rich on them. Fifty years ago its core worlds went quiet: no war, no message. That
was **the Hush**. The navy pulled back to guard what was left, and the frontier arm, **the Spur**, was left to its
haulers, clinics, scrapyards and pirates.

Now the **Eclipse Swarm**, a bio-machine ecology that nests in jump wakes, is waking up along the lanes. You own
the **Sparrow**, a cheap ship with a bad history. Her last captain vanished mid-jump, and her black box talks in
your voice.

## The secret (revealed one piece per chapter, never all at once)

- The lanes were not built. They were **grown**, by something that sleeps beyond the Null Meridian.
- The Swarm is its immune system: it keeps the lanes clean, and it **keeps what it eats**. Ships, crews and voices
  come back regrown, slightly wrong.
- The Compact core did not fall. It was swallowed into a lane, where time runs strangely.
- Wren Halloway, the Sparrow's last captain, went looking. Her log is in your voice because, somewhere down the lane,
  it is.

## Voice

**Tone:** dangerous, funny, strange.
- Firefly's working crew, FTL's desperate fights, Cowboy Bebop's bounties.
- Never grimdark, never slapstick.
- Short sentences, concrete nouns, dry jokes. People out here are tired, practical and kind when it is cheap.

**Rules for every line players read:**
- **Transmissions:** at most 30 words a panel, at most 4 panels. One idea a panel.
- **No developer words** (`test/player_copy.test.mjs` lints them).
- **Numbers as words** in story lines ("thirty-five seconds"), except prices and rewards.
- **The Choir speaks in lower case**, without names, in short fragments. It reads your hull ID backwards.
- **Black-box lines** start and end with "...".
- **Jokes come from specifics:** "Moro once fined his own mother", not "Moro is strict".
- **The captain** (the player) says little: a short question or a dry reply.

## Tokens in story text

- `{ship}`: the ship's name.
- `{captain}`: the captain's name.
- `{hullid}`: the Sparrow's hull ID, e.g. `WC-0417`, from the save seed.
- `{hullidrev}`: the hull ID reversed, `7140-CW`.

## The recurring cast (portraits in `public/art/pixel/cast/`)

| Id | Name | Who | Look (for art) |
|---|---|---|---|
| `vell` | **Auntie Vell** | Runs the Exchange at Spur Anchor, the frontier's job board. Takes a tenth of every job. Warm and mercenary. "Everyone pays. Some of you pay in installments." | Middle-aged Tidefall: translucent blue-green bubble-textured skin, four arms (tea, stamp, datapad, pen), gold hoop jewellery, cosy cluttered office |
| `crane` | **Silas Crane** | Bounty hunter, ship the *Gilded Hound*. Gets every bounty in the Spur. A rival in chapter 1, an ally in chapter 2. Smug, competent, keeps a code. | Lean man in his forties, long dark coat with gold trim, slicked silver hair, scar through one eyebrow, half smile, a gold hound pin |
| `tarrow` | **Commodore Ines Tarrow** | The last Compact officer in the Spur. Holds the gates with one frigate. Lost her sister ship, the *Constant*, in the Hush. Exacting, tired, fair. | Woman in her sixties, dark skin, close-cropped white hair, immaculate faded navy uniform with gold braid, a tin cup of tea |
| `choir` | **The Choir** | The Swarm's voice. Never shows a face. | No face: a ring of violet bioluminescent spores and static, like an eye or a mouth, on black |
| `wren` | **Captain Wren Halloway** | The Sparrow's last captain. Vanished mid-jump in the Veil. Speaks through the black box (`blackbox`). | Woman in her thirties, worn Sparrow flight jacket, goggles pushed up, crooked grin, a faint glitch |

**Other speakers:**
- `captain`: the player's captain portrait.
- `blackbox`: Wren's portrait with static.
- `stowaway`: "???", a blur (Wisp, before chapter 2 ends).
- Any merc by template id.
- The two chapter bosses, by their ship art.

## Clients (the contract generator; portraits in `public/art/pixel/clients/`)

Each client belongs to a family, so the board reads as the frontier's factions asking for help.

| Id | Name | Family | Sectors | Voice | Look |
|---|---|---|---|---|---|
| `fenn` | Moro Fenn, Haulers' Union dispatcher | haulers | all | Tired, fair, fines everyone | Heavy-set man in his sixties, grey stubble, headset, union jacket covered in patches, chipped mug |
| `ledgers` | The Ledger Sisters, Kestrel Market | haulers | spur, veil | Twins who finish each other's sentences, haggle by reflex | Two identical sharp-eyed women in matching striped scarves, one with an abacus, one with a datapad |
| `sato` | Dr. Imani Sato, Hope's Rest clinic | haven | spur | Brisk, kind, out of patience with pirates | Woman in her forties, scrubs under an armoured vest, braided hair, tired kind eyes |
| `grudge` | Foreman Grudge, the Yards | yards | all | Counts everything, approves of nothing | Boxy rust-orange droid, hard hat welded on, one cracked optic, a clipboard for a hand |
| `bask` | Lieutenant Oye Bask, gate patrol | navy | spur, veil | Earnest, by the book, the book is out of date | Young officer in a Compact uniform a size too big, cap askew, a thick rule book |
| `ossory` | Madame Ossory, Free Wings broker | wings | all | Elegant, amused, never says "smuggling" | Tall grey-violet alien, ornate swept headdress, long cigarette holder, many rings |
| `quist` | Surveyor Lio Quist, the Survey | survey | all | Excitable, says "fascinating" about dangerous things | Small amphibian alien, huge brass goggles, antennae, arms full of rolled star charts |
| `ulama` | Ul-Ama, Tidefall broker | choirs | veil, hollow | Speaks as "we", calm, a little ominous | Tall translucent Tidefall, bubble skin glowing softly, shell jewellery, eyes like moons |
| `nobody` | Nobody | unbound | veil, hollow, crown | No registry, pays in advance, never explains | Hooded figure whose face is a dark screen with one line of static |
| `sallow` | Mother Sallow, Veil Haven | haven | veil | Gentle, unshockable, pays in soup | Elderly woman, shaved head, white robe over a flight suit, a fire extinguisher for a cane |
| `ash` | Torvald Ash, Ember foundry | yards | ember, hollow, crown | Cheerful about terrible working conditions | Huge bearded man with burn scars, welding goggles, leather apron, too-wide smile |

Auntie Vell is a client too (all sectors, any job).

## Enemy factions

| Faction | Who they are | In a fight |
|---|---|---|
| **Corsairs** | The Corsair King's raiders. They tax the Veil Gate and anyone slow. | Missiles through your shields; their aces board |
| **Scrappers** | Belt and Ember scrap gangs who take ships apart while they are still flying. | Boarders |
| **The Swarm** | Probes, broods and frigates grown in jump wakes. | Drone volleys that strip shields; hulls that regrow unless burning |
| **Ice Raiders** | White-hulled corsairs from the Glass Spur. | Ion hits that freeze your rooms; boarders |
| **Shades** | Ships lost in the Veil that came back wrong, crews and all. | Cloaking |
| **Wardens** | Compact automated warships still taking orders from an empty throne. | Shield harmonics |
| **The Eclipse** | Swarm forms that learned. | Cloak and regrowth |

## The main story: "The Long Jump"

The script is in `src/data/campaign.js`.

1. **Cheap Ship, Bad History** (the Spur).
   - Vell's first job, then a freighter called Big Mabel and Silas Crane's stolen bounty.
   - Hope's Rest's singing static, then Commodore Tarrow's terms.
   - The boss is the Corsair King at the Veil Gate.
   - Kal Vesper, the customs pilot the King framed, joins.
2. **The Veil** (Veil Edge).
   - Wraiths that cloak, then the last clinic's hospital ship, then Wren's buoy: "the lanes aren't roads, they're
     roots".
   - Crane in debt to you, then the Choir: "we keep what we eat".
   - The boss is the *Constant*, Tarrow's sister ship, regrown by the Swarm at the Swarm Scar.
   - Wisp, who has been in your vents since the Gate, joins.
3. **Ember Reach** (next): the Forge Moon, the Ash Ledger, someone building warships in the dark.
4. **Hollow Expanse:** comms go polite; the crypt plays your voice from a war you have not fought yet.
5. **Crown Halo:** the Throne, a swallowed Compact flagship whose AI still gives orders from an empty chair. You
   win, and the lane beyond the unfinished gate looks back.

After the story, the Null Meridian becomes **the Rift** (Phase 4), the endless frontier.
