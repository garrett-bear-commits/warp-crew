-- foundation-n1-compatible-with-ordinal: 17
-- 0018_purchase_one_time_packs: one-time packs (ADR-035). A pack sold once per player is owned by
-- exactly one row: the first paid purchase that minted its grant (`one_time`). Any later receipt
-- for an owned pack is recorded for support to refund (`duplicate_of` = the owning row) and never
-- grants. Sandbox rows never own a pack. Both columns are additive with constant defaults, so the
-- 0017 image (which never writes them) still boots and records purchases after an image rollback;
-- that image does not know one-time packs, so a rollback window can grant a second copy.
ALTER TABLE purchase_transactions ADD COLUMN one_time BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchase_transactions ADD COLUMN duplicate_of BIGINT;

-- Every existing row has one_time = false and duplicate_of = NULL, so NOT VALID skips only a
-- table scan that could find nothing; new rows are checked.
ALTER TABLE purchase_transactions
  ADD CONSTRAINT purchase_transactions_one_time_owner
  CHECK (NOT one_time OR (classification = 'paid' AND grant_key IS NOT NULL AND duplicate_of IS NULL))
  NOT VALID;
ALTER TABLE purchase_transactions
  ADD CONSTRAINT purchase_transactions_duplicate_grants_nothing
  CHECK (duplicate_of IS NULL OR (granted = 0 AND grant_key IS NULL))
  NOT VALID;

-- The second fence behind the player lock: one owning row per player and SKU.
CREATE UNIQUE INDEX purchase_transactions_one_time_once
  ON purchase_transactions (player_key, sku) WHERE one_time;
