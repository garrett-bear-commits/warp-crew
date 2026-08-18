# Implementation status — Game Foundation v1

_Updated at the last checkpoint commit on branch `game-foundation-v1`. Every claim below names the command that produced it; nothing here was inferred._

## Summary

The reusable core from `docs/architecture-v1.md` is implemented as a locally buildable pnpm monorepo: contracts (TypeBox + OpenAPI + fixtures), the server core (typed command bus with reservation-based idempotency and tombstones, real-Postgres migrations with two roles and SECURITY DEFINER fences, outbox with leases/DLQ/replay, jobs, health/ops, auth that fails closed, blob decoding under independent limits) with all thirteen feature folders, the node-only verifiers with a conformance suite, the web adapter (engine loop, storage tiers, boot machine, sync with client-minted commandIds and the beacon route, ratchet/reconcile, generations, restore gate, multi-tab leader, journal, clock, providers, React layer, model-based sync tests), the tooling (guards, lint rule, deploy-static/zip/check-health/preflight/new-server/new-feature/manifest-check), the static admin inspector on a separate origin, and the template idle game with Playwright acceptance on Chromium + WebKit.

Section-by-section evidence lives in `docs/coverage-matrix.md`. External gates (things that need credentials, devices, or a production platform) are listed under "Gates" and were implemented as interface + mock + fail-closed + tests.

## Branch and commits

Branch `game-foundation-v1`; `main` has no commits (this repository was empty before the branch). No tags exist. Checkpoint commits: `git log --oneline` (CP1 → CP7, then the audit-fix commits); each commit compiles and its tests pass at that point. Nothing has been pushed.

## Checkpoints

| CP | Scope | State |
| --- | --- | --- |
| 1 | workspace, TypeBox contracts + OpenAPI + fixtures, CI guards (mutation commandId, bundle browser-safe, SQL no game_id/tenancy, feature shape, no secrets, no placeholders), ADR-020…028, docs skeleton | done |
| 2 | server spine: bus, idempotency/tombstones, Postgres locks/migrations/roles, outbox DLQ+replay, jobs, limits, auth, health, Docker | done |
| 3 | saves + lineage: append-only snapshots, dispositions, size/bomb guards, terminal quarantine reviews, generation-only rollback, restore/reattach/erasure/CAS, property + real-PG concurrency tests | done |
| 4 | identity/purchases/grants: Jest + mock verifiers + conformance, fail-closed tokens, receipt ledgers, sandbox non-minting, real minting off (ADR-024), grants/codes/cohorts | done |
| 5 | client adapter (`packages/client`) incl. model-based sync tests (560 tests, 0 counterexamples; audit fixes F1/F3/F8/F9) | done |
| 6 | features: achievements, leaderboards L1–2, inbox, announcements, telemetry, journal, liveops (flags/schedules/segments/content/kill switches/minBuild), admin + static inspector (separate origin, strict CSP), Lab QA | done |
| 7 | template game + Playwright (Chromium + WebKit) + migration/restore/outbox-crash/receipt-replay tests + runbooks + tooling | done |

## Commands and results

Rerun from the repo root on 2026-08-18 after the audit fixes (macOS, Node 24.13.1, pnpm 10.30.1, Docker 29, `postgres:16-alpine` via `pnpm db:up`, `DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55432/foundation_test`). Nothing below is carried over from an earlier run.

