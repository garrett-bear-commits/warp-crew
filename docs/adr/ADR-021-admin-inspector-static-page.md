# ADR-021 Admin inspector is a static TypeScript page on a separate origin

Date: 2026-08-17. Status: accepted.

## Context
§14 left open static page vs small SPA. §7 requires a separate origin + strict CSP, textContent
rendering, images by magic bytes, and no secrets in client packages.

## Decision
`apps/server/admin-inspector/` is a static page: hand-written HTML + one TypeScript module bundled
by Vite (no framework, no runtime dependencies). It is served by a second Fastify instance
(`ADMIN_PORT`, default 8081) — a different origin from the API — with
`Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src <api origin>; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
All rendering uses `textContent`/`createElement`; `innerHTML` is banned by lint in that folder.
The admin key id/secret are held in memory only (never persisted) and sent as headers to the API.

## Consequences
No SPA build, no router; the five write actions (letter, grant, cohort grant, publish, restore)
and the timeline/JSON viewer are plain forms. Playwright drives it in the acceptance suite.

## Update 2026-10-01: one admin origin forwards the admin API

Synced from a production game. The admin origin also forwards `/admin/v1/*` (that prefix only) to
the API in-process (`apps/server/src/admin-static.ts`), so a deployment exposes one admin domain
and the API needs no public admin route. Nothing else of the API (`/v1`, `/health`, `/ops`, `/qa`)
is reachable there; only the headers the admin API reads go upstream (key id, secret, content
type, accept, request id, idempotency key, and Cloudflare Access's `Cf-Access-Jwt-Assertion`).
`connect-src` is therefore `'self'`, plus `PUBLIC_URL` when set.

A hosted deployment may instead run its own small reverse proxy that serves the built page and
forwards only `/admin/v1/*` to the API's private address, so the API keeps no public domain. The
in-process forwarder stays for local development (`ADMIN_PORT`, default 8081). Runbook:
[`docs/runbooks/admin-inspector.md`](../runbooks/admin-inspector.md).

## Update 2026-10-01: optional Cloudflare Access in front of the admin origin

When the admin origin sits behind Cloudflare Access, Access is not the only gate: a host's own
default domain for the same service usually skips it. With `CF_ACCESS_TEAM_DOMAIN` and
`CF_ACCESS_AUD` set, the API verifies Access's signed `Cf-Access-Jwt-Assertion` on every admin
route before the key check (`packages/server/src/auth/cf-access.ts`), and the admin origin
forwards that header. The inspector's API calls send same-origin cookies (Access's session
cookie); a cross-origin API still gets none. Both variables unset: nothing is checked.

## Update 2026-10-01: sign-in gate

Signed out, the page is only a sign-in card (key id, secret, an environment badge derived from the
hostname). The console is an inert `<template>` cloned only after `GET /admin/v1/session` (any
valid admin key, no scope; the route is marked `adminScope: 'any'`) verifies the key, and removed
on sign-out. The console shows only the workspaces and actions the key's scopes allow
(`admin-inspector/src/scopes.ts`), and every write shows a confirmation before it is sent. The API
origin is always the page's own origin and the game client URL comes from the build; neither is
an input. Still no framework or runtime dependency, `textContent` rendering and the same CSP.
