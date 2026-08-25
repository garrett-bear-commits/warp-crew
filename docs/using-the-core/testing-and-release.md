# Testing and releasing a game integration

## Fast local loop

```bash
pnpm check
pnpm test:unit
pnpm test:model
```

## Database and browser proof

```bash
pnpm db:up
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55432/foundation_test pnpm test:pg
pnpm test:e2e
git diff --check
git archive HEAD | docker build -f apps/server/Dockerfile -
```

## Game-specific acceptance

A game is ready for Lab when it has:

- engine determinism and action-fuzz coverage;
- apply-only/step-only/mixed engine conformance where applicable;
- ordered save-corpus fixtures across every schema migration;
- round-trip, unknown-field, corrupt-save, and future-schema tests;
- server/client parity tests for public identifiers;
- model-based sync coverage with no counterexamples;
- browser coverage for blocked storage, beacon, resume, restore, multi-tab, generation change, and update-required;
- one end-to-end scenario for each enabled money/reward/live-ops feature;
- a clean production image build from committed files only.

## Lab gate

In Lab, verify platform identity, URL hosting, real receipt classification with minting off, storage behavior on
physical devices, Sentry redaction, health paging, and load behavior. Enable PITR before player traffic and run
the restore/erasure replay drill.

## Production gate

- migrations are at the expected head and N-1 compatibility is declared;
- the prior client remains contract-compatible;
- minimum build and content compatibility are intentional;
- premium minting has signed platform evidence and owner approval;
- kill switches and rollback commands are rehearsed;
- health, backup, Sentry, and fleet monitors are green;
- the release manifest and runbook record the exact image, client build, contract, content, and schema versions.

Never convert an external gate into a passing local claim. Record the command, evidence, and remaining operator
action in `IMPLEMENTATION_STATUS.md`.
