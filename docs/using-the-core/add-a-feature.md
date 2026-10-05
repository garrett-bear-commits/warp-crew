# Add a feature or capability

## Choose the smallest extension seam

Before creating a feature, decide whether the change belongs in:

- game engine/UI code — game-specific rules or presentation;
- a published content document — definitions, copy, rewards, or timing;
- a typed flag/schedule — rollout, experiment shadowing, or a kill switch;
- an existing feature — another command/query in the same domain;
- a new core feature — reusable storage and behavior needed by multiple games.

Do not add a core feature for a one-game convenience.

## Scaffold a core feature

```bash
pnpm foundation new-feature --name <name>
```

The command creates `contract.ts`, `server.ts`, and `client.ts`. It does not register behavior automatically.

## Implementation sequence

1. **Contracts** — add TypeBox request/response schemas, closed enums, fixtures, and route definitions in
   `packages/contracts`. Every mutation extends the shared mutation schema.
2. **Domain decision** — keep the load-bearing decision pure where possible and test it directly.
3. **Persistence** — add append-only facts and rebuildable projections in a timestamped migration. Declare N-1
   compatibility and update `schema.sql`.
4. **Command/query definitions** — declare actor policy, scope, lock, idempotency retention, rate bucket, and
   step-up requirements. Do not trust identity fields from the payload.
5. **Server registration** — register handlers and routes explicitly. Add guards and jobs only when the feature
   owns them.
6. **Cross-feature effects** — emit an outbox fact. Consumers dispatch deterministic system commands rather than
   writing another feature's ledgers directly.
7. **Client entry** — expose a thin browser-safe API wrapper. Keep game-specific state application in the game.
8. **Composition** — register the feature in `packages/server/src/server.ts`, exports, `GameConfig`, the template
   scenario, and the feature-shape guard.
9. **Operations** — add health signals, admin action or runbook, retention, redaction, and failure recovery.

## Required tests

- schema and fixture validation;
- auth/scope/rate-limit branches;
- same-command replay, mismatched payload, concurrent execution, and tombstone replay where facts persist;
- real-Postgres transaction and permission behavior;
- outbox retry/lease/dead-letter behavior for reactions;
- client wrapper and one end-to-end template scenario;
- migration from empty and from the prior supported schema head.

Run `pnpm check`, PG, model, and browser suites before calling the feature reusable.
