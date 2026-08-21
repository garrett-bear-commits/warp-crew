# ADR-033 Schema boot compatibility is an explicit N-1 applied-suffix window

Date: 2026-08-21. Status: accepted.

## Context

`checkSchema` used to require `schemaHead(applied) === schemaHead(image files)`. After deploying a
migration and rolling the image back, the previous image saw the extra applied row, computed a
different head, and refused to boot — contradicting the N-1 rule in `docs/runbooks/migrations.md`.
Ignoring arbitrary unknown migrations would hide gaps and forks.

## Decision

Boot evaluates disk files vs applied rows into distinct states: `match`, `pending`, `mismatched`,
`ahead`, `incompatible`, `missing_table`. Pending known files and checksum mismatches always
refuse. `ahead` is bootable only when the extra applied names are a contiguous next-ordinal suffix
of length ≤ `SCHEMA_COMPAT_AHEAD` (2), so one expand + validate pair in a single release remains
N-1 compatible. A third extra file, a skipped ordinal, or an unknown name that is not the next
prefix is `incompatible`. `migrate --up` still refuses applied files missing on disk — rollback
keeps the schema and does not re-run the old migrator.

## Consequences

`/health/ready` `migrationsAtHead` means "compatible with this image", not "heads are identical".
`migrate --status` reports `state` and `ahead`. Tests cover current-image pending `0015`, current
head match, previous-image directory through `0014` against schema through `0016`, checksum
mismatch, and an over-long suffix.
