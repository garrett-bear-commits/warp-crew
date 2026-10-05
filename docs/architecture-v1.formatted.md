# Game Foundation — Architecture v1

Status: decided; implementation evidence is tracked separately. Date: 2026-08-17. Owner: Nikolay.
Scope: the reusable **core** (server + web adapter + contracts + tooling) that is built first; **games are added
on top** afterwards. First platform is jest.com; switching platform must be one provider implementation.
Sources of truth for evidence: `docs/foundation-research/` (Barrowdeep deep-read, boilerplate read, design
panel, industry review + red-team, gap report) plus the official Jest references linked in §14. This document
contains current decisions, not a claim that every platform integration has passed.

---

## 1. Principles (the invariants ledger)

Each is a rule with an incident or a source behind it; each gets a test named after it.

1. **INSERT-only hot path for player state.** Refusals are stored with a reason; a refused write is HTTP 200
   `disposition: stored_refused` (a 4xx makes well-behaved clients retry a correct refusal forever).
2. **The server assigns `seq`** under a per-player advisory lock; the client's counter is diagnostic. No
   `ON CONFLICT DO NOTHING` on **player-state or ledger appends** — a lock breach throws instead of swallowing a
   write (command-row reservation deliberately uses it; see §4.1).
3. **A save may only get deeper.** `progress` is a game-supplied monotone ordinal (playtime or accepted-action
   count if the game has nothing better), a JavaScript safe integer `0 ≤ p ≤ 2^53−1` (validated; BIGINT in
   Postgres); the guard reads the newest **anchored** head *with a blob*, so a pruned tombstone can never block
   writes.
4. **Every stored write has an explicit disposition** — `anchored` | `stored_quarantined` | `stored_refused` |
   `duplicate` — and **deepest anchored in the active generation** is both the read anchor and the retention
   anchor. Quarantined rows are never the anchor and are never reported to the player as "saved to cloud".
5. **Generations are the only way backwards** (restart, admin restore, player restore-to-point, erasure). A
   newer generation always wins on the client.
6. **Identity fails closed.** Provider token verified before any player-keyed read/write; `no_secret` → 503,
   never open; alg pinned; `aud == GAME_ID` mandatory; `iat` window; secret rotation list; token age step-up
   for value commands.
7. **Money is signed facts only.** Provider receipt is the sole input; provider-token idempotency; signed
   `sandbox: true` is authoritative before price; checkout fails closed while delivery is disabled; disabled
   paid receipts remain provider-recoverable without creating ledger rows; bounded purchase grant keys hash
   provider tokens; the current schema keeps sandbox `granted = 0` pending owner approval because Jest's
   official guidance recommends delivering test items while excluding them from revenue; grant-before-confirm;
   promotions count delivered packs only; negative adjustments always reference an admin action.
8. **Client claims never mint premium value.** Everything the server reads out of a blob or a journal is a
   *claim*: rewards from claims are cosmetic/soft or budgeted; placements are provisional until reviewed.
9. **Grants are the one reward primitive** — server-authored, idempotently claimable, auditable, retroactive.
10. **The server is the truth for state; the local copy is operational truth during play.** Platform KV is a
    write-only mirror with a human-initiated break-glass read. Boot always performs a bounded server head
    check. Blocked ≠ empty.
11. **No platform writes before identity is ready**; the identity gates the server push and selects the local
    slot; nothing else waits on the SDK.
12. **Restore = write local → confirm → reload**, with one `restoring` gate consulted by every writer including
    the teardown push. Only the leader tab writes.
13. **Server clock.** `serverNow` in every response; offline/streak/timer credit = `min(deviceGap,
    serverGap + tolerance)`; `Date.now` is banned outside the clock module.
14. **Engine purity.** `apply`/`step` take an injected `now`/`rng`; two seeded streams (`sim`, `cosmetic`);
    the journal records inputs; offline never advances `progressOf`.
15. **Refusal, outage and degraded mode are product contracts**: an outage never blocks play, purchase grant or
    local save; the player can see sync status.
16. **Ops truth lives in tables**: `commands` (duration/result), ledgers, `/health/ops?assert=1` as the pager,
    the scariest query runs at boot, migrations are checksummed and locked, PITR is on and restore-verified.

---

## 2. System overview

```
UI (per game)            renders state · plays effects[] · never resolves
Engine (per game)        Engine<S,A,E>: newState · apply · step? · progressOf · summary   — pure, seeded
Web adapter (core)       @foundation/client: state lifecycle, storage, sync, journal, providers, hooks
Server (core, per game)  @foundation/server: CQRS spine, ledgers, features, live-ops, admin — one deployment per game
Platform provider        Jest (identity · payments · notifications · KV mirror) | mock | future web
```

- **Per-game deployment**: the same server image + `games/<id>/` config + secrets → one Railway service + one
  Postgres per game; the client is preferably one self-hosted URL origin with `/v1` reverse-proxied on that
  origin. Jest officially supports registering that URL as a version and loads it verbatim in the iframe;
  real shell/framing/CORS behavior remains an external gate.
- **Not in scope**: real-time multiplayer with an authoritative sim (separate app on the same core), tenancy,
  compliance work (Jest-only launch), a tick-engine package (an engine implements `step`; helpers later).

---

## 3. Repository and packages

Private pnpm monorepo, Node 24 LTS (native type stripping), TypeScript 5.9, vitest everywhere.

```
foundation/
├── apps/
│   ├── server/            composition root; games/<id>/ (game.config.ts, policy.ts, content/, .env.example, railway.json)
│   ├── template-game/     counter/idle game exercising every core path (acceptance suite)
│   └── <game>/            real games live here (game #2 first)
├── packages/
│   ├── contracts/         TypeBox schemas + Static types + closed enums + fixtures + CONTRACT_VERSION (isomorphic)
│   ├── server/            server core: cqrs (typed bus), db, migrate, auth, limits, cors, health, jobs, outbox, features/*
│   ├── client/            web adapter: engine contract, loop, storage, sync, journal, clock, providers, react hooks
│   ├── jest-verify/       node-only verifiers (player token, receipts) — never imported by browser code
│   ├── tooling/           vite defines, deploy (hashed assets, in-place, hash-verified), preflight, check-health, new-server, new-feature
│   └── testkit/           PG testcontainer, FakeClock, fakeFetch, mock provider pathologies
└── docs/  adr/  runbooks/  slo.md  threat-model.md  capacity.md
```

Rules: a feature may import another feature's **`contract`** entry point (types, schemas, event kinds) but never
its `server` or `client` implementation (lint); every feature has three entry points (`contract` isomorphic /
`server` / `client`) enforced by `exports`; browser bundles contain zero node modules and zero TypeBox runtime
(`Static<>` is erased; guards are generated if needed); one CI job builds the template game and gates its bundle
size.

Borrowed from `marcoturi/fastify-boilerplate` (MIT, attributed in `NOTICE`): env-schema config, error envelope
+ exception taxonomy, request-context + pino correlation ids, TypeBox type-provider + swagger transform,
`buildApp()`/`inject()` test harness on real Postgres, Dockerfile, the typed command/query bus shape (re-implemented,
see ADR-004). Left behind: GraphQL, Awilix, `SqlRepositoryBase`, filename-glob registration, the
error-swallowing event bus, semantic-release, Renovate automerge, Biome-as-gate.

