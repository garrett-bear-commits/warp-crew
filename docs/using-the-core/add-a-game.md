# Add a game

Adding a game has two parts: configure the shared server and build the game client. The current scaffold creates
the server half; use `apps/template-game` as a reference for the client half.

## 1. Decide the game contract first

Write down:

- `gameId` and platform audience;
- the state type and action/effect unions;
- a monotone, safe-integer `progressOf` value;
- save schema version and migration fixtures;
- summary fields the server may read as claims;
- enabled features and their dependencies;
- catalog SKUs, board keys, reward types, and live flags;
- maximum plausible progress rate and hard economy ceilings.

## 2. Scaffold the server configuration

```bash
pnpm foundation new-server --game <id>
```

Review the generated files under `apps/server/games/<id>/`, then add the printed imports and registry entry to
`apps/server/src/games.ts`.

Configure `game.config.ts`:

- enable only features the client uses;
- define catalog packs and boards;
- set origins, retention, blob limits, token age, budgets, and known save schemas;
- keep premium purchase minting off until a real signed receipt is verified;
- define typed flags and in-bundle content defaults.

Implement `policy.ts`:

- cheaply validate the decoded save shape;
- derive the schema version from the blob rather than the request envelope;
- extract a small numeric summary;
- strip identifiers in `sanitizeForQa`;
- add plausibility and maximum-earned-premium hooks where relevant.

Add a policy conformance test containing current, old, malformed, future-schema, and QA-import fixtures.

## 3. Build the client application

Create `apps/<id>/` using `apps/template-game` as a reference. Replace, rather than merely rename:

- `engine.ts` — pure `apply`, optional `step/onGap/settle`, progress, and summary;
- `codec.ts` — numbered migrations and normalization;
- `config.ts` — build/platform inputs and public game identifiers;
- `game.tsx` — grant and purchase-adjustment mapping;
- panels and API clients for enabled features;
- an early disposable-session bootstrap using the core helper, with server-backed panels omitted in that mode;
- corpus fixtures, engine conformance tests, and browser flows.

The template renders every acceptance feature unconditionally. A production game should import and render only
the features enabled by its server configuration.

## 4. Prevent server/client drift

The current template keeps some public identifiers in both server and client code. Add a game-level parity test
for at least:

- catalog SKU and pack keys;
- leaderboard board keys;
- game ID and save schema version;
- grant reward kinds understood by the engine.

Prefer one shared, browser-safe game-definition module when the game architecture allows it. Never place secret,
server-only, or receipt-verification data in that module.

## 5. Validate feature composition

At minimum:

- achievements, daily rewards, placements, codes, and inbox-linked rewards require grants;
- purchases require the game's grant application path;
- segmented flags/schedules require live operations;
- QA routes are Lab-only;
- client panels and boot work must match enabled server features.

## 6. Prove the integration

Follow [Testing and releasing](testing-and-release.md), contribute ordered save fixtures, and take the game to Lab
using `docs/runbooks/new-game.md`. Keep production value minting disabled until platform receipt evidence and the
restore drill are complete.
