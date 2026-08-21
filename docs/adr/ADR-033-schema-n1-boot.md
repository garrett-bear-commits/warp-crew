# ADR-033 Schema boot compatibility is a declared N-1 chain

Date: 2026-08-21. Status: accepted.

## Context

`checkSchema` used to require `schemaHead(applied) === schemaHead(image files)`. After deploying a
migration and rolling the image back, the previous image saw the extra applied row, computed a
different head, and refused to boot — contradicting the N-1 rule in `docs/runbooks/migrations.md`.
Ignoring arbitrary unknown ordinals would treat `0016_drop_everything` as bootable. Editing an
already-committed migration file (`0015` in `c94bf5d`) also breaks checksum upgrade/rollback.

## Decision

1. Never rewrite an already-committed migration. Follow-ups append. `0015` remains the
   `c94bf5d` bytes. `0016` validates the grant-key length CHECKs (no-op if already valid) and
   creates `schema_n1_compat`.
2. A migration opts into N-1 by including the line `-- foundation-n1-compatible`. `migrateUp`
   then records `(extra_name, prefix_head)` where `prefix_head` is `schemaHead` of applied rows
   before that file. The previous image reads that table at boot.
3. Boot states: `match`, `pending`, `mismatched`, `ahead`, `incompatible`, `missing_table`.
   `ahead` is bootable only when every extra applied name has a `schema_n1_compat` row whose
   `prefix_head` equals the running head, and both disk files and applied names are a unique
   contiguous ordinal chain (no skipped or duplicate `NNNN` prefixes).
4. Isolated restore (`verifyIsolatedRestore`) requires `state === 'match'`, not merely `ok`.
   `/health/ready` may be ready on `ahead` so a rolled-back image can serve.

## Consequences

A previous image whose files stop at `0015` boots against a database that has applied declared
`0016`. An undeclared extra, a checksum rewrite of `0015`, or a gapped ordinal chain refuses.
`migrate --up` from the old image still refuses applied files missing on disk.
