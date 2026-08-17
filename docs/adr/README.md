# Architecture Decision Records

ADR-001 … ADR-019 are recorded verbatim in [`../architecture-v1.md`](../architecture-v1.md) §13 and are
not duplicated here. Records from ADR-020 onward are decisions taken while building v1 where the
architecture left a choice open (§14 "Decide") or where an ambiguity was resolved with the safest
minimal option.

Format: Context → Decision → Consequences. All dated 2026-08-17 unless stated.

| ADR | Title |
| --- | --- |
| [ADR-020](ADR-020-journal-default-errors-only.md) | Journal default is `errors_only`, configured per game |
| [ADR-021](ADR-021-admin-inspector-static-page.md) | Admin inspector is a static TypeScript page on a separate origin |
| [ADR-022](ADR-022-toolchain-pins.md) | Node 24 / pnpm 10 / TypeScript 5.9 pinned; ESLint + Prettier as gate |
| [ADR-023](ADR-023-provider-neutral-static-hosting.md) | Provider-neutral static hosting + zip fallback; no Cloudflare/Railway coupling in v1 |
| [ADR-024](ADR-024-purchase-minting-gate.md) | Real premium minting from receipts is off until the sandbox receipt shape is verified |
| [ADR-025](ADR-025-integration-tests-real-postgres.md) | Integration tests run on real Postgres 16 (Docker/testcontainers), never a fake |
| [ADR-026](ADR-026-command-idempotency-storage.md) | Idempotency: reserved commands row + tombstones, `request_hash` over `{type, canonicalPayload}` |
| [ADR-027](ADR-027-server-runs-typescript-natively.md) | Server packages run TypeScript source under Node 24 type stripping; no build step |
| [ADR-028](ADR-028-features-live-in-server-package.md) | Feature folders live under `packages/server/src/features/*` with three exported entry points |
| [ADR-029](ADR-029-client-sync-decisions.md) | Client sync decisions: sessionId per device slot, pending commandId replacement, refused_regression re-check |
| [ADR-030](ADR-030-tooling-and-inspector-decisions.md) | Content-addressed static releases; inspector retry keeps commandId on network/5xx only |
| [ADR-031](ADR-031-template-game-decisions.md) | Template game: policy unwraps the codec envelope, `state.v` derived, integer clock, isPaused idle, proactive update banner, e2e via admin API |
