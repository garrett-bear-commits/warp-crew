# ADR-030 Content-addressed static releases; inspector retry policy; manifest fields

Date: 2026-08-18. Status: accepted.

## Decisions
- `deploy-static` release id = sha256({game, env, buildVersion, contractVersion, files}) prefix 12;
  `takenAt` is excluded so redeploying an identical build reuses the release directory. The
  `index.html` swap happens only after every listed file re-hashes on disk (in-place, hash-verified).
- The zip fallback is store-only with fixed DOS timestamps (reproducible) unless `--now` is given.
- Backup/export/QA manifests write `takenAt` as epoch ms (matches `QaImportBody`); ISO is accepted
  on read; a `contractVersion` drift is a warning, a pinned `schemaHead` mismatch or a game/env
  mismatch is a refusal (exit 2) before any write.
- `preflight` re-implements the config refusals of `packages/server/src/config.ts` because tooling
  must not import the server package; the two lists must be kept in step (both are tested).
- The admin inspector keeps a form's `commandId` across retries after a network error or a 5xx and
  clears it on any 2xx/4xx and on any form edit; credentials live in a module variable only.
- The inspector reads enum values from `@foundation/contracts/enums` (browser-safe) and everything
  else as types.
