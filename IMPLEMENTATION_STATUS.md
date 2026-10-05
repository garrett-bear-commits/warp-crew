# Implementation status — Game Foundation v1

_Updated 2026-08-26 on branch `main`; the 2026-10-01 production-game sync is summarised below. Every current claim below names the command that produced it; nothing here is inferred._

## Summary

The reusable core from `docs/architecture-v1.md` is implemented as a locally buildable pnpm monorepo: contracts (TypeBox + OpenAPI + fixtures), the server core (typed command bus with reservation-based idempotency and tombstones, real-Postgres migrations with two roles and SECURITY DEFINER fences, outbox with leases/DLQ/replay, jobs, health/ops, auth that fails closed, blob decoding under independent limits) with all thirteen feature folders, the node-only verifiers with a conformance suite, the web adapter (engine loop, storage tiers, boot machine, sync with client-minted commandIds and the beacon route, ratchet/reconcile, generations, restore gate, multi-tab leader, journal, clock, providers, React layer, model-based sync tests), the tooling (guards, lint rule, deploy-static/zip/check-health/preflight/new-server/new-feature/manifest-check), the static admin inspector on a separate origin, and the template idle game with Playwright acceptance on Chromium + WebKit.

Section-by-section evidence lives in `docs/coverage-matrix.md`. External gates (things that need credentials, devices, or a production platform) are listed under "Gates". Local mocks and Playwright runs are evidence for local contracts only; they are not evidence that the real Jest shell, SDK, Developer Console, Simulator, sandbox, or mobile devices accepted the game.

## Jest conformance truth (reviewed 2026-08-20)

The official documentation now supports self-hosted URL versions. The remaining hosting gate is
not whether URL versions exist; it is registering this game's URL and verifying the real shell's
iframe framing, CORS, storage partitioning, SDK initialization, and mobile behavior. Prefer one
static game origin with `/v1` reverse-proxied on that origin. See [ADR-023](docs/adr/ADR-023-provider-neutral-static-hosting.md)
and the [Developer Console launch runbook](docs/runbooks/jest-launch.md).

The adapter, unit suite, and `jest-official-shape.spec.ts` exercise the current documented method
and result shapes locally. They must not be reported as real Jest verification. Real-platform gates
still include registration and stable guest→registered identity, SDK/runtime behavior,
notifications/moderation, signed purchase/recovery fixtures, sandbox testing, Simulator
self-review, and mobile soak.

## Branch and commits

Branch `main`. The first reviewer-remediation set was committed as `f046d47` (`Address Jest integration review findings`); the historical `game-foundation-v1` branch remains at `f01bf78`. No tags exist. Use `git log --oneline` and `git status --short` for the current committed and working state rather than duplicating a moving head here.

## Checkpoints

