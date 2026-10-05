# ADR-022 Node 24 / pnpm 10 / TypeScript 5.9 pinned; ESLint + Prettier as gate

Date: 2026-08-17. Status: accepted.

## Context
§14 asked for Node 24 / pnpm on working machines and eslint+prettier vs Biome.

## Decision
`.nvmrc`/`.node-version` = 24, `packageManager: pnpm@10.30.1`, `engines` enforce both
(`engine-strict=true`). TypeScript is pinned to 5.9.3 exactly (`erasableSyntaxOnly` +
`verbatimModuleSyntax` so Node's native type stripping can run source directly, ADR-027).
ESLint 9 flat config + typescript-eslint + Prettier are the formatting/lint gate; Biome is not used.
Architecture invariants are lint rules: `Date.now` ban outside clock modules (ADR-009), feature
boundary rule (ADR-013), browser-safe import restrictions (§3).

## Consequences
One toolchain everywhere; `pnpm check` runs fmt → lint → typecheck → build → guards → tests.
