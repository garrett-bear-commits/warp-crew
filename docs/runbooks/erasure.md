# Erasure

`POST /admin/v1/players/erase {playerKey, reason, ticketRef}` (scope `erase`): opens a generation of kind `erased`, `erase_player()` drops blobs/summaries/journal/integrity/entry payload/display name/feedback, writes an `erasures` ledger row (mirrored with backups and replayed after any restore — see restore-drill). The client sees `erased: true` on boot and `403 {erased:true}` on writes.
