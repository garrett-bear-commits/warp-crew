# ADR-033 Schema boot compatibility is a declared N-1 extra for one prior image

Date: 2026-08-21. Status: accepted.

## Context

`checkSchema` used to require `schemaHead(applied) === schemaHead(image files)`. Rolling the image
back after a new migration then failed at boot. Declaring extras by ordinal, or chaining
`prefix_head` through every extra, would let an image ending at `0015` run against N-2 schemas.
`c94bf5d` still uses exact-head checking, so it cannot consume extras or a declaration table.
Rewriting committed migration checksums (`0015`/`0016`) also breaks upgrade from a database that
already applied an earlier unreleased commit.

## Decision

1. **Two-release rollout.** This image ships the N-1 checker and `schema_n1_compat` (created by
   the migrator, like `schema_migrations`) with **no extra numbered migration**. Head stays the
   `c94bf5d` 15-file head. A later release may add `-- foundation-n1-compatible-with-ordinal` extras; *this*
   image can boot against them. `c94bf5d` cannot. Unreleased databases that applied a rewritten
   `0015`/`0016` are rebuilt from empty.
2. Each extra declares exactly one `-- foundation-n1-compatible-with-ordinal: N` as the **first
   nonblank line** in SQL (the last ordinal of the prior image). A marker in a SQL body, or
   duplicate/conflicting markers, refuse. `migrateUp` stores
   `extra_checksum`, `prefix_head`, `result_head`, `compatible_with_head`, and
   `compatible_with_ordinal`. Boot `ahead` requires `compatible_with_head ===` this image's
   `expectedHead` and `compatible_with_ordinal ===` this image's last ordinal. Same-release extras
   all name the same parent ordinal, even if applied in separate `migrateUp` runs. A later extra
   named for ordinal 16 is N-2 relative to an image ending at 15.
3. `migrateUp` checks that applied rows are a prefix of disk files (missing-on-disk first), then
   that disk and applied names are a unique contiguous ordinal chain, **before** any apply SQL.
   `--repair` recomputes n1 heads in the same transaction as checksum updates. When the extra file
   is on disk, it must still contain exactly one header marker matching the stored parent ordinal.
   An applied file that gained a marker without a `schema_n1_compat` row is refused (repair does
   not create authorization).
4. Isolated restore requires `state === 'match'`. `/health/ready` may be ready on `ahead`.
5. `0015`'s immediately-validated CHECKs still take `ACCESS EXCLUSIVE` for the table scan. That
   lock window is not fixed; do not rewrite `0015`.

## Consequences

Upgrade `c94bf5d` → this image is a no-op migrator (same 0015 checksum). Rollback this image →
`c94bf5d` works on the same schema. The first n1 extra is a *future* migration. Tests cover
declared extras, N-2 refusal, checksum/result-head mismatches, prefix holes, and that
`exactHeadMatches` (the `c94bf5d` rule) still refuses extras.
