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
`purchases.mintPremium` is a per-game config with default `'off'`. The server publishes
`checkoutEnabled=false` while delivery is off, the player is purchase-disabled, or the
purchase-verification family is paused, and the template keeps checkout disabled until that server
state and live config have both loaded.

With minting off, a signed non-sandbox paid receipt is verified but not appended to
`purchase_transactions`; the server returns `delivery_unavailable` + `completion: withhold`. The
provider token therefore remains incomplete and can be verified again after the owner opens the
gate. It also cannot consume the first-delivered-purchase multiplier. Signed sandbox receipts may
still be recorded for controlled testing, but retain `granted = 0` and `completion: withhold` under
the unresolved owner gate.

Classification inspects signed `sandbox === true` before price. A positive-price Simulator receipt
remains sandbox; a missing or non-positive price cannot classify as paid. With minting on (only
after real Lab validation and owner approval), a non-sandbox paid classification mints a bounded
`purchase:<sha256(providerToken)>` grant inside the same command. The schema CHECK
`classification = 'paid' OR granted = 0` remains in force until the owner explicitly approves a
separate delivery/commercial-value model.

## Consequences
No premium value can be minted from an unverified assumption about the provider. Turning minting
on is a config publish plus a runbook step, not a code change; incomplete paid provider tokens can
then recover normally because no disabled-delivery ledger row was written. Any paid row created by
an older build with `grant_key IS NULL` requires explicit operator compensation rather than silent
promotion. Subscriptions are beta and remain deferred from this remediation.

Sources reviewed: [Jest payments](https://docs.jest.com/sdk/html5/payments),
[sandbox users](https://docs.jest.com/testing/sandbox), and
[What's new](https://docs.jest.com/whats-new).
