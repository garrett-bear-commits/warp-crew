# Implementation status — Game Foundation v1

_Updated 2026-08-21 on branch `main`. Every current claim below names the command that produced it; nothing here is inferred._

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

Branch `main`; committed through `f01bf78` (`Align foundation with current Jest HTML5 SDK`), with the reviewer-remediation changes described here still uncommitted. The historical `game-foundation-v1` branch currently points at the same commit. No tags exist. Checkpoint history is available through `git log --oneline` (CP1 → CP7, the audit-fix commits, then Jest conformance remediation).

## Checkpoints

| CP | Scope | State |
| --- | --- | --- |
| 1 | workspace, TypeBox contracts + OpenAPI + fixtures, CI guards (mutation commandId, bundle browser-safe, SQL no game_id/tenancy, feature shape, no secrets, no placeholders), ADR-020…028, docs skeleton | done |
| 2 | server spine: bus, idempotency/tombstones, Postgres locks/migrations/roles, outbox DLQ+replay, jobs, limits, auth, health, Docker | done |
| 3 | saves + lineage: append-only snapshots, dispositions, size/bomb guards, terminal quarantine reviews, generation-only rollback, restore/reattach/erasure/CAS, property + real-PG concurrency tests | done |
| 4 | identity/purchases/grants: Jest + mock verifiers + conformance, fail-closed tokens, receipt ledgers, sandbox non-minting, real minting off (ADR-024), grants/codes/cohorts | done |
| 5 | client adapter (`packages/client`) incl. model-based sync tests (618 unit + 2 model tests, 0 counterexamples; audit fixes F1/F3/F8/F9) | done |
| 6 | features: achievements, leaderboards L1–2, inbox, announcements, telemetry, journal, liveops (flags/schedules/segments/content/kill switches/minBuild), admin + static inspector (separate origin, strict CSP), Lab QA | done |
| 7 | template game + Playwright (Chromium + WebKit) + migration/restore/outbox-crash/receipt-replay tests + runbooks + tooling | done |
| 8 | current Jest HTML5 remediation: official SDK mirror/bootstrap, stable registration, data/lifecycle/loading/analytics/entry, signed batch purchase recovery, sandbox provenance, catalog pricing, D1–D7 notifications, and launch runbook | done locally; real-platform gates remain |
| 9 | reviewer remediation: handled eager SDK failure, post-init lifecycle subscriptions, canonical/deduplicated recovery reports, batch-receipt redaction, fail-closed checkout, family pause, hashed grant keys, and durable meaningful-return notification rotation | done locally; real-platform gates remain |

## Commands and results

Rerun from the repo root on 2026-08-21 after the reviewer remediation (macOS, Node 24.13.1,
pnpm 10.30.1). The PG suite used a disposable local Postgres cluster on port 55432 because a
container runtime was unavailable. The cluster was removed after verification.

| Command | Result |
| --- | --- |
| `pnpm install` | ok (lockfile committed; Node 24 / pnpm 10.30.1 pinned via `packageManager` + `engine-strict`); `@sentry/node` added to `packages/server` |
| `pnpm check` = `fmt:check && lint && typecheck && build && guards && test` | passed: formatting, lint, all 8 workspace typechecks, both production builds, 6 guards, 877 unit/contract tests, and 2 model tests |
| `pnpm test:unit` (root runner, `*:unit` + `*:contract`) | 34 files, 877 tests passed |
| `DATABASE_URL_TEST=… pnpm test:pg` (real Postgres, migrations from empty incl. `0014_purchase_sandbox_provenance`, app role) | 7 files, 116 tests passed; the root script uses one worker because bootstrap roles are cluster-global |
| `pnpm test:model` | 1 file, 2 tests passed (400 + 120 fast-check runs, 0 counterexamples; the server-truth model now replays refused/quarantined writes with their original disposition) |
| `pnpm test:e2e` (Playwright Chromium + WebKit iPhone 13 against a fresh lab API, local iframe host, `vite preview`, and local official-shape Jest fixture) | 28 passed (46.8 s) |
| `git diff --check` | clean |
| Docker image build/smoke | not rerun on 2026-08-20 because Docker was unavailable; the prior 2026-08-18 checkpoint built from `git archive HEAD` and smoke-tested `/health/ready` + inspector CSP |
| `DATABASE_URL=… pnpm migrate --up` then `pnpm migrate --check packages/server/schema.sql` on a fresh database | 14 migrations applied, head `7ff022d400983b54`; `schema matches` |
| `pnpm -F @foundation/contracts openapi:diff` | "no released tag exists yet — nothing to diff against (unavailable, not passed)"; the detector itself is unit-tested (`test/openapi-diff.test.ts`) and CI runs it against the last tag once one exists |
| Sentry / managed PITR / object storage / Jest platform calls | not run — external gates (below); the local paths (Sentry wiring with an injected transport, isolated-restore verification, erasure export/replay) are tested |

