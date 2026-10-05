# ADR-025 Integration tests run on real Postgres 16, never a fake

Date: 2026-08-17. Status: accepted.

## Context
§9 requires integration on real Postgres (lock serialisation, CAS under concurrency, prune,
outbox drain, role privileges, migrations from empty). A fake would test the fake.

## Decision
`@foundation/testkit/pg` provides `withTestDatabase()`: it uses `DATABASE_URL_TEST` if set
(CI / `pnpm db:up`), else starts a `postgres:16-alpine` testcontainer. Each test file gets a fresh
schema via `migrate --up` from empty and connects as the `app` role for privilege tests. Vitest
project `pg` is separate from `unit` so unit tests stay fast.

## Consequences
Docker is a dev dependency for the `pg` project; without it those tests report as unrunnable
(recorded in IMPLEMENTATION_STATUS.md), never as passed.
