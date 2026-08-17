# Pause a SKU / switch off a command

`POST /admin/v1/liveops/kill-switches {target:'sku'|'command', id, enabled:true, reason}`. SKU switches are advertised in `GET /v1/config.killSwitches.skus` (clients hide the pack); command switches refuse the command with 403 (`purchases.verify`, `codes.redeem`, ...). Re-enable with `enabled:false`.
