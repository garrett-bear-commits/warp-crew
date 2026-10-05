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

`GAME_ID` is the exact signed platform audience (a Jest game id may be a UUID, and staging and production may be
separate platform games); `GAME_CONFIG` names the `games/<id>/` entry that supplies the rules. Without
`GAME_CONFIG`, `GAME_ID` names the rules as before, so one rule set can serve several platform games
(`apps/server/src/games.ts selectGame`).

Configure `game.config.ts`:

- enable only features the client uses;
- define catalog packs and boards;
- set origins, retention, blob limits, token age, budgets, and known save schemas;
- keep premium purchase minting off until a real signed receipt is verified; `purchases.mintSandbox` (default off)
  additionally delivers signed sandbox receipts and needs its own owner approval (ADR-024);
- turn on `features.daily` to take daily claims without the achievements evaluator (`achievements` also enables
  them); the `daily_rewards` document picks `cadence` (`utc_day` or `rolling_24h`) and an optional
  `minProgress`;
- define typed flags and in-bundle content defaults.

Implement `policy.ts`:

- cheaply validate the decoded save shape;
- derive the schema version from the blob rather than the request envelope;
- extract a small numeric summary;
- strip identifiers in `sanitizeForQa`;
- add plausibility and maximum-earned-premium hooks where relevant;
- declare `anomalyKeys` when the summary also carries analytics scalars (timestamps, lifetime counters): the
  nightly economy anomaly job then z-scores only those keys instead of every numeric summary key;
- set `grantRewardProblem` from the game's grant vocabulary (below).

Declare the grant vocabulary in `games/<id>/grants.ts` (`apps/server/games/grant-vocabulary.ts`): the rewards the
client actually applies, each an amount field (`premium_currency`, a `soft_currency`, or an `item`) or a choice
among fixed items, with a per-grant maximum, plus the name of the premium currency. Wire it into the policy with
`grantRewardProblem: (rewards) => grantProblem(<id>Grants, rewards)` so admin and cohort grants outside it are
refused at mint time (`validation_failed`), and point `apps/server/admin-inspector/src/game-grants.ts` at it so the
inspector builds its reward fields from the same list. `apps/server/games/template/grants.ts` is the example.

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

Client runtime seams worth wiring from the start:

- **Saves.** Ask for routine saves through `client.sync.requestSave('routine')`: the device slot is written at
  most every `localSaveMs` (default 5 s) and the cloud at most every `routinePushMs` (default 12 s), leading and
  trailing so the newest state always goes. Use `'immediate'` (or `saveNow`) for changes a player must never lose
  (purchases, restores, milestones). A push is abandoned after `pushTimeoutMs` (default 10 s); network errors,
  timeouts and 5xx back off from 4 s to 60 s with jitter. Boot waits at most `bootRepushMs` (default 3 s) on the
  re-push of the last unacked snapshot before going live; the push continues in the background.
- **Damaged local saves.** Only a local slot written by a newer build blocks boot (it is preserved and
  progression stops until a capable client loads). Any other unreadable slot is copied aside under
  `damagedSlotKey(gameId, playerId)`, reported through the error sink, and treated as absent, so the server copy
  decides.
- **Error tracking.** `onError` receives every `reportError` with the original error (send it to a browser
  error tracker); `traceHeaders` adds the tracker's `sentry-trace`/`baggage` to every API call so the API's events
  join the browser's trace. Every call also sends a fresh `x-request-id`, which the API tags as `request_id`; a
  failed call returns it even without a response envelope.
- **Screenshots.** `platform.screenshots.setProvider(source)` answers platform-requested captures (Jest's footer
  camera button) with a base64 PNG; `null` restores the platform default, and `available()` says whether the
  platform supports it.
- **Player-typed names.** Screen a name with `POST /v1/names/check` (`namesClient` in
  `@foundation/server/features/names/client`) before the game shows it or puts it in notification copy. The
  verdict is `pass`, `fail` or `unchecked` (no `TYPESAFE_API_KEY`, or Jev unavailable); the game decides what
  `unchecked` means.

The template renders every acceptance feature unconditionally. A production game should import and render only
the features enabled by its server configuration.

## 4. Prevent server/client drift

The current template keeps some public identifiers in both server and client code. Add a game-level parity test
for at least:

- catalog SKU and pack keys;
- leaderboard board keys;
- game ID and save schema version;
- grant reward kinds understood by the engine (the client's grant application must cover exactly
  `games/<id>/grants.ts`).

Prefer one shared, browser-safe game-definition module when the game architecture allows it. Never place secret,
server-only, or receipt-verification data in that module.

## 5. Validate feature composition

At minimum:

- achievements, daily rewards (`achievements` or `daily`), placements, codes, and inbox-linked rewards require
  grants;
- purchases require the game's grant application path;
- segmented flags/schedules require live operations;
- QA routes are Lab-only;
- client panels and boot work must match enabled server features.

## 6. Prove the integration

Follow [Testing and releasing](testing-and-release.md), contribute ordered save fixtures, and take the game to Lab
using `docs/runbooks/new-game.md`. Keep production value minting disabled until platform receipt evidence and the
restore drill are complete.
