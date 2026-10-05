-- A game may mint signed Jest sandbox receipts (`purchases.mintSandbox`) so test checkout delivers
-- like a paid pack. Sandbox rows still never classify as paid, and unclassified/unsupported rows
-- still grant nothing.
ALTER TABLE purchase_transactions DROP CONSTRAINT purchase_transactions_check;

ALTER TABLE purchase_transactions
  ADD CONSTRAINT purchase_transactions_granted_classification
  CHECK (classification IN ('paid', 'sandbox') OR granted = 0);
