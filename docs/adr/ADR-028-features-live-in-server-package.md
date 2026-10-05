# ADR-028 Feature folders live under `packages/server/src/features/*` with three exported entry points

Date: 2026-08-17. Status: accepted (implements §3/§4.3, ADR-013).

## Context
The package list is fixed (contracts, server, client, jest-verify, tooling, testkit) and each
feature must expose contract / server / client entry points enforced by exports.

## Decision
`packages/server/src/features/<f>/{contract.ts,server.ts,client.ts}`; `packages/server` exports
`./features/*/contract|server|client`. `contract.ts` re-exports the feature's schemas/types/event
kinds from `@foundation/contracts` (types only for browser consumers). `client.ts` is a thin
browser-safe fetch wrapper (types only, no TypeBox runtime, no node builtins). `server.ts` exposes
`register(app, ctx)` and command definitions. Migrations are namespaced per feature under
`packages/server/src/db/migrations/NNN_<feature>_*.sql`. Cross-feature imports are limited to
`../<f>/contract` by ESLint (`foundation/feature-boundary`) and the `feature-shape` guard.

## Consequences
The template game imports feature clients from `@foundation/server/features/<f>/client`, which
the browser-safety guards verify pull no server code.
