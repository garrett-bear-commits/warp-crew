# ADR-031 Template game decisions (§11 executable checklist, §9 acceptance)

Date: 2026-08-18. Status: accepted.

## Context

`apps/template-game` is the executable version of §11 and the P3 gate: one build, one game
config, every core path exercised in a real browser (Chromium + WebKit) against the lab API on a
fresh Postgres. Building it surfaced a few places where the core and the game had to agree on
something the architecture left implicit.

## Decisions

1. **The server policy unwraps the codec envelope.** The client codec writes
   `{"schemaVersion": n, "state": …}` (ADR-029 #4); `apps/server/games/template/policy.ts` accepts
   that envelope _and_ a bare state (fixtures, older writers) and reports the schema from the
   game's own `state.v` — the field the migrations maintain — so a claim in the wire envelope
   never outranks the blob. `sanitizeForQa` keeps the envelope shape it was given.
2. **`state.v` is derived, not stored truth, on the client.** The codec's `decode` normalises every
   field the engine reads (a blob from history, the KV mirror or a promoted quarantined row can
   never crash the engine) and stamps `v = SCHEMA_VERSION`. `MIGRATIONS[k]` is keyed by the source
   schema `k` (defineSave semantics: k → k+1).
3. **`clock.now()` is an integer.** The wire contract's `EpochMs` is `Type.Integer`; a median
   offset built from `rtt/2` estimates is fractional, so the adapter's `now()` rounds
   (`packages/client/src/clock/index.ts`). Without this the first push after any `serverNow`
   sample was refused `validation_failed` (`/savedAt` "Expected integer").
4. **An idle engine with no producers is `isPaused`.** `step` is an exact no-op until the first
   auto-clicker exists, so the loop consumes no ticks and publishes nothing; otherwise every frame
   would mark the slot dirty and every reload against a deeper cloud would prompt instead of adopt.
5. **Update banner from the public config.** `/v1/config` is a public route (no 426 there); the
   game compares its build with `minBuildVersion` (same rule as the server, `src/versions.ts`)
   and shows `UpdateBanner` proactively; a 426 on any player call or a sync halt also shows it, and
   an authenticated 200 config after a halt calls `sync.resume()` (the build is acceptable again).
6. **Achievement unlocks may arrive from the server's own outbox reaction** to a save. After
   `POST /v1/achievements/evaluate` the game claims every unlocked achievement whose grant is still
   pending, not only this call's `unlocked[]`.
7. **Platform selection is a URL/build concern**: `?platform=mock|jest|standalone` (default
   `VITE_PLATFORM`, else mock), `?player=<id>` (else `localStorage['template:playerId']`, else a
   UUID; ids may not contain dots — mock tokens are dot-separated), `?guest=1` for an unregistered
   mock identity, `?pushMs=` to shorten the 60 s push timer in tests. The mock platform's simulated
   lifecycle is replaced by the document's real visibility/pagehide events.
8. **The acceptance suite sets scenarios up through the admin/QA API directly** (fresh player id
   per spec; every mutation carries `commandId`; time from `serverNow`), so specs are independent
   and shared game-wide state (flags, minBuild, kill switches, seasons) is reset in `afterEach`.
   The quarantine spec's "schema 9" write is a schema-2 envelope whose `state.v` is 9 — the only
   way a quarantined row can be both `schema_unknown` on the server and adoptable by this build
   once promoted; the follow-up write from this build is then `schema_downgrade` → "pending review".

## Consequences

- The template policy is the reference for "policy reads the codec envelope"; game #2 copies it.
- `test/unit/conformance-kit.ts` is the v1 engine conformance kit (apply-only / step-only /
  mixed, fast-check inputs, determinism per seed, onGap/settle invariants); games reuse it with
  their engine + action arbitrary.
- `pnpm -F @foundation/template-game test:e2e` builds with `VITE_API_URL=http://127.0.0.1:8090`
  and runs 13 specs × 2 browsers; the API needs `DATABASE_URL_TEST` (or testcontainers).
