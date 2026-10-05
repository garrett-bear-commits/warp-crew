# server_behind → lineage.reattach

Symptom: clients report verdict `server_behind` (their generation is ahead of the server's after a restore to an older point). Clients stop pushing and alarm.

1. Confirm with the inspector: player generation on the server < generation the client shows in the SyncPill diagnostics.
2. Enable reattach for the deployment: `INSERT INTO liveops_settings (key, value, reason, actor) VALUES ('reattach_enabled', 'true', '<ticket>', '<you>') ON CONFLICT (key) DO UPDATE SET value = 'true'` (or the admin key via SQL runbook access) — the liveops cache refreshes within 30 s.
3. Clients call `POST /v1/lineage/reattach {clientGeneration, expectedServerGeneration, snapshot}`; the server opens generations up to the client's number seeded from the client snapshot (source `reattach`) and both sides agree again.
4. Watch `/health/ops` and the `generations` table (`kind = 'reattach'`), then disable the setting.
