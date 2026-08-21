# ADR-031 Template game decisions (§11 executable checklist, §9 acceptance)

Date: 2026-08-18. Status: accepted. Platform documentation reviewed: 2026-08-20.

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
7. **Platform selection is a build concern in production and a URL concern only in local/test
   builds**: local mock/standalone scenarios may use `?platform=mock|jest|standalone`, `?player=<id>`,
   `?guest=1`, and `?pushMs=`. A production Jest build must not be switched away from Jest by an
   arbitrary query parameter. The mock platform's simulated lifecycle is replaced by the
   document's real visibility/pagehide events.
8. **The acceptance suite sets scenarios up through the admin/QA API directly** (fresh player id
   per spec; every mutation carries `commandId`; time from `serverNow`), so specs are independent
   and shared game-wide state (flags, minBuild, kill switches, seasons) is reset in `afterEach`.
   The quarantine spec's "schema 9" write is a schema-2 envelope whose `state.v` is 9 — the only
   way a quarantined row can be both `schema_unknown` on the server and adoptable by this build
   once promoted; the follow-up write from this build is then `schema_downgrade` → "pending review".
9. **Local acceptance is not Jest evidence.** Playwright runs against the local mock provider and
   local API/iframe harness. They prove game behavior and server contracts only; identity,
   registration, SDK lifecycle, notifications, Developer Console catalog values, sandbox receipts,
   Simulator behavior, and hosted-shell framing remain real-platform gates.
10. **Jest launch evidence is recorded separately.** The current platform docs require `login()`
    for registration, `markFirstMilestone()` for launch, startup incomplete-purchase recovery,
    and official notification payloads. The template documentation and runbook link the official
    references and identify the remaining hosted emulator/Simulator and sandbox checks.

## Consequences

- The template policy is the reference for "policy reads the codec envelope"; game #2 copies it.
- `test/unit/conformance-kit.ts` is the v1 engine conformance kit (apply-only / step-only /
  mixed, fast-check inputs, determinism per seed, onGap/settle invariants); games reuse it with
  their engine + action arbitrary.
- `pnpm -F @foundation/template-game test:e2e` builds with `VITE_API_URL=http://127.0.0.1:8090`
  and runs the local Playwright suite against mock/local infrastructure; it is not real Jest
  evidence. The API needs `DATABASE_URL_TEST` (or testcontainers).

## Current Jest references (reviewed 2026-08-20)

- [HTML5 SDK initialization](https://docs.jest.com/sdk/html5) — CDN script, `init`, and
  `autoLoginReminders`.
- [Player and data](https://docs.jest.com/sdk/html5/player) — exact signed identity and
  `JestSDK.data` methods.
- [Platform login](https://docs.jest.com/sdk/html5/platform-login) — guest registration and
  stable player ID.
- [App lifecycle](https://docs.jest.com/sdk/html5/app-lifecycle) — hide/show/exit hooks.
- [Notifications](https://docs.jest.com/sdk/html5/notifications) — seven-day scheduling limits,
  CTA/body/title limits, entry payload, identifiers, and approved assets.
- [Payments](https://docs.jest.com/sdk/html5/payments) — catalog, signed purchase unions,
  grant-before-confirm, and paged incomplete recovery.
- [Loading](https://docs.jest.com/sdk/html5/loading-screen) and
  [analytics](https://docs.jest.com/sdk/html5/analytics) — integer progress, `markGameLoaded`,
  `captureEvent`.
- [Launch checklist](https://docs.jest.com/launch-checklist) and
  [sandbox testing](https://docs.jest.com/testing/sandbox) — launch and real-platform evidence.
