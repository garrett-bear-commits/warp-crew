-- Preserve the signed Jest sandbox fact. Existing rows remain NULL because older verifier versions
-- discarded the claim; newly verified receipts always write true (sandbox) or false (live).
ALTER TABLE purchase_transactions
  -- The expression evaluates to NULL while remaining explicit in schema introspection. Omitted
  -- imports therefore preserve "provenance unknown"; live verification always writes true/false.
  ADD COLUMN sandbox BOOLEAN DEFAULT NULLIF(TRUE, TRUE);

ALTER TABLE purchase_transactions
  ADD CONSTRAINT purchase_transactions_sandbox_not_paid
  CHECK (sandbox IS DISTINCT FROM TRUE OR classification <> 'paid');
