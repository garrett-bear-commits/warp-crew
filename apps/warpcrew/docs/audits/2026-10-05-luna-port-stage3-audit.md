# Luna audit: game-core port, client (stage 3) (2026-10-05)

Codex `gpt-5.6-luna` (medium) read-only audit of commits 255d5d5, 2629c96 and a8992e7. Every finding was fixed in 328630f with regression tests; see `apps/warpcrew/docs/game-core-port.md`.

Found 7 bugs.

1. **High — grant can be permanently lost in a follower tab**  
   `apps/warpcrew/src/core/purchases.js:43-50, 128-145`  
   Boot recovery and pending-grant claiming run in every tab. A follower can successfully claim a server grant, then `applyGrant()` returns false because `client.dispatch()` rejects followers (`apps/warpcrew/src/core/client.js:181-190`). The grant is already consumed server-side, so it is never applied or saved. Recovery also marks the purchase complete after ignored claim failure.

2. **High — Jest purchase completes before the grant is durably saved**  
   `apps/warpcrew/src/core/purchases.js:120-125`; `apps/warpcrew/src/core/client.js:187-191`  
   `applyGrant()` starts `save('immediate')` but does not await it. `buy()` immediately calls `payments.complete()`. A crash between completion and the save/push leaves Jest considering the purchase complete while the grant is absent from durable state. The same issue exists in recovery at lines 141-143.

3. **High — malformed ownership response still opens one-time checkout**  
   `apps/warpcrew/src/core/purchases.js:53-60, 79-83`  
   Any successful response whose body lacks a valid `oneTime` array is converted to `[]`. A `200 {}`, empty/invalid JSON normalization, or schema mismatch is therefore treated as “owns nothing,” and checkout opens despite ownership being unknown.

4. **High — subscription proof replay can reactivate perks and extend grace**  
   `apps/warpcrew/src/systems/subscription.js:86-103`  
   The verifier passes response-level `issuedAt`, but `applyEntitlements()` only reads `entry.issuedAt`. Real subscription entries do not contain that field, so `verifiedAt` becomes the local `now`. Replaying an older still-valid signed active list after cancellation is treated as newer and reactivates perks. The 72-hour grace also starts at receipt time instead of the proof’s `issuedAt`, allowing grace beyond the intended window.

5. **Medium — real Jest builds without a configured server can use free mock purchases**  
   `apps/warpcrew/src/core/client.js:76-81`; `apps/warpcrew/src/core/purchases.js:95-99`  
   In a real Jest shell with no compiled `VITE_WARPCREW_SERVER`, `online` is false, so the client deliberately selects the mock platform and locally grants products. A production Jest build missing the server variable can therefore expose mock purchases and free grants, contrary to the README/invariant that real Jest purchases must be disabled without verification.

6. **Medium — trusted server time is bypassed for daily rewards and expedition completion**  
   `apps/warpcrew/src/main.js:303, 323`; `apps/warpcrew/src/core/client.js:77-84`  
   `applyDailyLogin()` and `resolveExpedition()` use their `Date.now()` defaults during hydration, even though the core clock is already server-anchored. A device clock moved forward can claim a daily reward or finish an expedition early while online.

7. **Medium — equal-depth legacy import can clobber newer state**  
   `apps/warpcrew/src/core/legacy.js:47-53`; `apps/warpcrew/src/core/client.js:241-245`  
   Import uses `legacyProgress >= currentProgress`. An equal-depth legacy save can overwrite a newer core save’s wallet, crew, hull, flags, or purchase state. The existing test covers only deeper and shallower legacy saves, not equal-depth conflict.

The existing client test suite passes, but it does not cover these failure scenarios. No files were modified.


