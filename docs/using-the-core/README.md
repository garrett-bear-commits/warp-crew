# Using the Game Foundation core

This directory is the practical entry point for a team building a game on the foundation. It explains what the
core owns, what the game must own, and how to extend the system without weakening the save, identity, money, or
operations invariants.

## Reading order

1. [Intended use and boundaries](intended-use.md) — decide whether this is the right foundation.
2. [Add a game](add-a-game.md) — connect an engine, save codec, policy, UI, and server configuration.
3. [Add a feature or capability](add-a-feature.md) — extend contracts, server behavior, client API, storage,
   and tests.
4. [Balancing and live operations](balancing-and-liveops.md) — know which values require a release and which
   can change live.
5. [Testing and releasing](testing-and-release.md) — prove a game integration before Lab and production; release
   versions, optional production variables, and what the API reports to Sentry and log shipping.
6. [Admin inspector](admin-inspector.md) — operate players and the supported live controls safely (hosting, keys
   and Cloudflare Access: [runbook](../runbooks/admin-inspector.md)).
7. [Disposable save sessions](disposable-save-sessions.md) — reproduce a retained player state without writing
   to the player or operator.

## Source-of-truth order

When sources disagree, use this order:

1. `docs/architecture-v1.md`
2. `docs/adr/`
3. TypeBox contracts in `packages/contracts`
4. These adopter guides
5. Runbooks in `docs/runbooks/`

`apps/template-game` is an acceptance consumer, not a drop-in product shell. Copy patterns deliberately and
keep only the features your game supports.
