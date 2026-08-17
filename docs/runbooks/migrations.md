# Migrations

1. Add `packages/server/src/db/migrations/NNNN_<feature>_<what>.sql` (one tx per file; expand/contract; renames via views; N-1 compatible with the running image).
2. Locally: `pnpm db:up && DATABASE_URL=postgres://postgres:postgres@localhost:55432/foundation_dev pnpm migrate --up`, then `pnpm migrate --check schema.sql --write` and review the diff of `schema.sql`.
3. CI runs `pnpm test:pg` (migrations from empty on postgres:16).
4. Release: run `migrate --up` as the migrator role BEFORE starting the new image (release command / pre-deploy step). The app refuses to serve when the head or checksums mismatch or files are pending (`/health/ready` → 503, boot throws).
5. `--repair`: only after a reviewed, no-op edit to an already-applied file (comment fix). Re-records checksums. Never use it to hide a real drift; write a new migration instead.
6. Rollback: N-1 rule means the previous image runs against the new schema; roll the image back, keep the schema, write a follow-up contract migration.