| CP | Scope | State |
| --- | --- | --- |
| 1 | workspace, TypeBox contracts + OpenAPI + fixtures, CI guards (mutation commandId, bundle browser-safe, SQL no game_id/tenancy, feature shape, no secrets, no placeholders), ADR-020…028, docs skeleton | done |
| 2 | server spine: bus, idempotency/tombstones, Postgres locks/migrations/roles, outbox DLQ+replay, jobs, limits, auth, health, Docker | done |
| 3 | saves + lineage: append-only snapshots, dispositions, size/bomb guards, terminal quarantine reviews, generation-only rollback, restore/reattach/erasure/CAS, property + real-PG concurrency tests | done |
| 4 | identity/purchases/grants: Jest + mock verifiers + conformance, fail-closed tokens, receipt ledgers, sandbox non-minting unless the game sets `mintSandbox` (0016), real minting per-game gated (ADR-024; off for template and idle-civ), grants/codes/cohorts | done |
| 5 | client adapter (`packages/client`) incl. model-based sync tests (623 unit + 2 model tests, 0 counterexamples; audit fixes F1/F3/F8/F9) | done |
| 6 | features: achievements, leaderboards L1–2, inbox, announcements, telemetry, journal, liveops (flags/schedules/segments/content/kill switches/minBuild), admin + static inspector (separate origin, strict CSP), Lab QA | done |
| 7 | template game + Playwright (Chromium + WebKit) + migration/restore/outbox-crash/receipt-replay tests + runbooks + tooling | done |
| 8 | current Jest HTML5 remediation: official SDK mirror/bootstrap, stable registration, data/lifecycle/loading/analytics/entry, signed batch purchase recovery, sandbox provenance, catalog pricing, D1–D7 notifications, and launch runbook | done locally; real-platform gates remain |
| 9 | Warp Crew port stage 2 (2026-10-05, branch `claude/game-core-port`): bundle packs, one-time packs (migration `0018`), `GET /v1/purchases/owned`, verified stateless subscriptions (ADR-035); `games/warpcrew` config, policy and grant vocabulary; the legacy Warp Crew server tests replayed in `apps/server/test/pg/warpcrew.test.ts` | done locally (`pnpm check`, `pnpm test:pg`); real Jest subscription lists and receipts remain gates |
| 9 | reviewer remediation: handled eager SDK failure, post-init lifecycle subscriptions, canonical/deduplicated recovery reports, batch-receipt redaction, fail-closed checkout, family pause, hashed grant keys, and durable meaningful-return notification rotation | done locally; real-platform gates remain |
| 10 | reviewer closure: fresh click-time checkout preflight, recovery-wide terminal states, concurrent credential refresh, leader/mutex-owned retention mutation, legacy grant-key migration/aliases, and clean schema snapshot generation | done locally; real-platform gates remain |
| 11 | last-pass follow-up: N-1 checker ships with the 15-file `c94bf5d` head (two-release; no extra migration), declared extras bound to one image head + checksums, prefix enforcement, retention fail-closed, official-shape per-purchase seq | unit/model/lint/typecheck/build/guards green; real-Postgres + Playwright not rerun (`shmget` EPERM) |
| 12 | adopter guides, idle-civ integration, task-based admin redesign, and disposable retained-save sessions (memory-only, no-network, discard-only) | focused client/idle/inspector tests + typechecks + builds green; full check recorded below |
| 13 | sync from a production game (2026-10-01): see the section below | done — 2026-10-01 on branch `sync/broken-mile-oct-2026`: `pnpm fmt:check`, `lint`, `typecheck`, `build`, `guards` pass; `pnpm test` passes in every workspace (client 712 + 2, server 120, contracts 40, jest-verify 68, tooling 42, testkit 3, app-server 69, template-game 67, idle-civ 12); `pnpm test:pg` 168, `test:model` 2, `test:scripts` 42; template-game Playwright 14/14 on Chromium and 14/14 on WebKit; `openapi:diff` unavailable (no release tag); bundle-size OK; `git archive HEAD \| docker build -f apps/server/Dockerfile -` builds. k6 load tests syntax-checked only (k6 not installed) |

## Commands and results

Rerun from the repo root on 2026-08-26 after the disposable-session work (macOS, Node 24.19.0,
pnpm 10.30.1). Postgres was not needed for this browser/client-only addition. The last attempted
database run in this environment could not start (`shmget` / `shmat` EPERM); Docker was unavailable.
Prior 2026-08-21 PG/e2e numbers were for `c94bf5d` (15 migrations). This image keeps that 15-file
head. Unreleased DBs that applied a rewritten `0015`/`0016` are rebuilt from empty.

