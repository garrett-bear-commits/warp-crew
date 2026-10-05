# ADR-020 Journal default is `errors_only`, configured per game

Date: 2026-08-17. Status: accepted.

## Context
§14 left open whether the journal is on by default for every game (`on | errors_only | off`).
The journal is a debugging tool, not an event-sourced save (ADR-016). Shipping every input for
every player costs storage (90 d partitions) and bandwidth on the timer path (≤ 16 KiB per call)
and buys nothing until a repro is needed.

## Decision
`journal: 'errors_only'` is the default in `game.config.ts`. In this mode the client keeps the
32 KiB ring in local storage on autosave but ships it only when a `game_error` integrity event is
recorded (bundled as breadcrumbs + the current ring on the next timer tick). A game may set `on`
(ship on every timer path) or `off` (no ring, no shipping). The server rejects journal calls when
the game's mode is `off` with `outcome: disabled`.

## Consequences
Repro bundles exist for every reported error without paying for the happy path. Determinism
measurement (ADR-016) uses `on` in Lab.
