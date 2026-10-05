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
   mid-flight is never dropped. `duplicate` counts as "saved" (see Audit fixes F3 for the replay
   mapping: a `duplicate` still carrying a reason/flags maps to the ORIGINAL verdict).
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

## Audit fixes (2026-08-18)
Behaviour decisions taken while fixing the client audit findings F1/F3/F8/F9 (tests in
`test/unit/{boot-restore,sync-flows,verdicts,multi-tab,clock-storage,react}.test.*`,
`test/model/sync.model.test.ts`):

8. **Identity switch rebinds everything (F1).** `rebind()` retires the previous player's sync
   client (`SyncClient.retire()`: timers stopped for good, `push/beacon/autosave/bootRepush/
   shipJournal/adoptRemote` become no-ops, the slot and KV mirror are never written again — unlike
   `stop()`, a retired client cannot be `start()`ed), builds the new player's slot + sync, rebinds
   the journal spool key, and hands the binding to the boot machine (`BootMachine.rebind`). Every
   re-check path (visible after a long hide, `server_deeper`, broadcast, manual `recheck`) binds
   to the CURRENT sync for its whole step and abandons itself when the sync was swapped
   mid-flight. A sync client's `auth` is bound to ITS playerId (`identity.tokenFor(thatId)`), so a
   previous player's client can never carry the new player's token even if it were still called.
9. **Retry replay mapping (F3).** `duplicate` ⇒ verdict `duplicate` (anchored original: pending
   acked, `lastSyncedAt` set, "Saved to cloud"). A replayed `stored_refused` ⇒ the same
   `refused_*` verdict as the first time (pending retired as terminal — never acked, `lastAckedSeq`
   unchanged, local copy kept, `server_deeper` re-check as usual). A replayed `stored_quarantined`
   ⇒ `synced_quarantined` (pending delivered as "awaiting review", never "saved to cloud").
   Tolerant path: a `duplicate` that still carries a refusal reason maps to that refused verdict;
   one that carries quarantine flags maps to `synced_quarantined`. The test server model replays
   the same way from its commands rows and from its tombstones.
10. **pendingQuarantine on both head shapes (F8).** `RemoteHead.empty` carries
    `pendingQuarantine`; `reconcile` attaches it to `both_empty` / `remote_empty_local_present` /
    empty `remote_newer_generation` decisions; the boot machine exposes it in `BootState`, the sync
    client remembers the last head's value (`sync.pendingQuarantine()`), and `useSaveSync` exposes
    `pendingReview` — an empty-cache device against a player whose only writes are quarantined
    starts new but is told a save awaits review.
11. **Followers never mutate (F9).** Leadership is decided BEFORE the boot machine runs (so the
    leader's boot re-push and boot-time adoption persist actually happen with Web Locks present, and
    a follower never writes at boot). On demotion the loop AND the sync timers stop; `persist`,
    `kvMirror`, `push`, `beacon`, `autosave`, `shipJournal`, `needsPush` and the integrity flush are
    gated on `leader.isLeader()`; queued journal entries and integrity events are held in memory and
    ship after `playHere()`. The storage tier's memory overlay now holds only values the primary
    refused (quota/blocked): a value localStorage accepted is read back from localStorage, so
    "Play here" reloads the sibling tab's latest slot instead of this tab's stale overlay.
12. **Boot re-push leaves the envelope clean.** A slot that holds a pending is the snapshot the
    loop boots from, so `dirtySincePending` starts false; after the boot re-push ack the envelope
    is clean (no redundant re-write of the same state, and reconcile treats it as clean).
