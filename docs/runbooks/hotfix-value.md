# Hotfix a value (what a mechanic says/costs/rewards/when)

Publish content, no deploy: `POST /admin/v1/liveops/content {kind, env:'lab'|'prod', document, reason}` (schema-checked for achievements/daily_rewards). Verify with `GET /v1/content/:kind` (`source: 'published'`, version bumped) and `GET /v1/config.contentVersions`. Revert: `POST /admin/v1/liveops/content/revert {kind, env, toVersion}` (appends a new version).
