# Disposable save sessions

A disposable save session lets an authorised operator open a retained player snapshot in the real game UI,
try actions, and close the window without changing either the player's save or the operator's own game. It is
for reproducing support issues and exploring a historical state. It is not a restore, impersonation token, or
way to publish a branch of play.

## Operator workflow

1. Serve both the inspector and game over their normal HTTPS origins. `file:` pages are refused because they
   have no trustworthy origin.
2. In **Setup**, connect the inspector and enter the absolute game client URL.
3. Find the player and choose **Play incognito** beside a retained save. For an older sequence that is not in
   the first history page, use the manual player/sequence launcher in **Save safety**.
4. Confirm the persistent banner in the game window names the player, sequence, and generation.
5. Reproduce the issue, then choose **Discard & close** or close the window.

Only snapshots whose blobs are still retained can be opened. A pruned blob is intentionally unavailable; the
operator must choose another sequence. "Any point" therefore means any retained save sequence, not arbitrary
reconstruction between snapshots.

## Isolation contract

Disposable mode is detected before the game probes browser storage or starts its real platform adapter. The
inspector opens a one-use popup and transfers the snapshot only after an exact-origin, exact-window,
cryptographically random session handshake. The URL fragment contains only the protocol marker, session ID,
and inspector origin. It never contains a player key, save blob, API origin, token, or admin credential.

The game then:

- validates and migrates the blob through its normal `SaveCodec`;
- seeds a synthetic player slot backed only by a fresh in-memory `StorageLike`;
- disables sync, KV mirroring, journals, beacons, persistence requests, cross-tab channels, and locks;
- installs a fail-closed fetch implementation and does not construct game-side network clients;
- uses a standalone/no-op platform, so analytics, payments, notifications, and provider identity are not used;
- keeps the real player key only as escaped banner metadata;
- drops the opener relationship after acknowledging a successful load.

Actions may change the popup's in-memory state. `saveNow`, visibility changes, page hide, errors, and timers
must still be unable to contact the API or durable browser storage. Closing the popup makes the branch
unrecoverable by design.

## Integrating a game

Use the browser-safe helpers exported by `@foundation/client` before normal configuration or platform setup:

1. Read the disposable request from `location.hash`.
2. Render a waiting/error state while `waitForIncognitoSnapshot` completes.
3. Pass the received snapshot, game codec, and `engine.progressOf` to `seedIncognitoSnapshot`.
4. Build a standalone platform for the returned synthetic player.
5. Spread `incognitoClientOptions(session)` into `createGameClient`.
6. Do not construct the game's normal API clients or render server-backed controls in this branch.
7. After `client.boot()`, acknowledge the load and render an always-visible discard banner.

`apps/idle-civ/src/main.tsx` is the reference composition root. Keep this path covered by a test that mutates
the disposable state and proves the source blob, normal local storage, network, beacon, and persistence APIs
were untouched.

## Limits

- The snapshot contains canonical game state, not the local envelope's RNG stream. The starting state is exact,
  but future random outcomes may differ from the player's original branch.
- Server-backed panels such as purchases, grants, leaderboards, inbox, live-config writes, and restore are not
  part of disposable play. Hide them or provide a deliberately read-only fixture facade.
- Do not add a "keep" or "publish" action. Turning an exploratory branch into player state would be a separate,
  audited restore/import design.
