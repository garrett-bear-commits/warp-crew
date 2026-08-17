# Outbox dead letters (page-tier)

1. `GET /admin/v1/outbox/dead-letters` → consumer + last_error.
2. Fix the consumer (deploy) or the data.
3. `POST /admin/v1/outbox/replay {outboxId, consumer, reason}` → the delivery is re-queued (attempts reset); redelivery is idempotent (commandId = outbox:<id>:<consumer>).
4. `/health/ops` clears once no unreplayed dead letters remain.
