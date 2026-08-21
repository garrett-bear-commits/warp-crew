# Pause a SKU / switch off a command

`POST /admin/v1/liveops/kill-switches {target:'sku'|'command', id, enabled:true, reason}`. SKU switches are advertised in `GET /v1/config.killSwitches.skus` (clients hide the pack). The `purchases.verify` command switch is the family-level purchase incident control: it disables checkout readiness and refuses both direct and batch verification with 403. Other command switches refuse their exact command (`codes.redeem`, ...). Re-enable with `enabled:false`.