| Command | Result |
| --- | --- |
| `pnpm install` | ok (lockfile committed; Node 24 / pnpm 10.30.1 pinned via `packageManager` + `engine-strict`); `@sentry/node` added to `packages/server` |
| `pnpm check` = `fmt:check && lint && typecheck && build && guards && test` | exit 0 — prettier clean; eslint 0 errors/0 warnings; tsc clean in every package; Vite builds `apps/template-game/dist` and `apps/server/admin-inspector/dist`; guards 6/6 PASS (mutation-command-id 43, sql-no-tenancy 226 files, bundle-browser-safe 4 bundle files, feature-shape 13, no-secrets 358 files, no-placeholders 317 files); per-package vitest: contracts 28, testkit 3, tooling 41, jest-verify 56, client 558 + model 2, server 44, app-server 21, template-game 33 |
| `pnpm test:unit` (root runner, `*:unit` + `*:contract`) | 29 files, 784 tests passed |
| `DATABASE_URL_TEST=… pnpm test:pg` (real postgres:16, migrations from empty incl. `0013_outbox_lease_token`, app role) | 7 files, 102 tests passed — `packages/server/test/pg/{bus,infra}.test.ts`, `apps/server/test/pg/{saves,lineage,money,features,audit}.test.ts` |
| `pnpm test:model` | 1 file, 2 tests passed (400 + 120 fast-check runs, 0 counterexamples; the server-truth model now replays refused/quarantined writes with their original disposition) |
| `pnpm test:e2e` (Playwright chromium + webkit iPhone 13 against a fresh lab API, iframe host, `vite preview`) | `26 passed (44.0s)` |
| `git diff --check` | clean |
| `git archive HEAD \| docker build -f apps/server/Dockerfile -` | image built from a clean checkout (admin inspector built in the builder stage); smoke-run against the local Postgres: `/health/ready` → 200 `status: ready`, inspector origin served with `default-src 'none'` CSP |
| `DATABASE_URL=… pnpm migrate --up` / `--check packages/server/schema.sql --write` | 13 files applied, head `347d4c7da5c1f5ce`, `schema.sql` regenerated and committed |
| `pnpm -F @foundation/contracts openapi:diff` | "no released tag exists yet — nothing to diff against (unavailable, not passed)"; the detector itself is unit-tested (`test/openapi-diff.test.ts`) and CI runs it against the last tag once one exists |
| Sentry / managed PITR / object storage / Jest platform calls | not run — external gates (below); the local paths (Sentry wiring with an injected transport, isolated-restore verification, erasure export/replay) are tested |

Totals: 784 unit/contract + 2 model + 102 real-Postgres + 26 browser = 914 tests, all passing; 0 skipped; no to-do/fix-me markers or placeholder text (guarded by `no-placeholders`).

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
| 12 | Sentry was config-only | real optional wiring (init, release, spans, send-time sampling, redaction) | `packages/server/test/unit/sentry.test.ts` |
| 13 | Over-claims in docs | matrix rows 6.3/8.2/8.4/9.2/9.4/10.1 corrected; openapi-diff detector added; branch state stated exactly | this file, `docs/coverage-matrix.md` |
| 14 | Same patterns nearby | advisory locks on provider token / runId; foreign token rejected, foreign runId 403 | `audit.test.ts` F14 |

## Coverage

`docs/coverage-matrix.md` has 70 requirement rows: every locally runnable row is implemented with a named test; the rows carrying an external remainder are 1.7 (real minting switch, ADR-024), 1.16/8.4 (managed PITR/dumps), 6.3/9.4 (tag-based OpenAPI diff and per-release fixture recordings — no release exists), 8.2 (Sentry DSN + cron monitor), 9.6 (k6 on a deployed Lab), 10.3 (Jest URL-hosting confirmation). Nothing is marked done without a command in the table above.

## Gates (external; interface + mock + fail-closed + tests in place)

| Gate | What is in the repo | What needs the outside world |
| --- | --- | --- |
| Jest URL-hosted production/review mode (§14) | provider-neutral hashed static deploy + zip fallback (ADR-023), `frame-ancestors` documented | confirmation with Jest; the literal game id/aud |
| Jest sandbox receipt price shape (§14, ADR-024) | verifier + classification (paid/sandbox/unclassified/unsupported); `purchases.mintPremium = 'off'` default; tests for both modes | verify the receipt shape on Lab with real receipts, then flip the game config |
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
4. `apps/server/test/pg/*.test.ts` — 64+ route tests on real Postgres that double as the acceptance evidence for §4/§6/§7.
5. `docs/adr/ADR-024-purchase-minting-gate.md` and `packages/server/src/features/purchases/server.ts` — how money is fenced until the receipt shape is verified.

## Best next action

Take the stack to Lab (§12 P0 verifications): confirm with Jest that URL-hosted production/review mode is supported and obtain the literal game id/aud + `JEST_JWS_SECRETS`; run `pnpm foundation preflight`, `pnpm migrate --up`, start the image, `pnpm foundation check-health --assert page`; verify the sandbox receipt price shape with real receipts and, if it matches `purchase.price` (0 = sandbox, > 0 = paid), flip `purchases.mintPremium` to `'on'` in the game config (ADR-024). Then set `SENTRY_DSN` (the wiring is in place and tested), enable PITR on the managed database, and run the restore-drill runbook once with a second person (`dr verify-restore … --mark` is the only path that writes `restore_verified_at`).
