-- Separate transaction from 0015: VALIDATE takes SHARE UPDATE EXCLUSIVE, so concurrent reads and
-- writes continue while existing rows are scanned. Do not fold this back into 0015.
ALTER TABLE grants VALIDATE CONSTRAINT grants_grant_key_length;
ALTER TABLE purchase_transactions VALIDATE CONSTRAINT purchase_transactions_grant_key_length;