| Command | Result |
| --- | --- |
| `pnpm check` | exit 0: format, lint, all workspace typechecks, builds, guards, and tests |
| `pnpm fmt:check` | ok |
| `pnpm lint` | ok |
| `pnpm typecheck` | ok (all 9 participating workspace projects) |
| `pnpm build` | ok (admin inspector + template game + idle-civ) |
| `pnpm guards` | 6/6 PASS (426 files in no-secrets scan) |
| recursive `pnpm test` inside `pnpm check` | 940 tests passed across contracts, tooling, testkit, client, verifiers, server, inspector, template game, and idle-civ; includes 2 model tests |
| `DATABASE_URL_TEST=… pnpm test:pg` | not run — local `initdb`/`pg_ctl` failed (`could not create shared memory segment: Operation not permitted`); no container runtime |
| `pnpm test:e2e` | not run — needs the PG lab API |
| local browser disposable-session check | inspector → exact-origin popup handshake → retained blob → idle-civ loaded acknowledgement; one API request (the admin blob GET), zero game API requests; desktop + 390×844 layouts inspected |
| `git diff --check` | clean |
| Docker image build/smoke | not rerun (Docker unavailable) |
| `DATABASE_URL=… pnpm migrate --up` then `pnpm migrate --check packages/server/schema.sql` | not run (no database). Disk has 15 files; `0015` matches `c94bf5d`; `schema_n1_compat` is migrator-owned and excluded from `describeSchema` |
| `pnpm -F @foundation/contracts openapi:diff` | "no released tag exists yet — nothing to diff against (unavailable, not passed)" |
| Sentry / managed PITR / object storage / Jest platform calls | not run — external gates |

Verified this session: 940 tests in `pnpm check`, including 2 model tests. Real-Postgres and the existing
template-game Playwright suite were not rerun because this addition changes no server contract, route, schema,
or template game. The admin-to-idle-civ popup flow was exercised in a local browser harness. No to-do/fix-me
markers or placeholder text were accepted (guarded by `no-placeholders`).

## Disposable retained-save sessions (2026-08-26)

- The inspector can launch from a save-history row or an exact player/sequence form. A pruned blob fails with
  a clear unavailable result.
- The fragment carries only a secure random session ID and exact inspector origin. The snapshot transfers only
  after exact source, origin, protocol, and session validation; credentials never leave the inspector.
- Idle-civ branches before normal storage, provider, and API construction. It uses a synthetic identity,
  memory-only slot, codec migration, disabled sync/KV/journal/beacon/persistence/tabs, fail-closed fetch, and a
  persistent discard banner.
- `packages/client/test/unit/incognito-session.test.ts`, `apps/idle-civ/test/unit/incognito.test.ts`, idle UI
  tests, and inspector tests cover protocol rejection, size bounds, state separation, zero network/durable
  writes, and operator feedback. ADR-034 and `docs/using-the-core/disposable-save-sessions.md` define the adopter
  contract and the retained-blob/RNG limits.

## Synced from a production game (2026-10-01)

A game built on this core (forked at `3b323f9`) ran it in staging and production. Its foundation changes to
`packages/*` and `apps/server` were ported back, written game-agnostically; `apps/template-game`,
`apps/idle-civ` and `apps/server/games/idle-civ` stay here. What was added, with the docs that describe it:

- Sentry: searchable request tags, error causes, process handlers (uncaught → flush + exit 1; unhandled rejection
  → log, stay up), browser trace continuation, reports beyond 5xx (refused purchase verifications, unreadable
  saves, contract refusals, foreign tokens, Jev outages, refused board runs, outbox retries and dead letters, job
  and runner failures), Crons check-ins, and the `ops.alert` job ([slo](docs/slo.md),
  [testing and releasing](docs/using-the-core/testing-and-release.md)).
- PostHog log shipping over OTLP (`POSTHOG_LOGS_TOKEN`/`POSTHOG_LOGS_URL`).
- Admin: the admin origin forwards `/admin/v1/*`; sign-in via `GET /admin/v1/session`; scope-aware inspector with
  grant fields from `games/<id>/grants.ts` and purchase fixes; optional Cloudflare Access verification
  (`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`); `scripts/admin.mjs` and `scripts/admin-keys.mjs`
  ([runbook](docs/runbooks/admin-inspector.md), ADR-021).
- Money: `purchases.mintSandbox` and migration `0016` (ADR-024); grant contents refused at mint time outside the
  game's vocabulary (`GamePolicy.grantRewardProblem`).
