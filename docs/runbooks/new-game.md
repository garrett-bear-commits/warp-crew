# New game on Lab in < 1 h

1. `pnpm foundation new-server --game <id>` → `apps/server/games/<id>/`; add it to `apps/server/src/games.ts`. List the rewards the client applies in `games/<id>/grants.ts`, wire `grantRewardProblem` in the policy, and point `admin-inspector/src/game-grants.ts` at it.
2. Fill `.env` from `.env.example` (GAME_ID, GAME_ENV=lab, JEST_JWS_SECRETS, ADMIN_KEYS, OPS_SECRET, DATABASE_URL; `GAME_CONFIG=<id>` when the platform's game id differs from the `games/<id>/` name); `pnpm foundation preflight --env-file .env`.
3. `pnpm migrate --up`, start the image, `pnpm foundation check-health --url <api> --assert page --ops-secret <s>`.
4. Canary: `POST /qa/v1/identity/mint`, `PUT /v1/saves`, `GET /v1/saves/current`.
5. Run [Jest launch and Developer Console](jest-launch.md) before calling the client ready. This includes the immutable slug, support email, listing assets, active version/visibility, catalog products, approved notification assets, Simulator self-review, sandbox checks, and mobile soak.
6. Half-day client checklist (§10): game id, aud, secrets, PITR opt-in, Sentry project (`SENTRY_DSN`; alert rules per [slo.md](../slo.md)), monitor on `/health/ops?assert=page` or the `ops.alert` Crons monitor, one static origin, same-origin `/v1` proxy where possible, and `frame-ancestors`.

The local Playwright suite and iframe harness are mock/local evidence. They do not replace the
hosted emulator, Simulator, sandbox user, or real iOS Safari/Android Chrome checks.
