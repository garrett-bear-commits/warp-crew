# Warp Crew hand-off (2026-10-09)

Written for the next Claude account picking up Warp Crew. Start here, then [NEXT.md](NEXT.md) for the to-do list.

## State in one paragraph

Warp Crew is playable end to end in the browser: captain-first tutorial, contract board, FTL-lite real-time crew
fights, a sector map with authored events, Siege walls, timed drydock upgrades, a weapons armory, crew gacha,
away teams, offers, a subscription (mocked locally) and CC0 sound. It now lives on the owner's `game-core`
foundation: `main` contains the game in `apps/warpcrew/` and the core around it. Saves, sign-in and purchases
run through the core client and server (stages 1–3 of the port, all audited). Nothing is live: there are no
players, real-money minting is off, and the next step is a staging server plus a phone test inside Jest.

## 2026-10-09: the overhaul (read first)

After a deep dive Garrett approved a plan to make Warp Crew "AAA": [deep dive](design/21-deep-dive-2026-10-09.md),
[crew-matter design](superpowers/specs/2026-10-09-crew-matter-design.md), [universe proposal](design/22-universe-proposal.md),
[art mockup brief](art/2026-10-09-style-mockup-brief.md). Work is on `claude/blissful-ptolemy-wxopwr` (from `main`).

Built so far:
- Every merc has a signature move in fights, plus real passives and Auto.
- Hiring has a featured banner with a 50/50, Contract Marks, in-game odds, a rarity cap, seeded hires and a pod
  reveal.
- Level caps, shards and Ascension.
- Crew families (two or four aboard give a fight bonus).
- Music: four CC0 tracks, one per scene, with their own switch (`src/ui/music.js`, `src/data/musicManifest.js`,
  built by `scripts/build-music.mjs`).
- Art in style C (Garrett's pick): all 50 portraits and the Sparrow v5 hull ([mockup](art/2026-10-09-style-mockup-ledger.md),
  [art pass](art/2026-10-09-portrait-pass-ledger.md)). The ship's geometry lives in `src/data/art/sparrowV5Layout.json`,
  built by `scripts/measure-sparrow-v5.py`.
- The step-0 fixes.

The live checklist is in [NEXT.md](NEXT.md). Node 24 is needed (`/opt/nvm`: `nvm use 24` in cloud sessions).

## Branches and builds

| Ref | What |
|---|---|
| `main` | Everything: the game-core port merged 2026-10-09. Work here. |
| `claude/game-core-port` | The port branch (same as `main` at the merge). |
| `claude/hud-overhaul` | The pre-port game (plain repo layout). Frozen; kept for reference. |
| `gh-pages` | The published QA build: https://garrett-bear-commits.github.io/warp-crew/ (`?fresh=1` clears the browser save once). Its `build.txt` names the source commit. |

Other `claude/*` and `codex/*` branches are merged history.

## Run it

From the repo root:

```bash
corepack pnpm install
corepack pnpm -F @warpcrew/client dev        # game on http://localhost:5173, offline with mock purchases
corepack pnpm -F @warpcrew/client test       # plus test:loop, test:ship, test:first-play, test:balance
corepack pnpm check                          # core: format, lint, types, build, guards, unit tests
corepack pnpm db:up                          # Postgres 16 in container warpcrew-postgres on 55442
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55442/foundation_test corepack pnpm test:pg
```

`apps/warpcrew` is plain JS and is excluded from the core's ESLint/Prettier. The core server runs Warp Crew
with `GAME_CONFIG=warpcrew` (see `apps/server/games/warpcrew/.env.example`).

## Publish the QA build (approved by the owner)

1. `corepack pnpm -F @warpcrew/client build:pages` (output in `apps/warpcrew/dist`).
2. Check out `gh-pages` in a separate worktree, `rsync -a --delete --exclude .git --exclude build.txt
   apps/warpcrew/dist/ <gh-pages worktree>/`.
3. Update `build.txt` there (date, `Source: <branch>@<full sha>`, one-line scope), commit, push. Pages deploys
   in about a minute; confirm `https://garrett-bear-commits.github.io/warp-crew/build.txt` shows the new source.

The existing Jest staging version hosts this Pages URL, so a Pages publish also updates the Jest staging preview
(still mock purchases: the Pages build has no server configured).

## What is next (stage 4 of the port)

Owner's parts are marked; never handle secrets yourself.

1. **Owner:** create the 12 products on the *staging* Jest game from [jest-console-products.md](jest-console-products.md).
2. **Owner:** create a Railway staging service for `apps/server` (Dockerfile in `apps/server`), fresh Postgres,
   `GAME_CONFIG=warpcrew`, `GAME_ID=<staging Jest game id>`, and paste `JEST_PLAYER_SECRET` there.
3. **Owner decision (recommended yes):** `purchases.mintSandbox: 'on'` on staging only, so sandbox purchases grant.
4. **Claude:** a startup guard refusing sandbox minting in production; build the client with
   `VITE_WARPCREW_SERVER=<staging URL>`; a short phone test script for the owner.
5. **Owner:** phone session inside Jest staging (sign in, reload, second device, gem pack, starter kit twice,
   subscription trial start/cancel). Confirms Jest receipts carry `price`/`currency` and subscription lists `iat`.
6. Then delete `apps/warpcrew/server` (the legacy save server) and point QA builds at the core server.
7. Real-money sales (`mintPremium: 'on'`) only at launch, with the owner's approval.

## Open items outside the port

- The owner still has to listen to the sounds and play the QA build on a phone (fights, armory, crew drag,
  Explore nudge). Their feedback drives the next design work.
- Balance: ambitious simulated captains earn ~48% of credits from Explore; simulated captains don't buy weapons
  yet; weapon prices (650/800/950) are first guesses.
- Not built: `wc_drydock_2`, welcome-back bundle, sale SKUs, client-side refund handling, named engine actions for
  hiring/hangar (they go through a generic `set` action today), notifications through the core.
- Known gap: if a tab loses leadership between claiming a purchase grant and applying it, support must re-grant
  (logged loudly).
- `main`'s CI is game-core's workflow (`.github/workflows/ci.yml`): core checks, pg tests, template-game browser
  tests. It does not yet run the Warp Crew suites beyond what `pnpm check` runs.

## Where the knowledge is

- Port plan and every stage's details: [game-core-port.md](game-core-port.md); core docs in `/docs` (architecture,
  ADRs incl. ADR-035 for bundles/one-time packs/subscriptions, runbooks, `using-the-core/`).
- Designs and plans: [superpowers/specs/](superpowers/specs/) (FTL-lite combat, sector map and events, combat
  walls/retention, monetization plan, captain-first play, living ship) and [superpowers/plans/](superpowers/plans/).
- QA records and balance evidence: [qa/](qa/) (the balance evidence markdown and 30-day economy JSON are generated).
- Audits: [audits/](audits/) (Codex/Luna and earlier audits, each with the fixing commit).
- Art: [art/](art/) (Sparrow v4 brief and layout QA, enemy families, reference images). The Sparrow v4 room/door/
  blocker geometry is `src/data/art/sparrowV4Layout.json`, measured from the pixels.
- Sound: `public/audio/` (Kenney CC0, licence in `public/audio/LICENSE.md`), manifest `src/data/sfxManifest.js`,
  rebuild with `node scripts/build-audio.mjs <folder with the three kenney_* packs>` (Kenney Sci-Fi, Impact and
  Interface Sounds from kenney.nl).
- Previous Claude's memory notes: [handoff/claude-memory/](handoff/claude-memory/).
