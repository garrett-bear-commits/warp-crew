# Implementation status — Game Foundation v1

_Updated at the last checkpoint commit on branch `game-foundation-v1`. Every claim below names the command that produced it; nothing here was inferred._

## Summary

The reusable core from `docs/architecture-v1.md` is implemented as a locally buildable pnpm monorepo: contracts (TypeBox + OpenAPI + fixtures), the server core (typed command bus with reservation-based idempotency and tombstones, real-Postgres migrations with two roles and SECURITY DEFINER fences, outbox with leases/DLQ/replay, jobs, health/ops, auth that fails closed, blob decoding under independent limits) with all thirteen feature folders, the node-only verifiers with a conformance suite, the web adapter (engine loop, storage tiers, boot machine, sync with client-minted commandIds and the beacon route, ratchet/reconcile, generations, restore gate, multi-tab leader, journal, clock, providers, React layer, model-based sync tests), the tooling (guards, lint rule, deploy-static/zip/check-health/preflight/new-server/new-feature/manifest-check), the static admin inspector on a separate origin, and the template idle game with Playwright acceptance on Chromium + WebKit.

Section-by-section evidence lives in `docs/coverage-matrix.md`. External gates (things that need credentials, devices, or a production platform) are listed under "Gates" and were implemented as interface + mock + fail-closed + tests.

## Branch and commits

Branch `game-foundation-v1` off an empty `main` (main is untouched). Checkpoint commits: `git log --oneline` (CP1 → CP7 in order; each commit compiles and its tests pass at that point).

## Checkpoints

| CP | Scope | State |
| --- | --- | --- |
| 1 | workspace, TypeBox contracts + OpenAPI + fixtures, CI guards (mutation commandId, bundle browser-safe, SQL no game_id/tenancy, feature shape, no secrets, no placeholders), ADR-020…028, docs skeleton | done |
| 2 | server spine: bus, idempotency/tombstones, Postgres locks/migrations/roles, outbox DLQ+replay, jobs, limits, auth, health, Docker | done |
| 3 | saves + lineage: append-only snapshots, dispositions, size/bomb guards, terminal quarantine reviews, generation-only rollback, restore/reattach/erasure/CAS, property + real-PG concurrency tests | done |
| 4 | identity/purchases/grants: Jest + mock verifiers + conformance, fail-closed tokens, receipt ledgers, sandbox non-minting, real minting off (ADR-024), grants/codes/cohorts | done |
| 5 | client adapter (`packages/client`) incl. model-based sync tests (540 tests, 0 counterexamples) | done |
| 6 | features: achievements, leaderboards L1–2, inbox, announcements, telemetry, journal, liveops (flags/schedules/segments/content/kill switches/minBuild), admin + static inspector (separate origin, strict CSP), Lab QA | done |
| 7 | template game + Playwright (Chromium + WebKit) + migration/restore/outbox-crash/receipt-replay tests + runbooks + tooling | done |

## Commands and results

Run from the repo root on 2026-08-18 (macOS, Node 24.13.1, pnpm 10.30.1, Docker 29, `postgres:16-alpine` via `pnpm db:up`, `DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55432/foundation_test`).

| Command | Result |
| --- | --- |
| `pnpm install` | ok (lockfile committed; Node 24.13.1 / pnpm 10.30.1 pinned via `packageManager` + `engine-strict`) |
| `pnpm check` = `fmt:check && lint && typecheck && build && guards && test` | exit 0 — prettier clean; eslint 0 errors/0 warnings (incl. `foundation/feature-boundary`, browser-import and `Date.now` rules); tsc clean in every package; Vite builds `apps/template-game/dist` and `apps/server/admin-inspector/dist`; guards 6/6 PASS (mutation-command-id 43 mutations, sql-no-tenancy 219 files, bundle-browser-safe 4 bundle files, feature-shape 13 features, no-secrets 346 files, no-placeholders 305 files); per-package vitest: contracts 26, testkit 3, tooling 41, jest-verify 56, client 538 + model 2, server 38, app-server 21, template-game 33 |
| `pnpm test:unit` (root runner, projects `*:unit` + `*:contract`) | 26 files, 756 tests passed |
| `DATABASE_URL_TEST=… pnpm test:pg` (real postgres:16, migrations from empty, app role) | 6 files, 89 tests passed — `packages/server/test/pg/{bus,infra}.test.ts`, `apps/server/test/pg/{saves,lineage,money,features}.test.ts` |
| `pnpm test:model` (fast-check model-based sync tests) | 1 file, 2 tests passed: 400 runs × ≤ 18 commands + 120 runs with invariants after every command, 0 counterexamples |
| `pnpm test:e2e` (Playwright: builds the game with `VITE_API_URL`, boots a fresh lab API + iframe host + `vite preview`) | `26 passed (40.4s)` — 13 specs × chromium + webkit (iPhone 13): boot/play/save + reload from server, teardown beacon, blocked storage, quarantine → pending review → promote → adopt, daily reward / achievement / make-good letter / announcement / code campaign, liveops config publish without rebuild + 50 % flag + scheduled sale + kill switch + minBuild 426, mock SKU purchase + draft season leaderboard + restart, multi-tab leader/follower, cross-site iframe host, restore panel |
| `node --experimental-strip-types packages/tooling/src/bundle-size.ts apps/template-game/dist 600000` | OK (total gzip 91613 B of 600000 B budget) |
| `git diff --check` | clean |
| `DATABASE_URL=… pnpm migrate --up` / `--status` / `--check packages/server/schema.sql` | applied 12 files, head `4970b846e8c64a1b`, status ok, `schema.sql` committed and matching |
| Docker image build (`docker build -f apps/server/Dockerfile .`) | not run — Docker was used only for the Postgres container; the image is a plain node:24-alpine Dockerfile with HEALTHCHECK; building/pushing an image is a deployment step (out of scope by instruction) |
| Sentry / PITR / Jest platform calls | not run — external gates (see below) |

