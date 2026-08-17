# ADR-024 Real premium minting from receipts is off until the sandbox receipt shape is verified

Date: 2026-08-17. Status: accepted.

## Context
§12 P0 gate: "Jest sandbox receipt price shape (fallback: classify by Dev-Console list)". §1: money
is signed facts only; sandbox never mints (schema CHECK). The receipt verifier lifted from
Barrowdeep parses `payload.purchase{purchaseToken, productSku, createdAt, completedAt, price?, currency?}`
signed HS256 with the shared secret. The exact production/sandbox price shape has not been
verified against Jest in this repository (no credentials, no external calls).

## Decision
`purchases.mintPremium` is a per-game config with default `'off'`. With `'off'`, verified receipts
are still verified, classified (`paid | sandbox | unclassified | unsupported`) and recorded in
`purchase_transactions` with `granted = 0` and no grant is minted; the client shows the purchase
as recorded and pending. With `'on'` (set only after the receipt shape is confirmed on Lab), a
`paid` classification mints a `purchase:<providerToken>` grant inside the same command. The
schema CHECK `classification = 'paid' OR granted = 0` holds in both modes. Missing or
non-positive signed price never classifies as paid.

## Consequences
No premium value can be minted from an unverified assumption about the provider. Turning minting
on is a config publish plus a runbook step, not a code change.
