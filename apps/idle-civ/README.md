# Idle Civilization — Camp → Hamlet

Portrait tracer for Checkpoint 4. Worker allocation → bottleneck → investment → growth, then the Founder Card. Commerce is off.

Config version: `economy-smoke-v0.2.0`. Save schema: `1`.

## Run

```bash
# from game-core repo root
pnpm install
pnpm -F @foundation/idle-civ test
pnpm -F @foundation/idle-civ dev   # http://localhost:5174  mock platform
```

Optional lab API (cloud save). Copy `apps/server/games/idle-civ/.env.example` to `apps/server/.env` with `GAME_ID=idle-civ`, then `pnpm db:up`, `pnpm migrate --up`, start the server.

The mock platform auto-starts a local camp if the cloud is unreachable.

## Tests

```bash
pnpm -F @foundation/idle-civ test
```

Covers starting invariants, the full playable path, Builder pause, Food recovery, 6h offline cap + prepaid Hut completion, Forager-card isolation, codec round-trip, and `onGap` progress purity. The ordered event trace is written to `test/corpus/playable-path-events.json`.

## Zustand

The engine (`idleCivEngine`) is the deterministic sim source of truth. `createIdleCivStore` is the only React-facing store: it mirrors published sim + overlays/toasts/selection. Components read `useIdleCiv(selector)` only.

## Explicitly out of this slice

Village onward, Crown/shop/USD, Blueprint Caches, random packs, Collection Rank, subscription, Finish Now, registration, research, Grain/Bread, military, final art.

## Known issues (Checkpoint 4)

- Placeholder CSS shapes, not final art.
- Founder’s Pack contents are authored, not rolled.
- Daily Supply Pack is a return promise, not a live entitlement backend.
- Lab server / Jest identity not required to play the mock tracer.
- Camp construction costs are the slice’s playable values loaded from versioned config, not later-stage smoke project sizes.
- No Playwright portrait suite yet; domain path is the automated acceptance.
