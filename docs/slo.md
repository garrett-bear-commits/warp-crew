# SLOs (§8)

| Objective | Target | Measured by |
| --- | --- | --- |
| Availability (API) | 99.5 % over 30 d | an external monitor on `/health/ops?assert=page` where the deployment exposes it; otherwise the in-process `ops.alert` job (every 5 min) sends each `/health/ops` page-tier issue to Sentry as `ops page: <code>` (fingerprint `ops/page/<code>`; warn tier `ops/warn/<code>` at most every 6 h), and its Sentry Crons monitor `api-ops-alert` misses when the API or its job runner is down |
| Latency | p95 < 300 ms per command | `commands.duration_ms` rollup (`/health/ops` → `commands.p95Ms`, warn ≥ 300, page ≥ 1500); before launch, the load test's save threshold (`capacity.md`) |
| Acknowledged saves lost during normal operation | zero | model-based sync tests (client) + `saves` route tests: a `synced` verdict ⇒ the exact snapshot is anchored; PITR + weekly restore verify |
| Disaster RPO | ≤ 15 min | managed Postgres PITR (opt-in per game, ops checklist) |
| Disaster RTO | ≤ 2 h | runbook `restore-drill.md`, rehearsed |
| Errors | command error rate warns ≥ 5 %, pages ≥ 20 % (at least 20 commands in the window); the same shares of an instance's API responses that are 5xx (a raw 500 never becomes a command row); 401s warn ≥ 25 % and 429s ≥ 5 % of them (at least 20 responses; health checks excluded) | `/health/ops` `commands.*`, `http.*` (per instance, 15 min window; `observability/httpStats.ts`) |
| Outbox lag | warn ≥ 60 s, page ≥ 600 s; any dead letter pages; a delivery's first failure warns in Sentry (`outbox-retry`, per consumer) and a dead letter reports `outbox-dead-letter` | `/health/ops` `outbox.*`, Sentry |
| Jobs | page when a job is > 3× its interval (at least 2 min) overdue, or has no heartbeat; a replica pages only after that window (at most 15 min) of its own uptime, so a deploy gap does not page | `job_runs` heartbeats; jobs of a minute or slower run when due by `job_runs` (checked on boot and every 5 min under the job's advisory lock), so deploys never reset them; jobs of an hour or slower check in to Sentry Crons (`api-<job>`) |

Sentry alert rules should page on the `ops/page/*` issues, the `job-failed`, `job-runner` and `outbox-dead-letter` issues, and missed or failed `api-*` Crons monitors. Without `SENTRY_DSN` every hook is a no-op and the external `/health/ops` monitor is the only pager.

Error budget policy: page-tier issues off-hours only (fleet on-call policy); warn-tier reviewed daily.

A reverse proxy in front of the API that rate-limits per address answers its own 429s; those are not API errors and do not reach `http.rateLimited`.
