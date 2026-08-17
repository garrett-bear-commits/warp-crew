# Threat model (§7) — one row per invariant

Assets: player state (saves), premium value (grants/entitlement), money facts (purchase ledgers), admin authority, provider secrets, player identity keys.

| Invariant | Who can lie | What it buys them | Detect vs prevent | Where enforced |
| --- | --- | --- | --- | --- |
| Identity fails closed | anyone with a player key | writing another player's save | prevent: provider-signed HS256 token, alg pinned, aud == GAME_ID, iat window, claimed key == sub; no secret → 503 | `packages/jest-verify/src/identity.ts`, `packages/server/src/auth/index.ts`, tests `verifiers.test.ts`, `saves.test.ts` |
| Money is signed facts only | client (any body field), replayed receipts | premium value / entitlement | prevent: only the JWS is read; provider token UNIQUE; sandbox never mints (schema CHECK); minting gated (ADR-024) | `purchases/server.ts`, migration 0004 CHECK, `money.test.ts` |
| Client claims never mint premium | client blob/summary/journal | premium from claims | prevent: criteria tagged; client_claim premium capped by lifetime budget in `mintGrant`; placements provisional until review; quarantine flags | `rewards/mint.ts`, `achievements/*`, `features.test.ts`, `infra.test.ts` |
| Save may only get deeper | old client / replayed writes | rollback of progress | prevent: placement guard (server-assigned seq, deepest anchor); refusals stored as data (200) | `saves/placement.ts` + property tests |
| Generations only way backwards | attacker with old generation | overwrite newer generation | prevent: stale_generation refusal; CAS on lineage; restartId business key | `lineage/server.ts`, `lineage.test.ts` |
| Quarantine never the anchor | client sending implausible states | "saved to cloud" of a bogus save | prevent + detect: flags → quarantine, terminal reviews (UNIQUE + BEFORE INSERT raise), pendingQuarantine surfaced | migration 0003, `saves.test.ts` |
| Idempotency by commandId | retrying client, attacker reusing ids | double writes / replaying another command's result | prevent: request_hash over {type, canonicalPayload}; 422 mismatch; tombstones | `cqrs/bus.ts`, `bus.test.ts` |
| Decompression bombs | client | CPU/memory DoS | prevent: independent encoded/decoded/ratio/time limits, streaming inflate | `codec/blob.ts`, `codec.test.ts`, `saves.test.ts` |
| Admin authority | leaked read key | writes | prevent: scoped keys, timing-safe compare, every call audited, read-key write attempts logged; inspector on a separate origin with strict CSP, textContent only | `auth/index.ts`, `admin-static.ts`, ADR-021 |
| Codes | guessing | rewards | prevent: ≥ 40 bits after normalisation, per-player lock after 10 bad guesses/hour, per-campaign lock, rate limits | `grants/server.ts` |
| Leaderboards | client scores | placement rewards | detect + prevent: server-observed duration, summary bounds, quarantine top-N until review, provisional placements, moderated names, boards_hidden | `leaderboards/*` |
| DB privileges | a bug in app code | destructive ledger edits | prevent: app role INSERT/SELECT on ledgers, column-level UPDATE on commands, SECURITY DEFINER functions, raise-trigger fence | migration 0011, `saves.test.ts` privileges case |
| Wrong-target restore | operator | restoring game A into game B | prevent: manifest {game, env} validated against explicit destination before writing (QA import + tooling) | `lineage/server.ts` QaImport, `packages/tooling` manifest-check |
| Secrets in browser bundles | build mistake | secret leak | prevent: lint (no node/TypeBox/verifiers in browser code) + bundle guard + no-secrets guard | `eslint.config.js`, `packages/tooling/src/guards/*` |
| Rate limits | abusive client / IP | resource exhaustion | prevent: per-player buckets, per-IP ceilings (10×), auth-failure ceiling; PG store required in prod | `limits/index.ts`, `config.ts` |
