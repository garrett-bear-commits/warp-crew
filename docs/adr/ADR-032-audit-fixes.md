# ADR-032 Decisions taken while fixing the v1 audit findings

Date: 2026-08-18. Status: accepted.

1. **Save replay semantics (F3).** A retried commandId replays `duplicate` only when the original
   write was anchored; a retried refused or quarantined write replays its original disposition with
   reason/flags/divergence/seq/generation/progress/hash. The tombstone stores the full result so the
   same holds after the commands row is pruned (> 7 d). The client maps a replayed refusal exactly
   like the first refusal (never "saved to cloud", pending retired as terminal — never acked; see
   ADR-029 Audit fixes).
2. **Postgres TLS (F2).** `PGSSL=off|require|verify` maps to postgres.js `false|'require'|'verify-full'`;
   `prefer` (silent plaintext fallback) is never selected and prod refuses `off`.
3. **Outbox lease ownership (F6).** Every lease carries a `lease_token`; delivered/retry/dead
   finalisation is accepted only from the token holder; a stale holder's finalisation is a counted
   no-op (`stale`). Admin replay runs inside the command's own transaction (`replayInTx`, F7).
4. **Code capacity (F5).** `UPDATE codes SET redemptions = redemptions + 1 WHERE … AND redemptions < max`
   reserves capacity atomically across players before minting.
5. **DR markers (F4).** `live_integrity_verified_at` = weekly self-check of the live database;
   `restore_verified_at` = written only by `markRestoreVerified` after `verifyIsolatedRestore`
   passed against a restored copy whose manifest names this game/env. Erasure tombstones are
   exported as JSONL with a manifest header and replayed idempotently after a restore. Managed
   PITR/object storage remain external.
6. **Sentry (F12).** Optional; without a DSN every hook is a no-op. Spans are recorded at 100 % and
   sampled at send time (`keepTransaction`) so 5xx/thrown transactions are always kept; redaction
   uses the pino scrub rules on events and transactions.
7. **Business keys shared across players (F14).** Provider tokens and client-minted runIds are
   serialised with advisory locks; a token already recorded for another player is rejected
   (`sub_mismatch`), a runId owned by another player is refused (403) — never a 500.
8. **Docker (F10).** The admin inspector is built in a builder stage; the image builds from
   `git archive HEAD` with no pre-built artefact; CI builds it.
9. **OpenAPI diff (F13).** A dependency-free breaking-change detector runs in CI against the last
   released tag and reports "unavailable" (exit 0, explicit line) while no tag exists — it is not
   reported as passed.
