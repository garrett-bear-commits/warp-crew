# ADR-023 Provider-neutral static hosting + zip fallback; no Cloudflare/Railway coupling in v1

Date: 2026-08-17. Status: accepted. Platform documentation reviewed: 2026-08-20.

## Context
§10/§14 name Cloudflare Pages / R2 or Railway static as candidate hosts and Railway for the server.
The build must be locally buildable and must not create paid resources or depend on external
credentials. Both hosts are interchangeable for "hashed immutable assets + no-cache index.html".

## Decision
`packages/tooling` ships a provider-neutral deploy: `foundation deploy-static --dist <dir> --out <dir>`
produces an in-place, hash-verified release layout (`v/<hash>/…` immutable assets, `index.html`
with no-cache headers manifest, `manifest.json` {game, env, buildVersion, contractVersion, sha256s})
and `foundation zip --dist <dir>` produces the zip fallback for platforms that need an upload.
Any static host (or the server's own `/static` mount, used in Lab and in the acceptance suite)
can serve the layout. Railway-specific files (`railway.json`) are not generated; the server image
is a plain Dockerfile with `HEALTHCHECK /health/ready`. Nothing in the repo references a Cloudflare
or Railway API.

## Consequences
Deploying to a specific host is one adapter script outside v1 scope; `fleet.json` keeps
host-neutral fields (name, apiUrl, staticUrl, env).

Jest now officially supports registering a self-hosted URL as a game version (Developer Console →
Versions → Add self-hosted URL). The platform loads that URL verbatim in its iframe and supports
preview, activation, and later switching of the active version. The ZIP pipeline remains a
fallback, not a requirement. Source: [Jest HTML5 SDK](https://docs.jest.com/sdk/html5),
[Manage builds](https://docs.jest.com/dev-console/builds), and the May 11, 2026 entry in
[What's new](https://docs.jest.com/whats-new).

This repository's local static deploy and iframe harness are evidence for asset layout and local
framing behavior only. They do not prove the real Jest shell accepts the origin. Before review,
verify the registered URL, `frame-ancestors`, CORS to the API, SDK bootstrap, storage partitioning,
and mobile behavior in the hosted emulator/Simulator. Prefer one self-hosted origin for the game
and `/v1` reverse proxying on that origin; a separate API origin remains an explicit external gate.

## Amendment 2026-10-01: host-specific pieces synced from a production game

Static hosting stays provider-neutral: `foundation deploy-static` and `foundation zip` are
unchanged, and the server calls no host's API. Three optional, host-shaped pieces now exist:

- `apps/server/src/cli/railway-migrate.ts`, a pre-deploy step for a managed host that gives each
  game an isolated database. From `BOOTSTRAP_DATABASE_URL` it creates or updates the
  `foundation_migrator` and `foundation_app` login roles (passwords from `MIGRATION_DATABASE_URL`
  and `DATABASE_URL`, at least 24 characters, all three URLs on the same database), makes the
  migrator the database owner, then runs `migrateUp` as the migrator. It is named for the host
  that first used it but needs only those three URLs.
- Cloudflare Access verification of admin requests (ADR-021 update), which reads the team's
  public signing keys from `<team domain>/cdn-cgi/access/certs`. Off unless configured.
- `scripts/admin-keys.mjs` (operator tooling, not the server) reads and writes the API's
  `ADMIN_KEYS` through a logged-in Railway CLI, its one supported backend; another host needs its
  own read/write functions. Keys can always be issued by hand
  ([admin-inspector runbook](../runbooks/admin-inspector.md#keys)).

A game may also load large art from a separate asset host chosen at build time; that is game
client code, not a foundation dependency.
