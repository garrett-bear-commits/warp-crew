# ADR-029 Client sync decisions taken while implementing §5.2

Date: 2026-08-18. Status: accepted.

## Context
§5.2 fixes the wire contract and the invariants but leaves a few client-local choices open. Each
was resolved with the safest minimal option and is asserted by unit/model tests in `packages/client`.

## Decisions
1. `sessionId` is minted once per device slot (origin-scoped, per player) and persisted in the
   cache envelope; it is not per boot. The server surfaces `sessionId ≠ head.sessionId` as
   divergence, so a per-boot id would flag every reload as divergent. The first push after
   adopting another device's head is therefore `synced_divergent` (anchored, with the other
   writer named); the status line reads "Saved to cloud … (another device also saved)".
2. A pending push keeps its `commandId` for as long as the encoded snapshot is byte-identical;
   a changed snapshot mints a new id. Acks are matched by the sent commandId so a beacon minted
   mid-flight is never dropped. `duplicate` counts as "saved" only when the replayed result carries
   no refusal reason or quarantine flags.
3. `refused_regression` triggers an immediate bounded head re-check + reconcile (adopt or prompt),
   not only at the next boot/visible.
4. Blob format is `{"schemaVersion": n, "state": …}` with numbered k→k+1 migrations; gzip+b64 is
   used only when `CompressionStream` exists and the encoded form is frozen with the pending push
   (never re-encoded on retry). A beacon larger than 64 KiB is skipped — the boot re-push carries it.
5. "Returning identity" = a local slot exists, or the player is registered, or the
   `lastKnownPlayerId` matches → empty cache + unreachable cloud shows the "cloud unreachable —
   retry / start new" state; a genuinely new identity starts a new save immediately.
6. Identity switch: a guest at progress 0 is neither pushed nor carried; a shallower guest against a
   deeper account resolves to `needs_admin` without touching state.
7. The loop refuses (and reports as `game_error`) an `onGap` result that raises `progressOf`.

## Consequences
The model-based suite encodes these as invariants; changing any of them means changing the model.