Lifted (copied, renamed, generalised, with their tests) from Barrowdeep: `server/src/domain/*` (placement guard,
token verifier, receipt verifier, ledger rules, rate limiter, ops thresholds), repository SQL and migrations,
`save.ts` storage adapters/ratchet/reconcile, `jestSdk.ts` split into provider instances, `loop.ts`. Player
identifiers in incident comments are scrubbed on the way in.

---

## 4. Server

### 4.1 CQRS spine

- **Two halves, never mixed.** *Client input* = `{ type, commandId, payload }` (validated by the command's
  TypeBox schema; `commandId` minted and persisted client-side before the first attempt and reused verbatim on
  retries). *Execution context* = `{ gameId, actor, playerKey?, adminKeyId?, requestId, now, buildVersion }`,
  derived **server-side** from the deployment, the verified token/admin key and the request — a client can never
  supply `actor`, `gameId`, `playerKey` or `adminKeyId`. **Idempotency vocabulary** (one meaning each):
  `commandId` = transport idempotency on *every* mutation (admin `Idempotency-Key` header maps directly to it);
  `requestId` (`x-request-id`) = correlation only, server-generated or forwarded, never idempotency state; named
  durable **business keys** where the fact itself must be unique — `restartId` (lineage), provider token
  (purchases), `grantKey` (grants), `runId` (leaderboards). `request_hash` = SHA-256 over
  `{commandType, canonicalPayload}` (auth and transport fields excluded), so the same `commandId` reused for a
  different command type can never replay another command's result; every payload field, including `reason`, is
  frozen for a retried `commandId` on both the normal and the beacon route.
- **Command definition** (`defineCommand`): `type`, `schema`, `actorPolicy` (`player` | `admin(scope)` | `ops` |
  `job` | `system`), `scope` (`player` | `game` | `global`), `lock` (`player` | `game` | `none`), `idempotency`
  (`owner: client | system | none`, `retention`), `tx` (`required` | `none`), `limit?`, `stepUp?`. Jobs, config
  publication, season close and cohort grants are `scope: game`/`global` with a `game` lock or none; only
  player-scoped commands take the per-player advisory lock.
- **Typed command bus**: registry keyed by the command *definition object*; handlers registered explicitly in
  the composition root; boot asserts every declared command has exactly one handler. Middleware onion:
  validate → authenticate/authorize per `actorPolicy` → rate limit → trace → open tx + take the declared lock →
  **reserve the `commands` row** (`INSERT … ON CONFLICT DO NOTHING RETURNING`) → handler → finalise the reserved
  row → commit, all in one transaction. Because reservation and finalisation share the transaction, a concurrent
  duplicate's INSERT **waits** on the unique index until the first transaction commits or rolls back (bounded by
  `lock_timeout`/`statement_timeout` → 503 `retry_later`); after the wait it reads the committed row: same
  `request_hash` → replay the stored result; different hash → 422 `idempotency_mismatch`. There is no
  `in_progress` state. Uniqueness is `(scope_key, command_id)` where `scope_key` = player key for player-scoped
  commands or `'game'` for game/global-scoped commands (the database already holds exactly one game and one
  environment). Routes, jobs, admin and tests all dispatch through it. **Query bus** likewise (typed, explicit)
  reads projections only.
- **One transaction per command**: pure decision → INSERT ledgers/snapshots → UPSERT projections → INSERT
  outbox → finalise `commands` row `{command_id, type, scope_key, actor, request_hash, status, result,
  trace_id, duration_ms}`. Retention: the *full* row (result, trace) per definition (saves 7 d, money 90 d,
  admin 1 y); a **minimal idempotency tombstone** `command_tombstones(scope_key, command_id, type,
  request_hash, outcome_ref)` is kept **for as long as the ledger fact it produced exists** (a snapshot keeps its
  `command_id` until pruned), so a client that was offline for weeks and retries an old `commandId` receives
  `duplicate` + the original `seq` instead of colliding with the snapshot constraint. Test: "offline > 7 days,
  retry old commandId → duplicate, no 500".
- **Ledgers are the event history** (no generic event store): `save_snapshots`, `generations`,
  `purchase_transactions`, `purchase_adjustments`, `grants`/`grant_claims`, `grant_key_aliases`
  (migration-owned legacy purchase compatibility), `leaderboard_submissions`, `journal_entries`,
  `commands`, `integrity_events`. The inspector timeline is a `UNION` view.
  `rebuild-projection <name>` exists for every projection that is a pure function of ledgers (overview,
  entitlements, entries, achievement_progress).
- **Outbox** is the only fan-out: rows written in the originating tx; delivery state is **per consumer**
  (`outbox_deliveries(outbox_id, consumer, state, attempts, lease_until, last_error, delivered_at)`), drained by
  a job that takes a lease per (row, consumer), retries with bounded backoff, moves exhausted rows to
  `outbox_dead_letters` (ops alert), and supports `outbox.replay(id, consumer)`. **Reactions never write ledgers
  directly**: a reaction that mints a grant or sends a letter dispatches a deterministic *system* command with
  `commandId = outbox:<id>:<consumer>` through the bus, so redelivery is idempotent by construction. No
  in-process pub/sub that can swallow errors.

### 4.2 Cross-cutting

- **Config**: env-schema; `DATABASE_URL`, `PGSSL` (verify or private URL), `PG_POOL`, `PORT`, `GAME_ID`,
  `GAME_ENV` (`prod|lab|dev`), provider secrets by name (`JEST_JWS_SECRETS` list for rotation), `ADMIN_KEYS`
  (`{keyId: sha256(secret), scope}`), `OPS_SECRET`, `RATE_LIMIT_STORE`, `SENTRY_DSN`. QA routes register only
  when `GAME_ENV=lab`. `GAME_ID`/`GAME_ENV` are deployment configuration only (audience verification, game
  config selection, logs/metrics/release metadata, fleet tooling); they are never persisted on rows — the
  database itself belongs to exactly one game and one environment (ADR-003).
