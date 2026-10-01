# Game Foundation v1

The reusable core (server + web adapter + contracts + tooling) described in
[`docs/architecture-v1.md`](docs/architecture-v1.md) (authoritative, verbatim). Status and evidence:
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md), requirement → implementation → tests:
[`docs/coverage-matrix.md`](docs/coverage-matrix.md), decisions: [`docs/adr/`](docs/adr/README.md),
operations: [`docs/runbooks/`](docs/runbooks/README.md).

## Use the core

Start with [`docs/using-the-core/`](docs/using-the-core/README.md) when adopting the foundation:

- [Intended use and boundaries](docs/using-the-core/intended-use.md)
- [Add a game](docs/using-the-core/add-a-game.md)
- [Add a feature or capability](docs/using-the-core/add-a-feature.md)
- [Balancing and live operations](docs/using-the-core/balancing-and-liveops.md)
- [Testing and releasing](docs/using-the-core/testing-and-release.md)
- [Admin inspector](docs/using-the-core/admin-inspector.md) and its [runbook](docs/runbooks/admin-inspector.md)
  (admin origin, keys, Cloudflare Access, the [admin CLI](docs/runbooks/admin-inspector.md#admin-cli))

These guides describe the supported extension seams. The architecture remains authoritative when a guide and
an ADR differ.

## Layout

```
apps/server            composition root (games/<id>/ config + policy, migrate CLI, admin inspector origin, Dockerfile)
apps/template-game     idle game exercising every core path (Playwright acceptance)
packages/contracts     TypeBox schemas + Static types + closed enums + fixtures + OpenAPI (isomorphic by type)
packages/server        server core: cqrs bus, db/migrations/roles, auth, limits, outbox, jobs, health, features/*
packages/client        web adapter: engine contract, loop, storage, sync, boot, restore, journal, clock, providers, react
packages/jest-verify   node-only verifiers (player token, receipts) + conformance suite
packages/tooling       CI guards, lint rule, deploy-static/zip/check-health/preflight/new-server/new-feature/manifest-check
packages/testkit       real-Postgres test databases, FakeClock, fakeFetch, token/receipt minting, provider pathologies
scripts                admin CLI (admin.mjs), admin key issuance (admin-keys.mjs), k6 load tests (load/)
docs                   architecture, ADRs, runbooks, slo, threat model, capacity, coverage matrix
infra                  docker-compose (postgres:16)
```

## Prerequisites

Node 24 (`.nvmrc`), pnpm 10.30.1 (`corepack enable`), Docker (Postgres 16 for integration tests and the dev server).

## Everyday commands

```bash
pnpm install
pnpm db:up                                   # postgres:16 on localhost:55432 (dev + test databases)
pnpm check                                   # fmt:check → lint → typecheck → build → guards → test
pnpm test:unit                               # fast, no Postgres
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55432/foundation_test pnpm test:pg
pnpm test:model                              # model-based sync tests (client)
pnpm test:scripts                            # admin CLI tests (node --test; also in pnpm check)
pnpm test:e2e                                # Playwright chromium + webkit (template game against a lab server)
```

Run the template game end to end locally:

```bash
cp apps/server/games/template/.env.example apps/server/.env
DATABASE_URL=postgres://postgres:postgres@localhost:55432/foundation_dev pnpm migrate --up
(cd apps/server && set -a && . ./.env && set +a && GAME_ENV=lab node src/main.ts)      # API :8080, inspector :8081 (after build)
pnpm -F @foundation/template-game dev                                                    # client :5173
```

One deployment + one database = one game + one environment (ADR-003). `GAME_ID`/`GAME_ENV` are
configuration only; there is no game column, tenancy or RLS anywhere.

## Synced from a production game (1 October 2026)

A game built on this core ran it in staging and production and sent its foundation improvements back. Added
here, each documented where its topic lives:

- **Sentry, end to end:** searchable tags (`request_id`, route, status, code), error causes, uncaught-exception
  and unhandled-rejection handlers, browser trace linking (`sentry-trace`/`baggage`, `x-request-id`), refused
  purchase verifications, unreadable saves, outbox retries and dead letters, job failures and Crons check-ins,
  and the `ops.alert` job that pages `/health/ops` issues from inside ([slo](docs/slo.md),
  [testing and releasing](docs/using-the-core/testing-and-release.md#production-configuration-and-observability)).
- **PostHog log shipping** of API logs over OTLP (`POSTHOG_LOGS_TOKEN`, `POSTHOG_LOGS_URL`).
- **Admin:** one admin origin forwarding `/admin/v1/*`, a sign-in gate (`GET /admin/v1/session`), scope-aware
  console, grant forms and CLI flags from a per-game grant vocabulary (`games/<id>/grants.ts`,
  `GamePolicy.grantRewardProblem`), purchase fixes, optional Cloudflare Access verification (`CF_ACCESS_*`), the
  admin CLI and key issuance ([runbook](docs/runbooks/admin-inspector.md), ADR-021).
- **Money:** per-game sandbox minting (`purchases.mintSandbox`, migration `0016`, ADR-024).
- **Releases:** `X.Y.Z` build records (`BUILD_INFO_FILE`, prod refuses anything else), `/health/ready` version and
  commit, `players.first_build` (migration `0017`).
- **Server:** `GAME_CONFIG` vs `GAME_ID`, `PG_POOL` default 20 in prod, slow jobs scheduled from `job_runs`, per-
  instance 5xx/401/429 rates, live-ops refresh on every replica, economy anomalies deduplicated with optional
  `anomalyKeys`, the `daily` feature flag (rolling 24 h cadence, `minProgress`), Jev name moderation
  (`POST /v1/names/check`, `TYPESAFE_API_KEY`).
- **Client:** throttled routine saves with push timeouts and jittered backoff, a bounded boot re-push, boot on the
  server save when the local save is damaged, a loop that sleeps between ticks, `PlatformAdapter.screenshots`, and
  `onError`/`traceHeaders` hooks for an error tracker.
- **Ops:** [reset all players](docs/runbooks/reset-all-players.md), a pre-deploy migration CLI for an isolated
  managed database, and k6 load tests ([capacity](docs/capacity.md)).