Totals: 877 unit/contract + 2 model + 116 real-Postgres + 28 browser = 1,023 tests, all passing; 0 skipped; no to-do/fix-me markers or placeholder text (guarded by `no-placeholders`).

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

`docs/coverage-matrix.md` has 70 requirement rows: every locally runnable row is implemented with a named test; the rows carrying an external remainder are 1.7 (real minting switch and the owner-gated sandbox delivery decision, ADR-024), 1.16/8.4 (managed PITR/dumps), 6.3/9.4 (tag-based OpenAPI diff and per-release fixture recordings — no release exists), 8.2 (Sentry DSN + cron monitor), 9.6 (k6 on a deployed Lab), and 10.3 (self-hosted URL registration plus real shell/framing/CORS/storage verification). Nothing here claims those external gates passed.

## Gates (external; interface + mock + fail-closed + tests in place)

| Gate | What is in the repo | What needs the outside world |
| --- | --- | --- |
| Jest self-hosted URL version and real shell (§14) | provider-neutral hashed static deploy + zip fallback (ADR-023), `frame-ancestors` documented, same-origin `/v1` preferred | register/preview/activate the URL; verify iframe framing, CORS, storage partitioning, SDK bootstrap, and mobile behavior in the hosted emulator/Simulator; obtain literal game id/aud |
| Jest sandbox receipts and delivery policy (§14, ADR-024) | verifier/classification tracks signed `sandbox` before price; server-authored checkout readiness stays false while minting is off; disabled paid receipts remain provider-recoverable without ledger rows; current schema preserves sandbox `granted = 0`; local tests cover the invariant | run real sandbox purchase/recovery; owner must approve any future separation of test-item delivery from commercial accounting before schema/ledger changes |
| Jest HS256 secret / player token | `createJestIdentityVerifier` (alg pinned, aud, iat, rotation) + conformance | `JEST_JWS_SECRETS` from the Developer Console |
| Managed Postgres PITR + nightly dumps + restore drill | `live.integrity` job, `verifyIsolatedRestore`/`markRestoreVerified`, erasure export/replay (`apps/server/src/cli/dr.ts`), manifests, `manifest-check`, runbook | a managed database and a backup bucket (PITR/dump/R2 are external) |
| Sentry (server) | real optional wiring (`observability/sentry.ts`: init, release/environment tags, request + command spans, send-time sampling, redaction; tested through an injected transport) | a DSN and a project; the per-game cron monitor |
| k6 bench, physical-device storage matrix | `docs/capacity.md`, Playwright mobile emulation | a deployed Lab and devices |
| Docker image push / deploy | `apps/server/Dockerfile` (built locally from `git archive HEAD` and smoke-run) | a registry and a host — deployment is out of scope by instruction |

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
4. `apps/server/test/pg/*.test.ts` and `packages/server/test/pg/*.test.ts` — 116 tests on real Postgres that double as the acceptance evidence for §4/§6/§7.
5. `docs/adr/ADR-024-purchase-minting-gate.md` and `packages/server/src/features/purchases/server.ts` — how money is fenced until the receipt shape is verified.

## Best next action

Take the stack to Lab (§12 P0 verifications): register/preview the self-hosted URL version, obtain the literal game id/aud + `JEST_JWS_SECRETS`, and verify the real shell using [the launch runbook](docs/runbooks/jest-launch.md); run `pnpm foundation preflight`, `pnpm migrate --up`, start the image, and `pnpm foundation check-health --assert page`. Run real sandbox login, notification, purchase, signed recovery, and completion checks. Do not infer sandbox status from price; do not enable `purchases.mintPremium` until real paid payload validation and owner approval. Then set `SENTRY_DSN` (the wiring is in place and tested), enable PITR on the managed database, and run the restore-drill runbook once with a second person (`dr verify-restore … --mark` is the only path that writes `restore_verified_at`).
