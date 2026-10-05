# Reset all players

Starts every non-erased player on a fresh save. It gives each player a new `restart`
generation (`apps/server/src/ops/reset-players.ts`). A newer server generation always
wins on the client, even when it holds no snapshot. A client in session starts fresh
on its next push (refused `stale_generation`), and any other client starts fresh on
its next boot.

Emptying the save tables does not reset anyone: a client whose server copy is empty
uploads its local save again.

What carries over:

- Old generations keep their snapshots. Restore one player with
  `POST /admin/v1/players/restore {playerKey, seq, expectedGeneration}` (scope
  `restore`) to a seq from before the reset.
- Server ledgers are untouched: purchases, grants, daily claims, names, `players`.
- A fresh save holds no purchase receipts, so the client's purchase recovery
  delivers every minted (paid and, where `mintSandbox` is on, sandbox) purchase again,
  at its original amount. Players who bought premium currency get their lifetime
  purchased amount in the new save, including what they had spent. The dry run reports
  `purchasers` and `purchasedGems`.

## Run

1. Pick a batch UUID and keep it: `uuidgen | tr A-Z a-z`. Re-running the same batch
   skips players it already reset (each player's `restartId` derives from the batch and
   the player key), so an interrupted run resumes safely.
2. Run it where the database is reachable, with that environment's `DATABASE_URL`. If the
   database has no public address, run it inside the API's own container or host.
3. Dry run (the default) and check `players`, `purchasers` and `purchasedGems`:

   ```bash
   node --experimental-strip-types apps/server/src/cli/reset-players.ts --batch <uuid> --reason "<why>"
   ```

4. Apply with the same batch and reason, adding `--apply`. Each player resets in its
   own transaction under the save path's player lock. The output also counts `reset`
   and `alreadyReset`.
5. Verify: `SELECT kind, count(*) FROM generations g WHERE generation = (SELECT max(generation) FROM generations WHERE player_key = g.player_key) GROUP BY kind`
   shows every live player on `restart` (plus any `erased`). `admin_actions` has one
   `lineage.resetAll` row per applied run.

Test: `apps/server/test/pg/reset-players.test.ts`.
