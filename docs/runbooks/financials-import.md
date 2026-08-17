# Financials import (reconciliation)

The provider's Financials export is compared against `purchase_transactions` by `provider_token`. Missing rows → `POST /admin/v1/purchases/adjustments {kind:'make_good', delta, transactionId?, reason}`; refunds → `kind:'refund'` with a negative delta (creates a strike; 3 strikes auto-disable purchases). Dry-run first by diffing the export against `SELECT provider_token, classification, price FROM purchase_transactions`. Reclassification of `unclassified` rows is a new adjustment referencing the transaction, never an UPDATE (ledger fence).
