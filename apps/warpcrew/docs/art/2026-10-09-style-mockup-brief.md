# Art brief: style mockup (one portrait, one ship), 2026-10-09

Status: approved by Garrett 2026-10-09 ("a mockup of one ship and one portrait first"). Generate with Garrett's
**personal** Flora account (never the textclub account). Model: GPT Image 2.5 at low resolution.

## Goal

Set the single art style every Warp Crew asset will move to: **really high-quality, stylized retro pixel art**.
Today two styles clash: painted HD pixel art (splash, captains) next to flat pixel art (Bolt, Tink). The mockup
is a style target, not production art: Garrett picks a direction, and later batches match it.

## What "stylized retro pixel art" means here

- **A visible, consistent pixel grid.** A portrait reads as about 96–128 art pixels across; a ship cutaway as
  about 256–384 art pixels wide. Hard-edged clusters, no blur, no soft airbrush, no photo texture.
- **A limited palette** of about 32–48 colours per image, with hue-shifted ramps: shadows go violet or blue,
  highlights go warm. No muddy greys.
- **Stylized, not realistic:** strong silhouettes, slightly exaggerated proportions, readable expressions,
  personality in props and pose.
- **One light story** (from the 2026-09-23 style bible): a warm amber key light, a cool cyan rim light, deep
  violet shadow, cyan instruments and amber hazard trim.
- **Mood:** worn, lived-in mercenary sci-fi, dangerous and funny. Not grimdark, not cartoon slapstick.
- **References in the repo:** the splash (`public/art/pixel/vertical-slice/splash-five-crew-v3.png`), the captain portraits
  (`docs/art/outputs/captain-*-generated-v1.png`) and the Sparrow v4 (`public/art/ships/v4/sparrow-v4.png`).

## Subject 1: portrait of Kira Nyx (Uncommon gunner)

Kira is an early recruit most players meet, so she sets the bar for the roster. From `src/data/crewRoster.js`:
*"Privateer gunner with a short fuse." Quote: "Short fuse. Long burst." She left a corsair wing after they
started tagging colony boats and still paints her turrets like a warning.*

She must look different from the existing human captain portrait (black hair with red streaks, red jacket).

## Subject 2: the Sparrow cutaway (the player's ship)

Keep the topology the code uses (`src/data/art/sparrowV4Layout.json`):
- a vertical ship, nose up, four engine nozzles at the bottom, and one straight central corridor;
- the bridge at the nose; shields | weapons; sensors | medbay; quarters | mess; cargo | armory; engineering
  across the stern.

The mockup does not need exact room rectangles; production art is re-measured later.

## Prompts

Common suffix for both subjects (append to every prompt):

> High-quality stylized retro pixel art: crisp hard-edged pixel clusters on one consistent pixel grid, no blur, no
> anti-aliasing, no painterly smoothing, limited palette of about 40 colours with hue-shifted shading ramps
> (violet shadows, warm highlights). Plain flat dark navy background (#0b1220). No text, no letters, no labels, no
> logo, no frame, no UI.

**Portrait base (1024×1024):**

> Pixel art bust portrait, three-quarter view, of Kira Nyx, a human privateer gunner in her late twenties for a
> space mercenary game. Sharp jaw, confident lopsided grin, short undercut hair bleached and dyed signal-orange on
> top, three small hazard-chevron tattoos under her left eye in the same orange. A scuffed ear-defender headset
> around her neck, a padded flak vest stencilled with yellow-and-black warning stripes over a dark navy flight
> suit, one fingerless gunner's glove. Warm amber key light from the left, cool cyan rim light from the right, deep
> violet shadows. Expressive and characterful, stylized proportions, not photoreal. Head and shoulders fill the
> frame, centred.

**Ship base (1024×1536):**

> Pixel art top-down orthographic cutaway of a small mercenary starship called the Sparrow, viewed straight down
> with the roof removed so every room interior is visible, like FTL, for a mobile space crew game. Vertical ship,
> nose at the top, four engine nozzles at the bottom. One straight central corridor runs from nose to stern with
> rooms on both sides, each with a door onto the corridor. At the nose, a bridge with a pilot seat and curved
> consoles. Then a shield generator room with a glowing blue core beside a weapons room with missile racks and a
> gunnery console. Then a sensors room with a holographic scanner table beside a medbay with a bed and cabinet.
> Then crew quarters with bunks beside a mess with a table and galley. Then cargo with crates and a lift beside an
> armory with weapon lockers. At the stern, an engineering room across both sides with a reactor and repair
> benches. Worn gunmetal and charcoal hull plating, orange and amber hazard trim, teal and cyan console screens,
> warm interior lights, small readable props. Each room is recognizable by its props and floor colour. Empty of
> people.

**Direction variants** (add one line to the base prompt):

| Variant | Line | Intent |
|---|---|---|
| A. HD pixel | "In the style of modern HD pixel-art games like Sea of Stars and Eastward: clean readable clusters, bold silhouette, rich but controlled detail." | The likely winner: premium and readable on a phone |
| B. Painted pixel | "Dense, painterly pixel art with dithered texture and dramatic lighting, like premium pixel-art key art." | Closest to today's splash and captains, refined |
| C. Bold arcade | "Bold chunky pixel art at a low art resolution, strong dark outline, punchy saturated palette, arcade-era energy." | The most retro; shows the other end of the range |

## Generation plan and cap

- **Round 1:** variants A, B and C for each subject = **6 images**. Stop and show Garrett a contact sheet (raw
  output plus a grid-snapped clean-up of each).
- **Round 2 (only after Garrett picks):** up to 2 refinements per subject in the chosen direction = **4 images**.
- **Cap: 10 images and about $5** of the $13 balance. Stop and ask before going past either.
- Never rerun an identical prompt. After a timeout, check Flora for the earlier run before retrying (rule from
  `docs/NEXT.md`).

## Clean-up (local, free)

- Snap to the grid: estimate the art-pixel size, downscale with nearest-neighbour, quantize to the palette
  (about 40 colours), upscale with nearest-neighbour. Show raw and snapped side by side.
- Background to true alpha: key the flat navy (#0b1220) out, so no magenta-style accident
  (`scripts/key-portrait-magenta.py` is the template).
- A free extra: composite the chosen ship into the current hub HUD (a screenshot at 390×844) so Garrett sees it
  in context.

## Ledger (fill in for every generation)

Write each one to `docs/art/2026-10-09-style-mockup-ledger.md`: prompt (or variant id), model and parameters,
reference images, Flora run id, output file name, cost, disposition (kept, rejected, why). Save outputs in
`docs/art/outputs/mockup-2026-10-09/`.

## Flora mechanics (for the session that runs this)

- Connector: Flora MCP at `https://agents.flora.ai/mcp`, added at claude.ai/customize/connectors with Garrett's
  personal account. A new session is needed after adding it.
- Calls go through `mcp__Flora__execute` with `client.generations.create({ type: 'image', model, prompt,
  workspace_id, project_id, params })`, then poll `client.generations.retrieve(run_id)`. Discover the exact GPT
  Image 2.5 model id and its size and quality parameters first (list models), and confirm the account is the
  personal one (list workspaces) before generating.
- Outputs are served from `media.flora.ai`, which cloud sessions block unless it is added to the environment's
  allowed domains. Without it, the images can't be downloaded here.
