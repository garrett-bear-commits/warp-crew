# Client release watch

1. Deploy static: `pnpm foundation deploy-static --dist apps/template-game/dist --out <releases> --game <id> --env <env> --build <version>` (in-place, hash-verified, `v/` history) or `pnpm foundation zip` for the fallback.
2. Running sessions get the version banner and reload at safe points.
3. Stragglers: `POST /admin/v1/liveops/min-build {minBuildVersion}` → clients announcing an older `x-build-version` get 426 `build_too_old` (`update_required` verdict).
4. Watch `/health/ops` `commands.byType` refusals and `integrity_events` (`game_error`) for the new build.
