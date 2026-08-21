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
   `c94bf5d` 15-file head. A later release may add `-- foundation-n1-compatible` extras; *this*
   image can boot against them. `c94bf5d` cannot. Unreleased databases that applied a rewritten
   `0015`/`0016` are rebuilt from empty.
2. Each declared extra stores `extra_checksum`, `prefix_head`, `result_head`, and
   `compatible_with_head`. Boot `ahead` requires `compatible_with_head ===` this image's
   `expectedHead` (one prior image, not a chain), extra checksums to match applied rows, and
   `result_head` to match the running head after the extra. Consecutive n1 extras applied in one
   `migrateUp` share the same `compatible_with_head` (one release).
3. Disk files and applied names must be a unique contiguous ordinal chain. `migrateUp` requires
   applied rows to be a prefix of disk files in order.
4. Isolated restore requires `state === 'match'`. `/health/ready` may be ready on `ahead`.
5. `0015`'s immediately-validated CHECKs still take `ACCESS EXCLUSIVE` for the table scan. That
   lock window is not fixed; do not rewrite `0015`.

## Consequences

Upgrade `c94bf5d` → this image is a no-op migrator (same 0015 checksum). Rollback this image →
`c94bf5d` works on the same schema. The first n1 extra is a *future* migration. Tests cover
declared extras, N-2 refusal, checksum/result-head mismatches, prefix holes, and that
`exactHeadMatches` (the `c94bf5d` rule) still refuses extras.
