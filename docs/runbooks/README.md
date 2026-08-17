# Runbooks (§12 P4)

Each runbook is a checklist a second person can run. Commands assume the repo root and a configured `.env` for the target game/env (never prod from a laptop without a change ticket).

| Runbook | When |
| --- | --- |
| [migrations.md](migrations.md) | releasing schema changes, `--repair`, N-1 rule |
| [restore-drill.md](restore-drill.md) | PITR / restore verify, quarterly drill |
| [reattach.md](reattach.md) | `server_behind` recovery via `lineage.reattach` |
| [sale.md](sale.md) | scheduling a sale (schedule + flag + announcement) without a deploy |
| [cohort-compensation.md](cohort-compensation.md) | make-good to a segment |
| [patch-notes.md](patch-notes.md) | announcement + content publish |
| [hotfix-value.md](hotfix-value.md) | changing a number a mechanic uses (content publish) |
| [pause-sku.md](pause-sku.md) | kill switch per SKU / command |
| [financials-import.md](financials-import.md) | reconciling provider Financials exports (dry-run, reclassify) |
| [client-release-watch.md](client-release-watch.md) | watching a client release: minBuild, banner, 426 |
| [outbox-dead-letter-replay.md](outbox-dead-letter-replay.md) | page-tier alert on dead letters |
| [quarantine-review.md](quarantine-review.md) | promote / reject a quarantined save |
| [erasure.md](erasure.md) | player erasure request |
| [new-game.md](new-game.md) | bringing a game to Lab in < 1 h |
