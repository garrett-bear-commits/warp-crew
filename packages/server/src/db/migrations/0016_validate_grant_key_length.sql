-- foundation-n1-compatible
-- VALIDATE is SHARE UPDATE EXCLUSIVE (concurrent DML allowed). Already-valid constraints are a
-- no-op, so images that applied 0015 with an immediate CHECK still migrate. Do not rewrite 0015.

CREATE TABLE schema_n1_compat (
  extra_name   TEXT PRIMARY KEY,
  prefix_head  TEXT NOT NULL
);
GRANT SELECT ON schema_n1_compat TO foundation_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_n1_compat FROM foundation_app;

ALTER TABLE grants VALIDATE CONSTRAINT grants_grant_key_length;
ALTER TABLE purchase_transactions VALIDATE CONSTRAINT purchase_transactions_grant_key_length;