- **Auth**: `requirePlayer` (claimed key from header, `Bearer` provider token, `IdentityVerifier` tried across
  the secret list; `iat ≤ 5 min` step-up for `lineage.*`, `restoreToSeq`, `grants.claim`;
  per-game `maxTokenAgeSec`), `requireAdmin` (key id + secret, timing-safe, scopes `read | support | grant | publish | restore | erase`
  (letters need `support`, config/content publication needs `publish`),
  `Idempotency-Key` on writes = the command's `commandId`, every call audited), `requireOps`.
- **Rate limits** (PG store **required in `GAME_ENV=prod`**; memory store is dev/lab only and config validation
  refuses it in prod): per-player on writes; **per-IP ceilings on authed writes** (~10× per
  player) and on auth failures; `trustProxy: 1`; `registered` gate for codes/board visibility/referral credit.
- **CORS + transport**: allowlist = our client host + Jest per-game host pattern; `text/plain` JSON parser;
  **`POST /v1/saves/beacon`** accepts auth inside a `text/plain` body with zero custom headers (the teardown path
  is not preflighted); `bodyLimit` from policy.
- **Encoded blobs (`gzip+b64`)** are decoded under independent limits: encoded ≤ `maxEncodedBytes`, decoded ≤
  `maxBlobBytes`, expansion ratio ≤ 20×, streaming inflate with a byte counter and a decode-time budget that
  aborts; `bytes` and `blob_sha256` always refer to the **canonical decoded UTF-8 JSON**, `enc_bytes` is stored
  beside them; decompression-bomb fixtures are part of the route tests.
- **Errors**: one envelope `{error, message?, correlationId, details?}` with a closed `ErrorCode` union;
  domain soft outcomes are 200 with an explicit `disposition`/`reason`.
- **Health**: `/health` liveness; `/health/ready` (`SELECT 1`, migrations at head, secrets present with byte
  length, admin keys count) for the platform check; `/health/ops` snapshot from a 15-minute rollup with
  two-tier `?assert=page|warn` (503 on any page-tier issue).
- **Jobs**: prune, outbox drain, season autoclose, rate-window sweep, economy anomaly (nightly), restore-verify
  (weekly), retention sweeps — `setInterval().unref()` under a per-job advisory lock, heartbeats written to a
  `job_runs` table.
- **Migrations**: run **as a deployment step with the `migrator` role** (`migrate --up` in the release
  command / Railway pre-deploy), one tx per file, SHA-256 checksums, `pg_advisory_lock` around the run,
  `lock_timeout 3s`, N-1 compatibility rule (expand/contract, renames via views; extras declare
  `-- foundation-n1-compatible-with-ordinal: N` for one prior image `expectedHead`, with extra checksums and result
  heads — not inferred from a `migrateUp` batch);
  **application boot checks** applied rows against this image's files and refuses to serve on pending known files,
  checksum mismatch, undeclared extras, a gapped/duplicate ordinal chain (preflighted before SQL), or applied rows that
  are not a prefix of disk files; isolated restore requires exact head match; `--check` diffs a fresh DB against
  `schema.sql`; `--repair` recomputes n1 declaration heads.
- **DB roles**: `migrator` (DDL, owns `SECURITY DEFINER` functions) and `app` with narrowly enumerated
  authority: INSERT/SELECT on ledgers and snapshots; UPDATE on `commands` (finalise the reserved row only —
  column-level grant on `status, result, duration_ms, trace_id`), on projection tables, on
  `outbox_deliveries` (lease/finalise) and `job_runs`; UPDATE/DELETE on ledger and snapshot tables only through
  scoped `SECURITY DEFINER` functions (`prune_save_blobs()`, `apply_retention()`, `erase_player()`,
  `promote_snapshot()`); `REVOKE DELETE, UPDATE` on ledger tables from `app`; raise-triggers as a second fence.

### 4.3 Features (modules)

Each feature = folder with `register(app, ctx)`, `contract`/`server`/`client` entry points, own migrations
(namespaced tables), own tests and a template-game scenario. Composed per game in `game.config.ts`.

| Feature | What it owns | Notes |
|---|---|---|
| **identity** | `IdentityVerifier` plug (Jest HS256, mock), `players` projection (first/last seen, registered, build, entry payload allowlisted) | provider-switch point |
| **saves** | `save_snapshots` (+ `save_blobs`), placement guard, deepest anchor, retention, history, blob-by-seq, admin restore via lineage, `schema_downgrade` + `progress_jump` flags | ADR-006 |
| **lineage** | `generations` (restart / admin_restore / player_restore / reattach / erased), CAS by `expectedGeneration`, business key `restartId`, entitlement only for `kind='restart'` | ADR-006 |
| **purchases** | receipt verify (provider), `purchase_transactions`, `purchase_adjustments` (±), classification, per-pack promotions, `/purchases/mine`, Financials import (dry-run, reclassify), `player_flags` consumers | ADR-007 |
| **grants** | `grants` + `grant_claims` + read-only legacy purchase-key aliases, typed reward payload union, caps, batch claim, `reason`/`ticket_ref`, `mintForCohort` (dry-run count), codes/campaigns | ADR-008 |
| **achievements / quests** | one server evaluator over ledgers + `summary` + journal events; definitions as **published content documents**; criteria sources tagged `server_fact` vs `client_claim`; `achievement_progress` projection (rebuildable); client runs the same evaluator for preview | ADR-008, ADR-012 |
| **leaderboards** | seasons on the schedule primitive, `rules_version` pin, `run_id` idempotency, `leaderboards.start` stamps `started_at`, `visibility` enum + quarantine, verification levels (1 sanity, 2 duration+summary bounds, 3 replay = interface only), placements minted provisional, moderated names | |
| **inbox** | support letters (append-only, may reference a grant), announcements (schedule + segment), server-side read/claimed state, feedback with status | |
| **liveops** | `config` (typed flag registry with rollout %/sticky hash/activate-at-session-boundary/shadow), `schedules`, `segments` (JSON predicates over declared facts, preview count), `content_versions` (publish-lab/prod, diff, revert), kill switches per SKU/command, `minBuildVersion` + per-item `minBuild`, `serverNow` | ADR-012 |
| **telemetry** | allow-listed `integrity_events` (≤20/call, daily budget, 30 d), request-id joins | no general analytics ingest |
| **journal** | `journal_entries` (partitioned 90 d, per-call/day caps, `fromSeq` monotonic, kind allowlist per build), repro bundle assembly | ADR-016 |
| **admin** | `admin_actions` replay, player overview, inspector (timeline · JSON viewer · restore-to-seq · the five write actions: letter, grant, cohort grant, publish, restore), erase (generation `erased`), scoped keys, separate origin + strict CSP | |
| **qa** (lab only) | `qa_` identity mint, sanitised snapshot import as a `lineage_seed`, `X-Config-Preview` (later) | |

Providers (interfaces, one implementation each): browser-side `IdentityClient`, `PaymentsProvider`,
`NotificationsProvider`, `PlatformKV`, `ErrorSink`; server-side `IdentityVerifier` and `PaymentsVerifier` (in
`jest-verify`). Jest and
mock ship in v1; a conformance suite drives the mock through every path a real provider must pass.

### 4.4 Data model (summary)

```
save_snapshots(id, player_key, slot='main', generation, seq, client_seq, base_seq, session_id,
               command_id, progress BIGINT NOT NULL (safe integer), client_progress, saved_at, received_at,
               bytes /* canonical decoded UTF-8 length */, enc_bytes, blob_sha256 /* of canonical decoded JSON */,
               schema_version, build_version, source, disposition, reject_reason, flags TEXT[], rank_hint NUMERIC[],
               summary JSONB, enc, reason ('autosave'|'timer'|'teardown'|'important'|'restore'|'boot-retry'),
               UNIQUE(player_key,seq), UNIQUE(player_key,command_id))
save_blobs(save_id PK, blob BYTEA)                       -- pruned via SECURITY DEFINER prune_save_blobs(); refused blobs kept for first N/hour only
generations(player_key, generation, kind, restart_id /* business key; NULL for non-restart kinds */, seed_seq, entitlement, opened_at)
commands(scope_key, command_id, type, actor, request_hash, status, result, trace_id, received_at, duration_ms)
command_tombstones(scope_key, command_id, type, request_hash, outcome_ref)
save_reviews(player_key, save_id UNIQUE, action promote|reject, actor, rule_version, reason, previous_anchor_seq, at)   -- terminal: one review per save, never revised
outbox · outbox_deliveries(outbox_id, consumer, state, attempts, lease_until, last_error, delivered_at) · outbox_dead_letters
purchase_transactions · purchase_adjustments · grants · grant_claims · grant_key_aliases · codes · code_campaigns
leaderboard_seasons · leaderboard_submissions · leaderboard_entries · leaderboard_placements · display_names
support_messages · announcements · announcement_reads · feedback
config_flags · content_versions · schedules · segments · player_flags
journal_entries (monthly partitions) · integrity_events · job_runs · admin_actions · erasures · players
```
Retention: `commands` full rows 7 d (saves) / 90 d (money) / 1 y (admin), `command_tombstones` as long as the
produced fact exists; journal 90 d; integrity 30 d; snapshots: newest K, one per day
for D days, deepest per generation for the last G generations + purchase-bearing (never pruned).

---

## 5. Client web adapter

### 5.1 Engine contract

```ts
interface Engine<S, A, E> {
  newState(init: NewStateInit): S;
  apply(state: S, action: A, ctx: Ctx): { state: S; effects: E[] };   // turn-based: match-3, card, puzzle
  step?(state: S, dtTicks: number, ctx: Ctx): { state: S; effects: E[] }; // idle / TD / delve sims
  isPaused?(state: S): boolean;                                       // re-checked every tick by the adapter
  onGap?(state: S, gap: { deviceSec: number; serverSec: number }, ctx: Ctx): { state: S; effects: E[] }; // MUST NOT raise progressOf
  settle?(state: S, ctx: Ctx): S;                                     // wall-clock hand-offs
  progressOf(state: S): number;                                       // monotone ordinal (required)
  summary?(state: S): Summary;                                        // the only fields the server may read
}
interface Ctx { now: number /* server-anchored */; rng: Rng /* sim stream */; tick: number; catchUp: boolean }
type Effect = { kind: string; tick: number; ttlTicks?: number; payload?: unknown }   // bounded ring; dropped under catch-up
```
Mutation model: in-place inside `apply/step`, the adapter publishes `{state, rev}`; selectors via `useState(selector)`.
Per-genre tick assumptions: idle 2–10 tps; TD fixed 20–30 tps + interpolation; match-3 turn-based. Anything the
player must acknowledge lives in state, never in effects. `loop.ts` (rAF accumulator, catch-up cap, big-gap
hand-off) ships in the adapter.

### 5.2 State lifecycle

- **Boot machine**: `booting → identityReady → checkingCloud → reconciled → live`. Open the origin-scoped
  `lastKnownPlayerId` slot read-only for instant paint; when identity confirms: read local slot + **always** a
  bounded server head check (`GET /saves/current?meta=1`, ≤ 800 ms) — adopt if deeper and local clean, prompt if
  dirty, `checkingCloud` spinner with a ~3 s timeout when the cache is empty for a returning identity ("cloud
  unreachable — retry / start new"); re-check on `visible` after a long hide; re-push last unacked snapshot before
  offline credit.
- **Storage tiers**: **localStorage primary** (sync, teardown-safe) → memory shim; `storageMode()` reported;
  IndexedDB only for the journal spool; `navigator.storage.persist()` once. Platform KV = **write-only mirror**
  on the normal path (never read at boot, never reconciled) plus one **break-glass path**: a human-initiated
  "Recover from platform copy" in the restore panel reads the KV once, trial-deserialises, and goes through the
  forward-only restore (or a player restore-to-point generation bump) — that read path is what makes the mirror
  a recovery copy rather than a write sink. Under URL hosting the origin is cross-site to jest.com, so
  partitioned/blocked local storage is a *normal* case: the design assumes the local cache can be empty at any
  boot.
- **Sync**: engine commits only **mark state dirty** (never a synchronous `localStorage` write per 20–30 TPS
  step); the local autosave persists dirty state every 10 s and on important events; server push on `pagehide`/`visibilitychange→hidden` (via the beacon
  route, save first, ≤ 64 KiB, encoded asynchronously on the autosave path and cached), on a **60 s state-driven
  timer**, on important events (purchase, claim, generation change), after restore. `SaveWriteBody` carries
  `commandId` (minted with the encoded snapshot, persisted in the cache envelope before the first attempt,
  reused verbatim on every retry incl. the beacon and boot re-push), `generation, clientSeq, baseSeq, sessionId,
  progress, savedAt, schemaVersion, buildVersion, enc, reason, blob`; metadata is derived from the encoded
  snapshot. Verdicts: `synced | synced_quarantined | synced_divergent | duplicate | refused_regression |
  refused_stale_generation | refused_malformed | unauthorized | update_required | throttled | rejected_transport
  | unreachable | server_behind | erased | no_token | disabled`. Only `synced` shows "saved to cloud". Sync
  metadata lives in the cache envelope, not in `S`.
- **Generations**: on `stale_generation` or a newer generation at boot: push once (stored, refused → reversible),
  adopt server head regardless of depth, reset ratchet floor (keyed `playerId+generation`), drop old-generation
  queued ops, broadcast. `server_behind` → stop pushing, alarm, `lineage.reattach` when the operator enables it.
- **Restore**: player forward-only (trial-deserialise, deeper only, push current → write local → confirm →
  reload under one `restoring` gate); restore-to-point and admin restore = generation bump with a seed row.
- **Identity switch** (guest → older account): provider retains the previous token for one use;
  `onIdentityChanged(prev, next)` pushes the guest's final snapshot under `prev`; trivial-target adopt / "keep
  which?" prompt / admin path with proof.
- **Multi-tab**: Web Locks leader; follower read-only with "Play here"; the ratchet, not the lock, is the safety
  mechanism.
- **Journal**: records **inputs** `{tick, now, kind: action|settle|gap, name, args?}`; args only for actions
  with a bounded schema (no free text); ring bounded in bytes (32 KiB) persisted on autosave; shipped on the
  timer path (≤ 16 KiB per call), never at teardown; `game_error` breadcrumbs = last 20 `name+tick`.
- **Clock**: `client/clock` keeps a median RTT-filtered offset from `serverNow`; `now()` is server-anchored;
  offline credit = `min(deviceGap, serverGap + tolerance)`; monotonic marks for `hiddenMs`.
- **Player-visible sync status**: "Saved to cloud 42 s ago" / "Cloud unavailable — saving on this device" /
  "Not saving on this device — cloud only".

### 5.3 Providers and React

`PlatformAdapter = { identity, kv, payments, notifications, share, analytics, loading, lifecycle, errors }` with
`createJestPlatform()`, `createMockPlatform(pathologies)`, `createStandalonePlatform()`. React package:
`PlatformProvider`, `LoadingGate`, `RegistrationGate`, `ErrorBoundary`, `useSaveSync`, `useVisibility`,
`useTeardown`, `useTickScheduler`, `useEffects(kinds)`, `defineModals` + one Z table, `MaintenanceScreen`,
`UpdateBanner`, `Inbox`, `SyncPill`, `PrivacyPanel` (diagnostics toggle only).

---

## 6. Protocol (contracts package)

- Headers on authenticated calls: `x-player-key`, `authorization: Bearer <token>`, `x-request-id` (correlation
  only); the beacon route carries them in the body instead. Every mutating body carries a client-minted
  `commandId` (durable idempotency key). `serverNow` in every response.
- Saves: `PUT /v1/saves` (200 always: `{disposition, reason?, flags?, seq, currentProgress, generation,
  blobSha256, divergent?: {headSeq, headSummary, headWriterAt}, requestId, serverNow}`), `POST /v1/saves/beacon`
  (same body + `auth`),
  `GET /v1/saves/current[?meta=1]` (snapshot | `{empty:true, generation, lineage?}`, plus `pendingQuarantine?`),
  `GET /v1/saves/history`,
  `GET /v1/saves/history/:seq/blob`.
- Lineage: `POST /v1/lineage/restart {commandId, restartId, expectedGeneration}` → receipt | 409 `stale_generation`;
  `restoreToSeq {commandId, seq, expectedGeneration}`, `reattach {commandId, clientGeneration, expectedServerGeneration, snapshot}`.
- Purchases: `POST /v1/purchases/verify {commandId, purchaseSigned}` (business key = provider token inside the
  receipt), `GET /v1/purchases/mine`; adjustments delivered as `pendingAdjustments[]` applied before play and
  acked with `POST /v1/purchases/adjustments/ack {commandId, adjustmentIds[]}`.
- Grants: `GET /v1/grants/pending`, `POST /v1/grants/claim {commandId, grantKey}` (same payload on repeat),
  `POST /v1/codes/redeem {commandId, code}`.
- Every mutation body carries `commandId`; the contracts package enforces it with a shared `MutationBody` base
  schema and a test that iterates every command definition.
- Live-ops: `GET /v1/config` (public: switches, `minBuildVersion`, `serverNow`, content versions; authed:
  per-player flag values after identity), `GET /v1/inbox`, `GET /v1/schedules`.
- Leaderboards: `start {commandId, runId}`, `submit {commandId, runId, score, proof?}`, `/top` (public, no ids),
  `/me`, placements claim `{commandId, receiptId}`.
- Errors: closed `ErrorCode` union; `426 build_too_old`; refusals are 200 with reason.
- Versioning: additive within `/v1`; `CONTRACT_VERSION` advertised in `/health`; legacy-client fixture replay in CI
  for the last N client builds.

---

## 7. Integrity and money rules

- Criteria sources are tagged: `server_fact` (purchases, placements after review, `seenDays`, server-stamped
  claims) vs `client_claim` (`progress`, `summary`, journal events). Client-claim rewards are cosmetic/soft or
  capped by a declared per-player lifetime budget enforced in `grants.mint`; rebuilds honour budgets and flags.
- **Disposition, not a boolean.** `disposition ∈ {anchored, stored_quarantined, stored_refused, duplicate}` +
  `flags[]` (`progress_jump`, `implausible_summary`, `schema_unknown`, `schema_downgrade`, `clock_skew`).
  Quarantined rows: never the anchor; the client verdict is `synced_quarantined` ("saved, pending review" —
  never "saved to cloud"). **Promotion is append-only, terminal and recoverable**: a `save_reviews(player_key,
  save_id, action: promote|reject, actor, rule_version, reason, previous_anchor_seq, at)` fact is
  appended — the snapshot row is never mutated — after **re-validation under the player lock** (row still
  present with a blob, still in the active generation, still ≥ the current anchor's progress). The review state
  machine is **terminal**: `pending → promoted`, `pending → rejected`, and **no `promoted → rejected`**
  (enforced by `UNIQUE(save_id)` on `save_reviews` plus a `BEFORE INSERT` function that raises when a review
  already exists); the anchor query treats "quarantined + review = promote" as anchored, and since a review is
  final the anchor can never fall back within a generation. **Undoing a promoted anchor opens a new
  generation** (`lineage.restoreToSeq` to the previous anchor, kind `admin_restore`) — never a same-generation
  rollback. Test: promote → client adopts → attempt reject ⇒ operation refused (`review_final`), or a new
  generation; the anchor of the old generation is unchanged. Promotion sources: (a) system, when a *deterministic*
  rule clears (e.g. `schema_unknown` clears the moment the game publishes `knownSchemaVersions` for that version;
  actor `system`, `rule_version` recorded), (b) supersession — a later anchored write makes it moot,
  (c) admin `saves.promote(seq)` / `saves.reject(seq)` from the inspector with reason. "Auto-promote after N
  consistent writes" is **deferred** until a quarantine-branch/head algorithm is defined. `GET /saves/current`
  exposes `pendingQuarantine: {seq, progress, flags, receivedAt}` when a quarantined row deeper than the anchor
  exists in the active generation, so a device without local storage learns that a newer save is awaiting review
  instead of silently receiving the old anchor. Per-game
  `maxProgressPerHour`; nightly economy z-score over declared `summary` scalars; impossible-gem check
  (`gems > lifetimePaid + Σgrants + maxEarnable(progress)`).
- `player_flags(purchases_disabled, boards_hidden, grants_frozen, strikes, until, reason, admin_key_id)`
  consulted by middleware; refunds → negative adjustment as an unconditional boot instruction, strikes escalate;
  entitlement for a restart = Σpaid − Σrefunded.
- Leaderboards: server-observed run duration, summary-bounded score, quarantine for top-N until review, close
  ignores quarantined and `boards_hidden`; server-issued seed for verified runs in the engine contract; level-3
  replay is an interface (`proof = {seed, buildVersion, inputs[]}`) a game may enable by shipping its engine into
  its own server deployment.
- Admin: scoped keys, separate origin + strict CSP for the inspector, `textContent` rendering, images by magic
  bytes, write attempts from read keys alert. Codes ≥ 40 bits after normalisation, per-campaign lock after K bad
  guesses; no secrets in client packages (lint).
- Threat model page: assets, who can lie, what it buys, detect vs prevent — one row per invariant.

---

## 8. Observability and operations

- **DB-native first**: `commands` gives p95 by type, refusal rates, RED counters; ledgers give purchases by
  class, outbox lag + dead-letter count (page-tier), rows/day by kind; `/health/ops` snapshot from a 15-min rollup, `?assert=page|warn` on an
  external monitor. PostHog via the platform for product analytics; SQL daily rollups (DAU, D1/D7/D30, payer
  conversion, claim rates) on the admin page if PostHog access lags.
- **Sentry (server)** for errors, transactions (sampled 2–5 %, 100 % 5xx), release tagging, uptime on
  `/health/ops?assert=page`, one cron monitor per game reading `job_runs`; `beforeSend` recursively scrubs auth,
  direct `purchaseSigned`, and batch `purchasesSigned` values. Client Sentry off unless the platform confirms a
  tunnel is acceptable; client errors go through `game_error` integrity events with breadcrumbs.
- **Logs**: pino JSON, `requestId`/`commandId`/`gameId`, hashed player key, direct/batch signed-receipt redaction;
  refusals `warn`, misconfiguration `error`.
- **DR**: PITR on Lab + prod from day one (Railway pgBackRest, opt-in, not retroactive), nightly dump to R2,
  **weekly automated restore verify** writing `restore_verified_at` (ops reads it), erasure ledger mirrored to
  R2 and replayed after any restore, `docs/slo.md`: 99.5 %/30 d, p95 < 300 ms, zero acknowledged saves lost during normal
  operation, disaster RPO ≤ 15 min, RTO ≤ 2 h. `server_behind` recovery via `lineage.reattach` runbook.
- **Wrong-target protection is operational, not schema-level**: Railway attaches each dedicated database to its
  own game/environment service (`DATABASE_URL` by reference); every backup, dump, export and QA snapshot carries
  a **manifest** `{game, env, takenAt, schemaHead, contractVersion}`; restore/import tooling validates the manifest
  against an **explicit destination** (`--game --env`) and refuses on mismatch before writing anything. No
  database-level tenant machinery.
- **Fleet**: `fleet.json` (one entry per game) consumed by check-health, deploy, restore-verify, cost line;
  promotion order Lab → smallest game → rest, pinned by image digest; App Sleeping off; on-call policy: only
  page-tier off-hours; failure-drill list with cadence.

---

## 9. Testing

1. Pure domain (placement guard, verifiers, assess, limiter, thresholds, tiers, prune plan, entitlement) +
   **property tests** on placement and **model-based tests** over the sync client + ratchet + generations
   against a "server truth" model — **in v1, not deferrable** (it tests the foundation's most important safety
   mechanism).
2. Route tests with fakes (`inject`), tokens minted in-test.
3. Integration on real Postgres (testcontainers / `DATABASE_URL_TEST`, CI on `postgres:16`): migrations from
   empty, prune, anchor ordering, lock serialisation, lineage CAS under concurrency, import/close idempotency,
   outbox drain, SIGTERM mid-write, concurrent duplicate receipt verify, **restore/import manifest mismatch**
   (dump from `game=A env=prod` refused against destination `game=B` or `env=lab`; QA snapshot import refused
   without a matching manifest).
4. Contract tests from shared fixtures both sides; `oasdiff breaking` vs last released tag; legacy-client
   fixture replay (recorded per client release tag).
5. Save corpus: each release contributes ≥ 5 sanitised saves; CI loads all through HEAD, round-trips, asserts
   `progressOf` monotone; codec fuzz.
6. Engine conformance kit (`step` and `apply`-only modes, action fuzz, golden stream WebKit vs Node measured).
7. Bench: k6 at 1×/5×/20× an assumed 1k-DAU game, spike, monthly 2 h soak on Lab; nightly p95 threshold.
8. **Real-browser acceptance** (Playwright on WebKit + Chromium, mobile emulation, and one physical-device
   pass): blocked/partitioned storage, `pagehide` → beacon delivered, hidden → resume with server head check,
   quarantined save shows "pending review", URL-hosted build executing inside a jest.com-shaped local iframe
   harness. Local Playwright/mock evidence is separate from the real Jest hosted emulator, Simulator, sandbox,
   and mobile-shell gates.
9. Smoke after deploy: `check-health --assert`, canary write/read with a Lab `qa_` identity.

---

## 10. Deployment

- **Server**: one image (`node:24-alpine`, dumb-init, non-root, HEALTHCHECK `/health/ready`) → one Railway
  service + Postgres per game per env (prod, lab); `GAME_ID` + secrets in env; `pnpm foundation new-server
  --game <id>` scaffolds `games/<id>/`; target < 1 h to `check-health --assert` green on Lab (+ a written
  half-day client checklist: game id, `aud`, secrets, PITR, Sentry project, monitor, host).
- **Client**: **URL-hosted, auto-updating** — hashed immutable assets + no-cache `index.html` on one static origin
  per game (Cloudflare Pages/R2 or the game's Railway service), `frame-ancestors https://jest.com
  https://*.jest.com`, in-place hash-verified deploy with `v/` history; register the full URL as a Jest
  self-hosted version, then preview/activate it in the Developer Console. Prefer same-origin `/v1` proxying.
  Running sessions: version-check banner + reload at safe points, `minBuildVersion`/426 for stragglers. Zip
  pipeline kept in `tooling` as a fallback. Verify framing, CORS, storage partitioning, SDK calls, and mobile
  behavior in the real hosted shell before review.
- **Rollout**: Lab → smallest game → rest; flags with rollout % and shadow mode are the canary for behaviour;
  cohort-based bundle serving is possible from our host.

---

## 11. Adding a game on top of the core

Checklist (this is what "game #2" does; the template game is the executable version):

1. `apps/<game>/`: engine implementing `Engine<S,A,E>` (two RNG streams, `progressOf`, `summary`, optional
   `step/onGap/settle`), codec (`defineSave` with numbered migrations), UI over state + effects.
2. `apps/server/games/<game>/`: `game.config.ts` (`features: [...]`, providers, catalog, boards, origins,
   retention, `maxProgressPerHour`, journal mode), `policy.ts` (`validateBlob`, `summary` extraction,
   `sanitizeForQa`, criteria budgets), `content/` (achievements, quests, daily rewards, offers, announcements as
   documents), `.env.example`, `railway.json`.
3. Journal allowlist + domain event schemas for anything achievements/quests should see.
4. Wire `createGameClient(gameConfig)` + `PlatformProvider` (Jest in prod, standalone on our QA host, mock in
   local tests); `JestSDK.init` before all other SDK calls; `LoadingGate` → `markGameLoaded` once;
   `RegistrationGate` with `login`; official lifecycle/data/entry-payload/analytics seams; comeback notifications
   for registered players; one SKU end-to-end (buy, recover, verify, restart entitlement); one board with a draft
   season; inbox; one code campaign.
5. Run the engine conformance kit, contribute saves to the corpus, add a legacy-fixture recording to CI.
6. `new-server` on Lab, `check-health --assert`, canary, storage-matrix afternoon on real devices, then prod.
7. `docs/analytics.md` for the game generated from the typed event registry.

Rule of thumb: *change what a mechanic says, costs, rewards or when = publish content, no deploy; add a mechanic =
feature folder + client UI + journal allowlist + summary hook + client deploy (auto-updating).*

---

## 12. Plan and estimate

| Phase | Weeks | Deliverable / gate |
|---|---|---|
| P0 feasibility + measure | 0.5 | **gates**: register and preview a self-hosted URL version, verify the real Jest shell's framing/CORS/storage behavior, and validate signed sandbox receipts (`sandbox` before price); production queries (accepted rows > 64 KiB; `save_backstop_unreachable.where`; teardown delivery by browser family), device storage matrix afternoon, remaining §14 verifications, record Railway backup/sleep settings |
| P1 scaffold + contracts | 1 | monorepo, CI (typecheck/unit/PG), `contracts` for every route incl. `commandId/baseSeq/sessionId/reason/disposition/beacon`, **hand-authored fixture examples** validated against the schemas (recordings from the real server are added at the end of P2), ops thresholds; gate: contract tests green against a stub server |
| P2 server core + features | 4.5–5 | spine (typed bus, tx/lock, idempotency, outbox, jobs, migrations, roles), identity + jest-verify, saves, lineage, purchases, grants, achievements evaluator + content docs, leaderboards (levels 1–2, quarantine), inbox, liveops (flags/schedules/segments/content), telemetry, journal, admin (inspector + five writes), qa; PITR + restore verify; Sentry; gate: `check-health --assert` on Lab, every copied Barrowdeep test has a counterpart, admin phone page can send a letter + grant |
| P3 client adapter | 3–3.5 | engine contract + loop, storage tiers, boot machine, sync (commandId, beacon, verdicts incl. quarantined, divergence), generations, restore, KV break-glass, identity switch, journal, clock, multi-tab, providers (Jest, mock, standalone), React hooks/shells, conformance kit, **model-based sync tests**, real-browser acceptance; gate: template game on the full stack incl. one daily reward, one windowed achievement, one scheduled sale, one announcement, one make-good from the admin page, one config publish without rebuild, one flag at 50 % |
| P4 ops, docs, drills | 1–1.5 | runbooks (restore drill, reattach, sale, cohort compensation, patch notes, hotfix value, pause SKU, Financials import, client release watch, outbox dead-letter replay), SLOs, threat model, capacity note, fleet.json, drills; gate: a second person runs each runbook |
| Integration + risk allowance | 3.5–4 | ≈ 30 % over the phase rows: cross-package integration, real-device findings from P0/P3, review rework, live-ops interrupts |
| **v1** | **≈ 14–16** | phase rows 10–11.5 + allowance 3.5–4 = 13.5–15.5, presented as 14–16. **v1-minimum ≈ 11.5–12.5**: defer offers/catalog versioning, subscriptions, `LeaderGate`, experiments, Lab preview headers — segments and announcements stay in v1 because P2/P3 gates depend on them; model-based tests are never deferred |

Deferred to v1.1: offers/catalog versioning, full criteria DSL (windows/resets/aggregations/tracks),
subscriptions (Jest beta), client wallet paid/earned/promo, server-side daily/streak + referral rules,
notification bank as content, experiments primitive (assignment + exposure only), Lab preview headers,
`LeaderGate` UX. (Segments, announcements and model-based sync tests are v1.) Reserved: server-authoritative wallet (trigger: currency buys ranked power), level-3 replay
runner, formal feature manifests (trigger: game #3 diverges), a tick-engine helper package.

---

## 13. Architecture decision records

Format: Context → Decision → Consequences. All dated 2026-08-17.

**ADR-001 Build the core; do not adopt a game BaaS.**
Context: identity is a Jest HS256 JWS and payments are Jest-signed receipts; no vendor validates either;
PlayFab ≈ $430/mo at Barrowdeep scale vs ≈ $15–35/game/mo here; GameSparks sunset; the save semantics we want
(history, refusals as evidence, deepest-not-newest, generations) exist in no vendor. Decision: build on Fastify 5 +
postgres.js + Railway; managed Postgres with PITR is the only rented piece. Consequences: we own the verifier,
ledger and history code (≈ 70 % of it already exists in Barrowdeep); revisit only if a vendor ships Jest support.

**ADR-002 Borrow patterns from `marcoturi/fastify-boilerplate`; do not adopt it as the chassis.**
Context: CRUD/DDD/GraphQL template, Node ≥ 24 / pnpm ≥ 11 / TS 6 / TypeBox 1 with Renovate automerge, degit
(no upstream), zero game-shaped parts. Decision: copy config, error envelope, request-context, TypeBox+swagger,
inject harness, Dockerfile and the typed bus *shape*; leave GraphQL, Awilix, `SqlRepositoryBase`, filename-glob
registration, its event bus, release tooling. Consequences: MIT attribution; our own pins; no upstream merges.

**ADR-003 One deployment and one database serve exactly one game and one environment.**
Context: 1–3 games, tiny team; blast radius and restore granularity per game; Jest is already the shared identity
layer. Decision: **one deployment and one database serve exactly one game and one environment. Multi-game
databases and tenancy are unsupported and are not a future design target.** Same image + `games/<id>/` + secrets
→ one service + one Postgres per game per env; no `game_id` on any row, key, index or query; `GAME_ID` exists only
as application configuration (audience verification, config selection, observability, fleet tooling).
Wrong-target protection is operational: Railway binds each database to its service; backup/export manifests name
their game and environment; restore/import tooling validates manifest and explicit destination before writing.
Consequences: N small services, `fleet.json` for ops; no per-request game resolution, no tenant tests, no RLS.

**ADR-004 CQRS with a typed command bus; ledgers are the event history.**
Context: explicit requirement for CQRS and extensibility; the review showed string-keyed glob registration fails
silently and a generic events table dual-writes without retention. Decision: typed bus keyed by definition
objects, explicit registration, boot assertion, middleware onion, one tx under the declared lock (player /
game / none); command definitions declare actor policy, scope, lock, idempotency owner + retention and tx
policy; client input is separated from the server-derived execution context and the `commands` row is reserved
before the handler runs; ledgers + `commands` + `journal_entries` are the history (UNION timeline), projections
rebuildable when pure; outbox with per-consumer leases, bounded retries, dead letters and replay for fan-out,
reactions dispatching deterministic system commands; no in-process pub/sub, no event-sourced state.
Consequences: same discipline for routes/jobs/admin/tests; greppable; no unbounded events table.

**ADR-005 The server is the truth for state; platform KV is a write-only mirror; localStorage is the local tier.**
Context: every Barrowdeep save disaster was a two-backend reconciliation; URL hosting makes local storage
partitioned/blocked for some players; the platform KV is a free third copy. Decision: server-first boot with a
bounded head check; localStorage primary + memory shim; KV mirror write-only on the normal path with a
human-initiated break-glass read via the restore machinery; IndexedDB only for the journal spool. Consequences: "empty cache" is a normal boot path with an explicit UI state; PITR + restore
verify are load-bearing.

**ADR-006 Append-only snapshots, server-assigned seq, required progress ordinal, generations for every backwards move.**
Context: rollbacks and refused-write loss in production; vendors ship LWW or CAS and leave merge to the game.
Decision: as §1 items 1–5; every stored write has an explicit disposition (`anchored | stored_quarantined |
stored_refused | duplicate`); the ordinal is a safe integer; saves carry a durable client `commandId`; divergence
is *detected* (`baseSeq`/`sessionId` → `divergent`) and surfaced, never refused on the backstop path; no client CAS. Consequences: restore, deepest-wins and history are simultaneously
true; the anchor needs flag-awareness (§7).

**ADR-007 Money is signed facts only; adjustments are unconditional; entitlement only on restart.**
Decision: receipt-only input, provider-token idempotency, schema-enforced sandbox rule, negative adjustments as
boot instructions with strikes and `player_flags`, entitlement = Σpaid − Σrefunded for `kind='restart'` only.

**ADR-008 Client claims never mint premium value; grants are the reward primitive.**
Decision: criteria sources tagged; client-claim rewards cosmetic/soft or budgeted; placements provisional;
flagged rows never the anchor; every reward is a grant. Consequences: achievements are still one content file,
with a `source` on each criterion.

**ADR-009 Server clock is an invariant.**
Decision: `serverNow` everywhere, `client/clock`, credit = `min(deviceGap, serverGap + tol)`, `Date.now` lint.

**ADR-010 URL-hosted, auto-updating client.**
Context: on Jest a zip release is build → upload → owner activation, all-or-nothing; Jest accepts a hosted URL.
Decision: host per game on our static host, hashed assets, no-cache index, version banner, `minBuildVersion`.
Consequences: instant rollback and cohort serving; cross-site storage partitioning (see ADR-005); confirm with
Jest as a supported review mode; zip kept as fallback.

**ADR-011 Observability = tables + pino + ops assert + Sentry (server); no self-run OTel stack.**
Decision: `commands`/ledgers answer most questions; Sentry for errors/perf/uptime; client errors via integrity
events; OTel not wired.

**ADR-012 Live-ops content is published documents; code is behaviour.**
Decision: achievements/quests/daily rewards/offers/announcements/notification copy as versioned documents with
in-bundle defaults, publish-lab/prod, diff, revert, `minBuild` per item; flags typed with rollout %; schedules and
segments as primitives. Consequences: what a mechanic says/costs/rewards/when changes without a deploy.

**ADR-013 Features are folders with a documented shape; providers are interfaces.**
Decision: no formal manifest layer in v1 (trigger: game #3 diverges); three entry points per feature enforced by
`exports`; features import only each other's `contract` entry, never implementations; provider switch = one
implementation + conformance suite.

**ADR-014 REST over JSON; no GraphQL; no streaming in v1.**
Decision: commands with hand-tuned status semantics; SSE "something changed → refetch" if push is ever needed;
GraphQL subscriptions rejected.

**ADR-015 Compliance work is out of v1; provider-switch ability is in.**
Decision: Jest-only launch; keep the admin erase route, `region` placeholder and redaction hygiene; nothing else
until a non-Jest platform or a request forces it.

**ADR-016 Journal is a debugging tool, not an event-sourced save; replay is honest.**
Decision: journal records inputs; two seeded streams; determinism measured (WebKit vs Node golden stream) before
promising server replay; repro = load snapshot N, replay, compare sha; "diverges at action N" is a valid outcome.

**ADR-017 No tick-engine package in v1; the engine contract carries `step`.**
Decision: `loop.ts` ships in the adapter; helper kernel later.

**ADR-018 No service worker / offline story.**
Decision: the host page must load anyway; SW registrations sit inside the ITP cap; "offline = server unreachable
with assets loaded".

**ADR-019 Refusal is 200, not 4xx.**
Decision: refusal as data so the client keeps the local copy and can surface a choice; 4xx reserved for transport,
auth, contract and precondition errors.

---

## 14. Open verifications and questions

Verify (P0, cheap): register/preview/activate a self-hosted URL version; real iframe framing, CORS, storage
partitioning, SDK bootstrap, and mobile behavior; signed sandbox flag and delivery/accounting behavior; whether
`<game>.builds.jest.com` is same-site with `jest.com`; Jest's third-party-request wording (client Sentry); Railway
log retention; Sentry Team monitor counts; the literal Jest game id and `aud`.

Decide (Nikolay): journal on by default for every game (`on | errors_only | off`); admin inspector as static
page vs small SPA; Node 24 / pnpm on the working machines; eslint+prettier (recommended) vs Biome; whether game
#2 needs subscriptions or offers in v1 (else v1.1); static host choice (Cloudflare Pages vs Railway static).

---

## Appendix — Interface sketches (compact)

```ts
// contracts
export const SaveWriteBody = Type.Object({ commandId: Uuid, generation, clientSeq, baseSeq, sessionId, progress: SafeInt, savedAt,
  schemaVersion, buildVersion, enc: Union('json','gzip+b64'), reason: Union('autosave','timer','teardown','important','restore','boot-retry'), blob }, { additionalProperties: false });
export const SaveWriteResult = Type.Object({ disposition: Union('anchored','stored_quarantined','stored_refused','duplicate'), reason: Optional(SaveRefusalReason),
  flags: Optional(Array(String)), seq, currentProgress: SafeInt, generation, blobSha256, divergent: Optional(Divergence), requestId, serverNow });

// server core
export function defineCommand<P, R>(def: {
  type: string; schema: TSchema;                       // client input only
  actorPolicy: 'player' | { admin: AdminScope /* 'read'|'support'|'grant'|'publish'|'restore'|'erase' */ } | 'ops' | 'job' | 'system';
  scope: 'player' | 'game' | 'global'; lock: 'player' | 'game' | 'none';
  idempotency: { owner: 'client' | 'system' | 'none'; retention: '7d' | '90d' | '1y' }; tx: 'required' | 'none';
  limit?: LimitKey; stepUp?: boolean }): CommandDef<P, R>;
export interface ExecCtx { gameId: string; actor: Actor; playerKey?: string; adminKeyId?: string; requestId: string; now: number; buildVersion?: string } // server-derived, never from the client
export interface CommandBus { register<P, R>(def: CommandDef<P, R>, handler: (input: P, ctx: ExecCtx, tx: Tx | null) => Promise<R>): void;
  execute<P, R>(def: CommandDef<P, R>, input: { commandId: string; payload: P }, ctx: ExecCtx): Promise<R>; assertComplete(): void }
export function withLock<T>(db: Db, lock: { kind: 'player'|'game'|'none'; key?: string }, fn: (tx: Tx) => Promise<T>): Promise<T>; // player lock = hashtext(playerKey); the database is already game-isolated
export function place(write: SaveWrite, head: StoredHead | null, last: LastRow | null, activeGeneration: number): Placement; // pure

// providers
export interface IdentityClient /* browser, packages/client */ { ready(): Promise<void>; isReady(): boolean; getPlayer(): Player | null; login(entryPayload?: Record<string, unknown>): Promise<void>; refreshCredential(): Promise<string | null>; tokenFor(playerId: string): string | null;
  previousToken(): { playerId: string; token: string } | null; onIdentityChanged(cb: (prev: Player | null, next: Player) => void): () => void }
export interface IdentityVerifier /* node, packages/jest-verify */ { verify(token: string, claimedKey: string, gameId: string, now: number): TokenResult }
export interface PaymentsVerifier /* node, packages/jest-verify */ { verifyReceipt(jws: string, gameId: string): ReceiptResult }
export interface PaymentsProvider { products(): Promise<Product[]>; begin(sku: string): Promise<PurchaseOutcome>; complete(token: string): Promise<PurchaseCompletionOutcome>; recoverIncompleteBatch(grant: GrantBatchFn): Promise<PurchaseRecoveryReport> }
export interface PlatformKV { set(key: string, value: string): void; delete(key: string): void; flush(): Promise<void>;
  readBreakGlass(key: string): Promise<string | null> }  // write-only mirror on the normal path; read only from the human-initiated recover flow
export interface NotificationsProvider { eligible(): boolean; scheduleLadder(items: LadderItem[]): Promise<ScheduleResult>; unschedule(identifier: string): Promise<void> } // Jest implementation maps this seam to scheduleNotification/unscheduleNotification

// client
export function createGameClient<S, A, E>(cfg: { engine: Engine<S, A, E>; codec: SaveCodec<S>; platform: PlatformAdapter; serverUrl: string; gameId: string;
  journal: 'on'|'errors_only'|'off'; kvMirror: 'mirror'|'off'; loop?: LoopOptions }): GameClient<S, A, E>;
export interface GameClient<S, A, E> { dispatch(action: A): void; state(): S; sync: SyncClient; effects: EffectRing<E>; clock: Clock; boot(): Promise<BootResult>; saveNow(reason: SaveReason): void }
```
