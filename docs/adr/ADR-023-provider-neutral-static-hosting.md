# ADR-023 Provider-neutral static hosting + zip fallback; no Cloudflare/Railway coupling in v1

Date: 2026-08-17. Status: accepted.

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
