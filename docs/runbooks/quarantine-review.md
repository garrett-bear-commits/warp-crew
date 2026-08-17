# Quarantine review

`GET /admin/v1/players/:playerKey` shows `pendingQuarantine`; the timeline shows flags. `POST /admin/v1/saves/reviews {playerKey, seq, action:'promote'|'reject', reason}` — terminal (a second review returns `review_final`); promotion re-validates under the player lock (blob present, active generation, ≥ anchor progress). Undoing a promotion means a new generation via `POST /admin/v1/players/restore` to the previous anchor seq.
