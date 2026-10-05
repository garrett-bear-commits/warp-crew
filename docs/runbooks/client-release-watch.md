# Client release watch

1. Deploy static: `pnpm foundation deploy-static --dist apps/<id>/dist --out <releases> --game <id> --env <env> --build <version>` (in-place, hash-verified, `v/` history) or `pnpm foundation zip` for the fallback. The template's client is `apps/template-game/dist`.
2. Running sessions get the version banner and reload at safe points (a game without the banner keeps its build until it reloads). Each API deploy reports its release on `/health/ready` (`buildVersion`, `commit`; see [Testing and releasing](../using-the-core/testing-and-release.md#release-versions)); analytics carrying the build version show which releases players still run.
3. Stragglers: `POST /admin/v1/liveops/min-build {minBuildVersion}` → clients announcing an older `x-build-version` get 426 `build_too_old` (`update_required` verdict). Never raise it above the lowest version hosted clients announce, and remember the live override outlives an image rollback: lower it before rolling back below it.
4. Watch `/health/ops` `commands.byType` refusals and `integrity_events` (`game_error`) for the new build, and new Sentry issues tagged with its release.