- Releases: `BUILD_INFO_FILE` build records, prod refuses non-`X.Y.Z` builds and placeholder or non-production
  records, `/health/ready` version + commit, `players.first_build` (migration `0017`, N-1 compatible).
- Server: `GAME_CONFIG`, `PG_POOL` default 20 in prod, slow jobs scheduled from `job_runs`, per-instance HTTP
  outcome rates in `/health/ops`, live-ops refresh on every replica, deduplicated economy anomalies with
  `anomalyKeys`, the `daily` feature flag, `POST /v1/names/check` (`TYPESAFE_API_KEY`).
- Client: throttled routine saves, push timeout and jittered backoff, bounded boot re-push, boot on the server
  save when the local slot is damaged, a sleeping loop, `PlatformAdapter.screenshots`, `onError`/`traceHeaders`.
- Ops: [reset all players](docs/runbooks/reset-all-players.md), `apps/server/src/cli/railway-migrate.ts`, k6 load
  tests under `scripts/load` ([capacity](docs/capacity.md)).

Requirement → implementation → test rows: `docs/coverage-matrix.md` (new rows 4.2.11, 8.7–8.11; updated 1.7, 1.10,
4.2.1, 4.2.7, 4.2.8, 4.3, 4.4, 5.1–5.3, 7.3, 7.6, 8.2, 9.6). The production game's evidence (staging load and
race runs) is in `docs/capacity.md`; it is that game's, not a run from this repository.

## Last-pass findings (2026-08-21) — implemented

| # | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| 1 | Previous image refused to boot after `0015` (exact head match) | Two-release: this image ships the N-1 checker at the `c94bf5d` 15-file head. `c94bf5d` still exact-head (`exactHeadMatches`). Future extras declare `-- foundation-n1-compatible-with-ordinal: N` (not a `migrateUp` batch) | `packages/server/test/unit/migrate.test.ts`; `infra.test.ts` N-1 block |
| 2 | `0015` held `ACCESS EXCLUSIVE` across rewrite + constraint scan | **Not fixed.** `0015` restored byte-for-byte; rewriting it would break checksum upgrade. The validating scan still takes `ACCESS EXCLUSIVE`. | `0015_legacy_purchase_grant_keys.sql:125`; this table |
| 3 | No-Web-Locks tabs all led and raced retention mutation | Fail closed without Web Locks; same-tab `run()` queued | `apps/template-game/test/unit/retention.test.ts` |
| 4 | `priorMigrationsDir` excluded only `0015_` by name | `migrationsBefore` uses parsed `NNNN` prefix | `migrate.test.ts` synthetic `0014`/`0015`/`0016` |
| 5 | Official-shape UI never completed a paid checkout | Fixture `beginPurchase` returns unique paid `mockreceipt.*`; Shop click asserts grant/gems/`completePurchase` once, then the failed-preflight case | `apps/template-game/e2e/jest-official-shape.spec.ts` |

## Audit findings (2026-08-18) — all fixed with regression tests

| # | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| 1 | BootMachine kept the guest SyncClient after an identity switch | `bootMachine.rebind()`; per-player auth; guest sync retired; every re-check path uses the current player | `packages/client/test/unit/boot-restore.test.ts` (switch → long hide → visible: only account credentials; property test over random switches) |
| 2 | PGSSL mapped `verify` → `require` and otherwise `prefer` | `pgSslOption`: off→false, require→require, verify→verify-full; prod refuses off | `packages/server/test/unit/config.test.ts` TLS block |
| 3 | Save tombstones lost disposition/reason/flags; replay of a refused write looked like `duplicate` | full-result tombstones; `replaySaveResult` (anchored→duplicate; refused/quarantined unchanged); client verdicts follow | `apps/server/test/pg/audit.test.ts` F3, client `sync-flows`/`verdicts` tests, model test |
| 4 | Live checksum wrote `restore_verified_at` | `live.integrity` job → `live_integrity_verified_at`; `verifyIsolatedRestore` + `markRestoreVerified`; erasure export/replay CLI | `audit.test.ts` F4 (two databases + JSONL file) |
| 5 | Code redemption checked then incremented (race across players) | atomic `UPDATE … WHERE redemptions < max RETURNING` before minting | `audit.test.ts` F5 (3 players × 5 rounds, max=1) |
| 6 | Outbox finalisation not tied to the lease | `lease_token` column (migration 0013); finalisation only by token holder; `stale` counter | `audit.test.ts` F6 (two workers, lease expiry, stale finalisation) |
| 7 | Admin replay opened a second transaction | `replayInTx(tx, …)` used by the command | `audit.test.ts` F7 (PG_POOL=1, rollback atomicity, audited route) |
| 8 | pendingQuarantine on empty heads | server already returned it; client now preserves it on the `empty` shape and exposes `pendingReview` | `audit.test.ts` F8, client `boot-restore` + `react` tests |
| 9 | Followers could still ship saves/journal/telemetry/beacons | `mayWrite()` gate, timers stopped on demotion, queued data shipped after `playHere()` | `packages/client/test/unit/multi-tab.test.ts` |
| 10 | Dockerfile copied a pre-built inspector | builder stage; CI builds `git archive HEAD \| docker build` | this table |
| 11 | `no-placeholders` guard failed on the status file | reworded the doc; guard unchanged | `pnpm guards` |
| 12 | Sentry was config-only | real optional wiring (init, release, spans, send-time sampling, recursive direct/batch receipt redaction shared with structured logs) | `packages/server/test/unit/{sentry,logging}.test.ts` |
| 13 | Over-claims in docs | matrix rows 6.3/8.2/8.4/9.2/9.4/10.1 corrected; openapi-diff detector added; branch state stated exactly | this file, `docs/coverage-matrix.md` |
| 14 | Same patterns nearby | advisory locks on provider token / runId; foreign token rejected, foreign runId 403 | `audit.test.ts` F14 |

## Coverage

`docs/coverage-matrix.md` has 77 requirement rows (6 added by the 2026-10-01 sync): every locally runnable row is implemented with a named test; the rows carrying an external remainder are 1.7 (real minting switch and the owner-gated sandbox delivery decision, ADR-024), 1.16/8.4 (managed PITR/dumps), 6.3/9.4 (tag-based OpenAPI diff and per-release fixture recordings — no release exists), 8.2 (Sentry DSN + alert rules), 8.9 (a PostHog project token for log shipping), 9.6 (the k6 run at load on a deployed Lab), and 10.3 (self-hosted URL registration plus real shell/framing/CORS/storage verification). Last-pass PG/lock-window and official-shape UI checkout tests are in the tree; they were not re-executed against Postgres/Playwright in this environment. Nothing here claims those external gates passed.

## Gates (external; interface + mock + fail-closed + tests in place)

| Gate | What is in the repo | What needs the outside world |
| --- | --- | --- |
| Jest self-hosted URL version and real shell (§14) | provider-neutral hashed static deploy + zip fallback (ADR-023), `frame-ancestors` documented, same-origin `/v1` preferred | register/preview/activate the URL; verify iframe framing, CORS, storage partitioning, SDK bootstrap, and mobile behavior in the hosted emulator/Simulator; obtain literal game id/aud |
| Jest sandbox receipts and delivery policy (§14, ADR-024) | verifier/classification tracks signed `sandbox` before price; server-authored checkout readiness stays false while minting is off; disabled paid receipts remain provider-recoverable without ledger rows; sandbox `granted = 0` unless the game sets `mintSandbox` on (migration 0016; off for template and idle-civ); local tests cover the default-off invariant | run real sandbox purchase/recovery; owner must approve any future separation of test-item delivery from commercial accounting before schema/ledger changes |
| Jest HS256 secret / player token | `createJestIdentityVerifier` (alg pinned, aud, iat, rotation) + conformance | `JEST_JWS_SECRETS` from the Developer Console |
| Managed Postgres PITR + nightly dumps + restore drill | `live.integrity` job, `verifyIsolatedRestore`/`markRestoreVerified`, erasure export/replay (`apps/server/src/cli/dr.ts`), manifests, `manifest-check`, runbook | a managed database and a backup bucket (PITR/dump/R2 are external) |
| Sentry (server) | real optional wiring (`observability/sentry.ts`: init, release/environment tags, request + command spans, send-time sampling, redaction, searchable tags, process handlers, Crons, `ops.alert`; tested through an injected transport); used in production by the game this was synced from | a DSN and a project per game; its alert rules (`docs/slo.md`) |
| k6 bench, physical-device storage matrix | `scripts/load/*.js`, `docs/capacity.md`, Playwright mobile emulation | a deployed Lab and devices |
| Docker image push / deploy | `apps/server/Dockerfile` (built locally from `git archive HEAD` and smoke-run) | a registry and a host — deployment is out of scope by instruction |

