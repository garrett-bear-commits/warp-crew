# Intended use and boundaries

## What this core is

The foundation is a reusable backend and web adapter for a small portfolio of asynchronous, single-player
games. It is designed for games that need durable player state, offline play, cross-device recovery, signed
platform identity and purchases, auditable rewards, live operations, and support tooling.

Each game and environment has its own deployment and Postgres database. The shared value is code and protocol,
not tenancy.

## What the core owns

- Player authentication and provider verification.
- Append-only save history, server-assigned sequence numbers, generations, quarantine, restore, and retention.
- Command idempotency, database transactions, outbox delivery, rate limits, health, migrations, and jobs.
- Purchase facts, adjustments, grants, leaderboards, inbox, achievements, telemetry, and live-operations APIs.
- Browser storage, boot reconciliation, server sync, clock, journal, restore gate, and multi-tab leadership.
- Contracts, testkit, deployment tooling, and the admin inspector.

## What each game owns

- The deterministic engine and its actions/effects.
- The monotone `progressOf` ordinal.
- The save schema, migrations, codec, and state normalization.
- UI, game content, economy, balance formulas, and reward application.
- `GameConfig`, `GamePolicy`, summary extraction, plausibility rules, and QA sanitization.
- The mapping from generic grants into game-specific state changes.
- Platform product configuration, art, copy, analytics taxonomy, and launch evidence.

## Supported fit

Use the core when the game is:

- asynchronous and primarily single-player;
- safe to simulate on the client;
- able to describe progress with a non-decreasing safe integer;
- able to treat server-readable summaries as claims rather than authority;
- comfortable with one service and database per game/environment.

Choose a different architecture for real-time authoritative multiplayer, shared-world simulation, high-frequency
matchmaking, or an economy that requires every gameplay action to be server-authoritative.

## Extension rules

1. Values crossing HTTP live in `packages/contracts`.
2. Every mutation carries a durable `commandId` and executes through the command bus.
3. Player mutations use the player scope and lock; game-wide mutations declare their game scope explicitly.
4. Features may import another feature's `contract` entry, never its server or client implementation.
5. Cross-feature side effects use the outbox and deterministic system commands.
6. Every reward is a grant. Client claims cannot mint uncapped premium value.
7. Backwards state movement opens a new generation.
8. A new migration follows the N-1 rules in `docs/runbooks/migrations.md`.
9. A game release must keep older saves readable and preserve unknown fields where its codec permits it.

## Core invariants to preserve

Do not replace deepest-wins with last-write-wins, make save refusals transport errors, trust browser purchase
fields, update ledger rows in ordinary application code, or let a follower tab write. These constraints are the
reason to use the foundation rather than a generic CRUD service.
