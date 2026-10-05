# Architecture Decision Records

ADR-001 … ADR-019 are recorded verbatim in [`../architecture-v1.md`](../architecture-v1.md) §13 and are
not duplicated here. Records from ADR-020 onward are decisions taken while building v1 where the
architecture left a choice open (§14 "Decide") or where an ambiguity was resolved with the safest
minimal option.

Format: Context → Decision → Consequences. All dated 2026-08-17 unless stated. Records marked
2026-10-01 carry updates synced back from a production game built on this core.

| ADR | Title |
| --- | --- |
| [ADR-020](ADR-020-journal-default-errors-only.md) | Journal default is `errors_only`, configured per game |
| [ADR-021](ADR-021-admin-inspector-static-page.md) | Admin inspector is a static TypeScript page on a separate origin (2026-10-01: the admin origin forwards `/admin/v1/*`, optional Cloudflare Access check, sign-in gate) |
| [ADR-022](ADR-022-toolchain-pins.md) | Node 24 / pnpm 10 / TypeScript 5.9 pinned; ESLint + Prettier as gate |
| [ADR-023](ADR-023-provider-neutral-static-hosting.md) | Provider-neutral static hosting + zip fallback; no Cloudflare/Railway coupling in v1 (2026-10-01: optional pre-deploy migration CLI, Access check, Railway-backed admin key tool) |
| [ADR-024](ADR-024-purchase-minting-gate.md) | Real premium minting remains owner-gated pending real Jest payload validation (2026-10-01: per-game `mintSandbox`, migration `0016`) |
| [ADR-025](ADR-025-integration-tests-real-postgres.md) | Integration tests run on real Postgres 16 (Docker/testcontainers), never a fake |
| [ADR-026](ADR-026-command-idempotency-storage.md) | Idempotency: reserved commands row + tombstones, `request_hash` over `{type, canonicalPayload}` |
| [ADR-027](ADR-027-server-runs-typescript-natively.md) | Server packages run TypeScript source under Node 24 type stripping; no build step |
| [ADR-028](ADR-028-features-live-in-server-package.md) | Feature folders live under `packages/server/src/features/*` with three exported entry points |
| [ADR-029](ADR-029-client-sync-decisions.md) | Client sync decisions: sessionId per device slot, pending commandId replacement, refused_regression re-check; audit fixes F1 (identity rebind + retired sync), F3 (replay mapping), F8 (pendingQuarantine on empty heads), F9 (followers never mutate, leader decided before boot) |
| [ADR-030](ADR-030-tooling-and-inspector-decisions.md) | Content-addressed static releases; inspector retry keeps commandId on network/5xx only |
| [ADR-031](ADR-031-template-game-decisions.md) | Template game: policy unwraps the codec envelope, `state.v` derived, integer clock, isPaused idle, proactive update banner, e2e via admin API |
| [ADR-032](ADR-032-audit-fixes.md) | Decisions taken while fixing the v1 audit findings (replay semantics, TLS, lease tokens, DR markers, Sentry sampling, business-key locks) |
| [ADR-033](ADR-033-schema-n1-boot.md) | Schema boot compatibility is a declared N-1 extra for one prior image |
| [ADR-034](ADR-034-disposable-save-sessions.md) | Player-save takeover uses a disposable browser session |
