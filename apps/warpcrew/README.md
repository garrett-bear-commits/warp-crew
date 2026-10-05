# Warp Crew: Idle Starship

Idle space crew & starship game for [Jest.com](https://jest.com) — Boglight Games.

## Quick start
```bash
cd ~/warp-crew
pnpm install
pnpm dev
pnpm test
```

Open the URL Vite prints (usually http://localhost:5173).

## What’s playable
- **SHIP** — hull/shield bars, schematic, claim fuel, expand quarters  
- **MISSIONS** — 15-minute test expeditions + fuel travel  
- **CREW** — gacha hire, medal level-ups  
- **SHOP** — QA stubs for packs  
- **LOG** — session log  

## Test settings
- Expedition duration: **15 minutes** (`TEST_EXPEDITION_MINUTES` in `src/systems/expedition.js`)  
- Launch target: 360 minutes (6h)

## Docs
See `docs/` — start with `01-concept.md` and `10-build-status.md`.


## Phase status
- **A** Map travel, combat assists, gem skip, login streak  
- **B** Jest SDK, IAP, notification ladder  
- **C** Content expansion, hangar/Corvette, soft-launch docs  

```bash
pnpm install && pnpm test && pnpm dev
```

## QA / GitHub Pages

Jest + simulator QA host (static build on `gh-pages`):

- **Play:** https://garrett-bear-commits.github.io/warp-crew/
- **QA Hub:** https://garrett-bear-commits.github.io/warp-crew/qa.html
- **Fresh save:** https://garrett-bear-commits.github.io/warp-crew/?fresh=1

Pages source: `gh-pages` branch / root. Redeploy by asking Grok to push, or:

```bash
npm install
npx vite build
# then copy dist/ onto the gh-pages branch
```

See [docs/16-github-pages-qa.md](docs/16-github-pages-qa.md).
