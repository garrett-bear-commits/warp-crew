# Testing and releasing a game integration

## Fast local loop

```bash
pnpm check          # includes pnpm test:scripts (the admin CLIs)
pnpm test:unit
pnpm test:model
```

## Database and browser proof

```bash
pnpm db:up
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55442/foundation_test pnpm test:pg
pnpm test:e2e
git diff --check
git archive HEAD | docker build -f apps/server/Dockerfile -
```

## Game-specific acceptance

A game is ready for Lab when it has:

- engine determinism and action-fuzz coverage;
- apply-only/step-only/mixed engine conformance where applicable;
- ordered save-corpus fixtures across every schema migration;
- round-trip, unknown-field, corrupt-save, and future-schema tests;
- server/client parity tests for public identifiers;
- model-based sync coverage with no counterexamples;
- browser coverage for blocked storage, beacon, resume, restore, multi-tab, generation change, and update-required;
- one end-to-end scenario for each enabled money/reward/live-ops feature;
- a clean production image build from committed files only.

## Lab gate

In Lab, verify platform identity, URL hosting, real receipt classification with minting off, storage behavior on
physical devices, Sentry redaction and alert rules, health paging, and load behavior (the k6 scripts
`scripts/load/sessions.js` and `scripts/load/save-race.js`, sized from the client's save cadence as in
[capacity](../capacity.md)). Enable PITR before player traffic and run the restore/erasure replay drill.

## Release versions

Every version value (the `x-build-version` header, readiness, analytics, Sentry release) is a bare `X.Y.Z`; a
pre-production build may carry a prerelease (`X.Y.Z-staging.<run>`), and git tags are `vX.Y.Z`.
`@foundation/contracts/versions` holds the patterns and `compareBuildVersions`, which ignores prerelease and
metadata, so a staging build counts as its release for `minBuildVersion`.

- The deploy writes a build record into the image, and `BUILD_INFO_FILE` points the server at it: JSON
  `{version, commit, env}`. It wins over `BUILD_VERSION`/`BUILD_COMMIT`. A placeholder record without a
  `version` falls back to them (local stacks); a missing file, invalid JSON or a version that is not `X.Y.Z`
  refuses to boot.
- With `GAME_ENV=prod` the build version must be a final release `X.Y.Z`, and an image that carries a build
  record must hold a production one (`env: "production"`): never the placeholder, never a staging build.
  `pnpm foundation preflight` checks the same.
- `/health/ready` reports `buildVersion` and `commit`; Sentry's release and the shipped logs carry them too.
  `players.first_build` (migration `0017`) records the build each player first announced.
- Never raise `minBuildVersion` above the lowest version hosted clients announce
  ([client-release-watch.md](../runbooks/client-release-watch.md)).

## Production configuration and observability

Optional API variables beyond the `.env.example` basics (`packages/server/src/config.ts`):

| Variable | Effect when set | Unset |
| --- | --- | --- |
| `GAME_CONFIG` | Names the `games/<id>/` rules while `GAME_ID` stays the exact token audience | `GAME_ID` names the rules |
| `PG_POOL` | Connections per API process (1-100) | 20 in prod, 8 elsewhere ([capacity](../capacity.md)) |
| `SENTRY_DSN` | Errors and sampled request/command spans to Sentry, environment `<GAME_ID>-<GAME_ENV>`, release = build version; boot log `sentry: true` | every hook is a no-op |
| `POSTHOG_LOGS_TOKEN`, `POSTHOG_LOGS_URL` | Ship pino logs to PostHog Logs over OTLP/HTTP (default endpoint `https://us.i.posthog.com/i/v1/logs`; https in prod) | stdout only |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Every admin request needs a valid Cloudflare Access token (both or neither) | no Access check |
| `TYPESAFE_API_KEY` | `names.check` asks Jev, Jest's notification moderation model | `names.check` answers `unchecked` |
| `BUILD_INFO_FILE`, `BUILD_COMMIT` | Build record and commit (see Release versions) | `BUILD_VERSION`, no commit |

What the API reports, with `SENTRY_DSN` set (`observability/sentry.ts`, `observability/process.ts`):

- 5xx and thrown errors with searchable tags `request_id` (the client's `x-request-id`, echoed as an error's
  `correlationId`), `route`, `method`, `status`, `code` and `build_version` (the client build that sent the request), plus the error's own fields and
  `cause` chain. Player keys are never tags (redaction shared with pino).
- Beyond 5xx: refused purchase verifications per reason (single and batch), unreadable saves with the decode or
  policy reason, requests the contract refuses (one issue per route), player tokens the signer could not have
  issued, Jev outages, refused leaderboard runs, an outbox delivery's first failure and every dead letter, job and
  job-runner failures, a failing live-ops refresh, and new economy anomalies.
- Uncaught exceptions are logged, flushed (Sentry and log shipping) and exit 1, so the host restarts the process;
  unhandled rejections are logged and reported, and the process stays up. Both handlers are installed with or
  without a DSN.
- The browser's `sentry-trace`/`baggage` headers continue its trace: the API's request span and events appear in
  the browser error's trace.
- The `ops.alert` job (5 min) sends `/health/ops` issues as `ops <tier>: <code>`, and hourly-or-slower jobs check in
  to Sentry Crons (`api-<job>`); alert rules are in [slo.md](../slo.md).

Log shipping (`observability/logship.ts`) applies the same redaction, strips IP addresses, and tags records with
`service.name=api`, `service.namespace=<GAME_ID>`, `deployment.environment.name=<GAME_ENV>`, `service.version` and
the commit. It batches every 2 s, one request at a time, holds at most 5,000 records (dropping beyond that and
saying so), never blocks a request, notes failures on stderr at most once a minute, and flushes on shutdown.

## Production gate

- migrations are at the expected head and N-1 compatibility is declared;
- the prior client remains contract-compatible;
- minimum build and content compatibility are intentional;
- premium minting has signed platform evidence and owner approval;
- kill switches and rollback commands are rehearsed;
- health, backup, Sentry (including the `ops.alert` Crons monitor), and fleet monitors are green;
- the API runs a production build record and reports its version and commit on `/health/ready`;
- the release manifest and runbook record the exact image, client build, contract, content, and schema versions.

Never convert an external gate into a passing local claim. Record the command, evidence, and remaining operator
action in `IMPLEMENTATION_STATUS.md`.