## Security assumptions

- Provider tokens are HS256 with a symmetric secret held only on the server; the mock verifier is refused in prod by config validation.
- The app database role cannot UPDATE/DELETE ledgers even through a code bug (grants + raise-trigger fence); destructive maintenance goes through SECURITY DEFINER functions.
- Admin keys are sha256-hashed in config, compared timing-safe, scoped; every admin command is audited; the inspector runs on a separate origin with `default-src 'none'` CSP and renders with textContent only; that origin forwards only `/admin/v1/*`, and with `CF_ACCESS_*` set the API also requires a verified Cloudflare Access token.
- Client bundles carry no secrets, no node builtins, no TypeBox runtime (lint + build guard).
- Money can only be minted from a verified signed receipt classified `paid` (or `sandbox`, when the game also sets `mintSandbox`), and only when the game config enables minting (default off).
- Rate limits use Postgres in prod; the memory store is refused there.

## Start instructions

See `README.md` ("Everyday commands"): `pnpm install`, `pnpm db:up`, `pnpm migrate --up` with `DATABASE_URL`, `GAME_ENV=lab node apps/server/src/main.ts`, `pnpm -F @foundation/template-game dev`. Full acceptance: `pnpm check` then `pnpm test:pg` and `pnpm test:e2e` (Playwright browsers via `pnpm -F @foundation/template-game exec playwright install chromium webkit`).

## Five things to inspect first

1. `packages/server/src/cqrs/bus.ts` — the middleware onion and reservation-based idempotency (ADR-026); its real-PG tests `packages/server/test/pg/bus.test.ts`.
2. `packages/server/src/features/saves/placement.ts` + `packages/server/src/db/migrations/0011_privileges.sql` — the placement guard and the SECURITY DEFINER fences (`promote_snapshot`, `prune_save_blobs`, `erase_player`, `apply_retention`).
3. `packages/client/src/sync` + the model-based tests — the client safety mechanism (ratchet/reconcile/generations vs a server-truth model).
4. `apps/server/test/pg/*.test.ts` and `packages/server/test/pg/*.test.ts` — 122 tests on real Postgres that double as the acceptance evidence for §4/§6/§7. These were not re-executed in this environment.
5. `docs/adr/ADR-024-purchase-minting-gate.md` and `packages/server/src/features/purchases/server.ts` — how money is fenced until the receipt shape is verified.

## Best next action

Take the stack to Lab (§12 P0 verifications): register/preview the self-hosted URL version, obtain the literal game id/aud + `JEST_JWS_SECRETS`, and verify the real shell using [the launch runbook](docs/runbooks/jest-launch.md); run `pnpm foundation preflight`, `pnpm migrate --up`, start the image, and `pnpm foundation check-health --assert page`. Run real sandbox login, notification, purchase, signed recovery, and completion checks. Do not infer sandbox status from price; do not enable `purchases.mintPremium` until real paid payload validation and owner approval. Then set `SENTRY_DSN` (the wiring is in place and tested), enable PITR on the managed database, and run the restore-drill runbook once with a second person (`dr verify-restore … --mark` is the only path that writes `restore_verified_at`).
