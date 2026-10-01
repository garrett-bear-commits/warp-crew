# Outbox dead letters (page-tier)

With `SENTRY_DSN` set, a dead letter arrives as an `outbox-dead-letter` issue per consumer (the error itself, with its stack and cause), and the `ops.alert` job pages `ops page: outbox_dead_letters` every 5 min until it is replayed. A delivery's first failure warns earlier as `outbox-retry`. The inspector lists and replays them under **Audit → Dead letters**.

1. `GET /admin/v1/outbox/dead-letters` → consumer + last_error.
2. Fix the consumer (deploy) or the data.
3. `POST /admin/v1/outbox/replay {outboxId, consumer, reason}` → the delivery is re-queued (attempts reset); redelivery is idempotent (commandId = outbox:<id>:<consumer>).
4. `/health/ops` (and the `ops.alert` page) clears once no unreplayed dead letters remain.
