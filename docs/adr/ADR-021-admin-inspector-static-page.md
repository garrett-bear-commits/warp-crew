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