Totals: 756 unit/contract + 2 model + 89 real-Postgres + 26 browser = 873 tests, all passing; 0 skipped; no to-do/fix-me markers or placeholder text (guarded by `no-placeholders`).

## Coverage

`docs/coverage-matrix.md` has 70 requirement rows: 63 fully implemented with local evidence (90 %), 5 implemented with a documented external remainder (money minting switch, PITR itself, Jest platform confirmation, Sentry DSN, k6 on a deployed Lab), 2 external-only gates (Sentry wiring, k6 bench). Every locally runnable row has a named test; nothing is marked done without a command in the table above.

## Gates (external; interface + mock + fail-closed + tests in place)

| Gate | What is in the repo | What needs the outside world |
| --- | --- | --- |
| Jest URL-hosted production/review mode (§14) | provider-neutral hashed static deploy + zip fallback (ADR-023), `frame-ancestors` documented | confirmation with Jest; the literal game id/aud |
| Jest sandbox receipt price shape (§14, ADR-024) | verifier + classification (paid/sandbox/unclassified/unsupported); `purchases.mintPremium = 'off'` default; tests for both modes | verify the receipt shape on Lab with real receipts, then flip the game config |
| Jest HS256 secret / player token | `createJestIdentityVerifier` (alg pinned, aud, iat, rotation) + conformance | `JEST_JWS_SECRETS` from the Developer Console |
| Managed Postgres PITR + nightly dumps + restore drill | `restore.verify` job, manifests, `manifest-check`, runbook | a managed database and a backup bucket |
| Sentry (server) | redaction/scrub module, `SENTRY_DSN` config | a DSN and a project |
| k6 bench, physical-device storage matrix | `docs/capacity.md`, Playwright mobile emulation | a deployed Lab and devices |
| Docker image push / deploy | `apps/server/Dockerfile` (built locally only if Docker is present) | a registry and a host — deployment is out of scope by instruction |

## Security assumptions

- Provider tokens are HS256 with a symmetric secret held only on the server; the mock verifier is refused in prod by config validation.
- The app database role cannot UPDATE/DELETE ledgers even through a code bug (grants + raise-trigger fence); destructive maintenance goes through SECURITY DEFINER functions.
- Admin keys are sha256-hashed in config, compared timing-safe, scoped; every admin command is audited; the inspector runs on a separate origin with `default-src 'none'` CSP and renders with textContent only.
- Client bundles carry no secrets, no node builtins, no TypeBox runtime (lint + build guard).
- Money can only be minted from a verified signed receipt classified `paid`, and only when the game config enables minting (default off).
- Rate limits use Postgres in prod; the memory store is refused there.

## Start instructions

See `README.md` ("Everyday commands"): `pnpm install`, `pnpm db:up`, `pnpm migrate --up` with `DATABASE_URL`, `GAME_ENV=lab node apps/server/src/main.ts`, `pnpm -F @foundation/template-game dev`. Full acceptance: `pnpm check` then `pnpm test:pg` and `pnpm test:e2e` (Playwright browsers via `pnpm -F @foundation/template-game exec playwright install chromium webkit`).

## Five things to inspect first

1. `packages/server/src/cqrs/bus.ts` — the middleware onion and reservation-based idempotency (ADR-026); its real-PG tests `packages/server/test/pg/bus.test.ts`.
2. `packages/server/src/features/saves/placement.ts` + `packages/server/src/db/migrations/0011_privileges.sql` — the placement guard and the SECURITY DEFINER fences (`promote_snapshot`, `prune_save_blobs`, `erase_player`, `apply_retention`).
3. `packages/client/src/sync` + the model-based tests — the client safety mechanism (ratchet/reconcile/generations vs a server-truth model).
4. `apps/server/test/pg/*.test.ts` — 64+ route tests on real Postgres that double as the acceptance evidence for §4/§6/§7.
5. `docs/adr/ADR-024-purchase-minting-gate.md` and `packages/server/src/features/purchases/server.ts` — how money is fenced until the receipt shape is verified.

## Best next action

Take the stack to Lab (§12 P0 verifications): confirm with Jest that URL-hosted production/review mode is supported and obtain the literal game id/aud + `JEST_JWS_SECRETS`; run `pnpm foundation preflight`, `pnpm migrate --up`, start the image, `pnpm foundation check-health --assert page`; verify the sandbox receipt price shape with real receipts and, if it matches `purchase.price` (0 = sandbox, > 0 = paid), flip `purchases.mintPremium` to `'on'` in the game config (ADR-024). Then wire Sentry (`SENTRY_DSN`) and PITR/restore-verify on the managed database and run the restore drill runbook once with a second person.
