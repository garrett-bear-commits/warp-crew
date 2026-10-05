# Cohort compensation (make-good)

1. Dry run: `POST /admin/v1/grants/cohort {grantKeyPrefix:'cohort:<ticket>', predicate, rewards, reason, dryRun:true}` → `matched`.
2. Real run: same body with `dryRun:false` → `minted`. Re-running is idempotent (grantKey = prefix:playerKey).
3. Optional letter per player (`POST /admin/v1/letters` with `grantKey`) or an announcement.
4. Players see the grant in `GET /v1/grants/pending` and claim it (step-up token).
