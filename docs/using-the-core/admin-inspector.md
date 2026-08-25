# Admin inspector

The admin inspector is a static, phone-friendly operator console served on a separate origin. It stores
credentials in memory only and renders untrusted player data with DOM text nodes.

## Start it locally

```bash
pnpm -F @foundation/app-server build
```

Start the API as described in the root README. The inspector listens on `ADMIN_PORT` (default `8081`) when its
built assets are present. Enter the API origin, admin key ID, and secret in the connection card.

## Scope model

Use separate keys for separate responsibilities:

- `read` — player overview, timeline, saves, actions, and dead letters;
- `support` — letters, player flags, and outbox replay;
- `grant` — grants, cohort compensation, purchase adjustments;
- `publish` — flags, content, schedules, segments, kill switches, and minimum build;
- `restore` — save review, restore, and projection rebuild;
- `erase` — player erasure.

Do not give a routine support key publish, restore, or erase authority.

## Current UI coverage

The page supports connection, player inspection, save/blob viewing, letters, grants, cohort dry-runs, flag and
content publication, restore, quarantine review, player flags, admin-action review, and dead-letter replay.

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

The inspector is not a substitute for the restore, erasure, migration, or launch runbooks.
