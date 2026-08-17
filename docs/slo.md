# SLOs (§8)

| Objective | Target | Measured by |
| --- | --- | --- |
| Availability (API) | 99.5 % over 30 d | external monitor on `/health/ops?assert=page` |
| Latency | p95 < 300 ms per command | `commands.duration_ms` rollup (`/health/ops` → `commands.p95Ms`, warn ≥ 300, page ≥ 1500) |
| Acknowledged saves lost during normal operation | zero | model-based sync tests (client) + `saves` route tests: a `synced` verdict ⇒ the exact snapshot is anchored; PITR + weekly restore verify |
| Disaster RPO | ≤ 15 min | managed Postgres PITR (opt-in per game, ops checklist) |
| Disaster RTO | ≤ 2 h | runbook `restore-drill.md`, rehearsed |
| Outbox lag | warn ≥ 60 s, page ≥ 600 s; any dead letter pages | `/health/ops` `outbox.*` |
| Jobs | page when a job is > 3× its interval overdue | `job_runs` heartbeats |

Error budget policy: page-tier issues off-hours only (fleet on-call policy); warn-tier reviewed daily.
