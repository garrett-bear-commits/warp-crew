# Admin inspector

The admin inspector is a static, phone-friendly operator console served on a separate origin. It stores
credentials in memory only and renders untrusted player data with DOM text nodes. It can also launch a retained
save in the game client's isolated, disposable mode.

## Start it locally

```bash
pnpm -F @foundation/app-server build
```

Start the API as described in the root README. The inspector listens on `ADMIN_PORT` (default `8081`) when its
built assets are present, and that origin forwards `/admin/v1/*` (only) to the API, so the API origin is always the
page's own origin. Signed out, it shows only a sign-in card: enter the admin key ID and secret, which it verifies
with `GET /admin/v1/session` before showing anything else. The inspector must be served over HTTPS, or localhost
HTTP for development, and not opened as a `file:` URL.

Two optional values are baked in at build time: `VITE_GAME_CLIENT_URL`, the game **Play incognito** opens (default
`http://localhost:5173`), and `VITE_ADMIN_PRODUCTION_HOSTS`, the admin hosts badged Production. Point
`admin-inspector/src/game-grants.ts` at the game's `games/<id>/grants.ts` so grant forms offer exactly the rewards
the game applies. Hosting the admin origin, keys and Cloudflare Access: [the runbook](../runbooks/admin-inspector.md).

## Scope model

Use separate keys for separate responsibilities:

- `read` — player overview, timeline, saves, actions, and dead letters;
- `support` — letters, player flags, and outbox replay;
- `grant` — grants, cohort compensation, purchase adjustments;
- `publish` — flags, content, schedules, segments, kill switches, and minimum build;
- `restore` — save review, restore, and projection rebuild;
- `erase` — player erasure.

Do not give a routine support key publish, restore, or erase authority. The inspector shows only the workspaces
and actions the signed-in key's scopes allow (`admin-inspector/src/scopes.ts`).

## Current UI coverage

The page supports sign-in, player inspection, save/blob viewing, letters, grants (reward fields from the game's
grant vocabulary, plus raw JSON), purchase fixes (credit, refund, correction), cohort dry-runs, flag and content
publication, disposable play from a retained save, restore, quarantine review, player flags, admin-action review,
and dead-letter replay. Every write shows a confirmation of what it will do first.

The server also exposes admin APIs for schedules, segments and previews, content revert, kill switches, and
minimum build. Use the relevant runbook/API until those controls receive dedicated forms.

## Safe operation

1. Prefer Lab and read-only inspection first.
2. Use dry-run for cohort operations.
3. Give every write a specific reason and ticket reference where available.
4. Keep the generated command ID when retrying an ambiguous network/5xx result.
5. Verify the player generation before restore.
6. Confirm live behavior and health after publish, grant, restore, or replay.
7. Use a new command for a changed payload.

## Disposable play

Choose **Play incognito** on a retained save in the **Saves** tab (**Load older saves** reaches older ones).
The new game window starts from that snapshot using memory-only storage and no network-capable game client. Its
persistent banner is the proof that you are not in the player's or your own normal session. Close the window to
discard the branch. A save marked as pruned cannot be opened.

The game client URL must be HTTPS, except that localhost HTTP is accepted for development. Admin credentials
stay in the inspector and are never sent to the game window; the inspector's own origin is refused as the game URL.
See [Disposable save sessions](disposable-save-sessions.md)
for the handshake and game-integration contract.

The inspector is not a substitute for the restore, erasure, migration, or launch runbooks.
