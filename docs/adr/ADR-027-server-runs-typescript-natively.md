# ADR-027 Server packages run TypeScript source under Node 24 type stripping; no build step

Date: 2026-08-17. Status: accepted.

## Context
§3: Node 24 LTS (native type stripping). A build step for node packages doubles the paths tests and
Docker have to agree on.

## Decision
All node packages export `./src/*.ts` directly; `node apps/server/src/main.ts` boots the server.
`erasableSyntaxOnly` forbids enums/namespaces/parameter properties. Relative imports carry `.ts`.
Workspace packages resolve through pnpm symlinks (realpath outside `node_modules`, so stripping
applies). Only browser bundles (template game, admin inspector) are built, by Vite.

## Consequences
The Docker image copies sources and `node_modules` (pruned to prod) and runs them as-is;
`typecheck` is `tsc --noEmit` per package.
