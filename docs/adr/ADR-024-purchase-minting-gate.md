# ADR-024 Real premium minting remains owner-gated pending real Jest payload validation

Date: 2026-08-17. Status: accepted. Platform documentation reviewed: 2026-08-20.

## Context
§12 P0 gate: real Jest sandbox and paid receipt verification. Money is signed facts only; the
repository's current schema deliberately keeps the invariant that sandbox rows never mint
premium value. The current Jest documentation makes `sandbox: true` authoritative in both the
plain purchase data and the signed token; price is not a reliable sandbox classifier. The same
documentation says sandbox purchases should still grant test items/entitlements, while excluding
them from revenue and spend-based rewards. That delivery guidance conflicts with this repository's
`granted = 0` invariant and therefore requires owner approval before any schema or ledger change.

## Decision
`purchases.mintPremium` is a per-game config with default `'off'`. With `'off'`, verified receipts
are still verified, classified (`paid | sandbox | unclassified | unsupported`) and recorded in
`purchase_transactions` with `granted = 0` and no grant is minted; the client shows the purchase
as recorded and pending, and the server returns `completion: withhold` so the provider purchase
stays incomplete and recoverable. Classification must inspect signed `sandbox === true` before considering
price. A positive price with `sandbox: true` remains sandbox; a missing or non-positive price
cannot classify as paid. With `'on'` (only after real Lab validation and owner approval), a
non-sandbox `paid` classification mints a `purchase:<providerToken>` grant inside the same
command. The schema CHECK `classification = 'paid' OR granted = 0` remains in force until the
owner explicitly approves a separate delivery/commercial-value model.

## Consequences
No premium value can be minted from an unverified assumption about the provider. Turning minting
on is a config publish plus a runbook step, not a code change. Subscriptions are beta and remain
deferred from this remediation.

Sources reviewed: [Jest payments](https://docs.jest.com/sdk/html5/payments),
[sandbox users](https://docs.jest.com/testing/sandbox), and
[What's new](https://docs.jest.com/whats-new).
