# New game on Lab in < 1 h

1. `pnpm foundation new-server --game <id>` → `apps/server/games/<id>/`; add it to `apps/server/src/games.ts`.
2. Fill `.env` from `.env.example` (GAME_ID, GAME_ENV=lab, JEST_JWS_SECRETS, ADMIN_KEYS, OPS_SECRET, DATABASE_URL); `pnpm foundation preflight --env-file .env`.
3. `pnpm migrate --up`, start the image, `pnpm foundation check-health --url <api> --assert page --ops-secret <s>`.
4. Canary: `POST /qa/v1/identity/mint`, `PUT /v1/saves`, `GET /v1/saves/current`.
5. Run [Jest launch and Developer Console](jest-launch.md) before calling the client ready. This includes the immutable slug, support email, listing assets, active version/visibility, catalog products, approved notification assets, Simulator self-review, sandbox checks, and mobile soak.
6. Half-day client checklist (§10): game id, aud, secrets, PITR opt-in, Sentry project, monitor on `/health/ops?assert=page`, one static origin, same-origin `/v1` proxy where possible, and `frame-ancestors`.

The local Playwright suite and iframe harness are mock/local evidence. They do not replace the
hosted emulator, Simulator, sandbox user, or real iOS Safari/Android Chrome checks.
