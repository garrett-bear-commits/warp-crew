-- 0013_outbox_lease_token: lease ownership (audit F6). Every lease carries a token; delivered /
-- retry / dead finalisation is accepted only from the token holder, so a worker whose lease
-- expired and was re-leased elsewhere cannot flip the row.
ALTER TABLE outbox_deliveries ADD COLUMN lease_token UUID;
