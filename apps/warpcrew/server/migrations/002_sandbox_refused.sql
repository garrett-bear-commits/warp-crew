-- A sandbox receipt refused in production is recorded as `sandbox_refused`
-- and never counts as owning a one-time pack, so a later real purchase of the
-- same pack still grants. Idempotent: every migration runs on every boot.
ALTER TABLE purchase_transactions DROP CONSTRAINT IF EXISTS purchase_transactions_classification_check;
ALTER TABLE purchase_transactions ADD CONSTRAINT purchase_transactions_classification_check
  CHECK (classification IN ('paid', 'sandbox', 'sandbox_refused', 'unclassified', 'unsupported', 'duplicate_one_time'));
UPDATE purchase_transactions SET classification = 'sandbox_refused', one_time = false
  WHERE classification = 'sandbox' AND granted = '{}'::jsonb;
