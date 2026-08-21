# Jest launch and Developer Console

Use this runbook for a real Jest build. It is intentionally separate from the local Playwright
suite: local mock/iframe evidence does not prove the hosted Jest shell, SDK, Simulator, or sandbox.
Official references reviewed 2026-08-20: [HTML5 SDK](https://docs.jest.com/sdk/html5),
[Manage games](https://docs.jest.com/dev-console/games), [Manage builds](https://docs.jest.com/dev-console/builds),
[Manage products](https://docs.jest.com/dev-console/products), [Manage images](https://docs.jest.com/dev-console/manage-images),
[Notifications](https://docs.jest.com/sdk/html5/notifications), [Payments](https://docs.jest.com/sdk/html5/payments),
[Sandbox users](https://docs.jest.com/testing/sandbox), and [Launch checklist](https://docs.jest.com/launch-checklist).

## Developer Console setup

- [ ] Create the game with an immutable lowercase slug. Record the game ID/audience and never put
      the shared secret or upload token in the client bundle.
- [ ] Set a support email; publishing requires one.
- [ ] Configure the listing name, description, approved square logo, approved 16:9 hero image,
      and loading-screen mode. Keep listing copy within the current Console limits.
- [ ] Configure every product SKU, name, description, and USD price in Products. The game must
      render `JestSDK.payments.getProducts()` values rather than a hardcoded checkout price.
- [ ] Upload notification assets in the Image Library and wait for approval. Use only approved,
      non-archived `assetReference` values (the older `imageReference` is deprecated).

## Build and hosting

- [ ] Build with `VITE_PLATFORM=jest`, the intended `VITE_API_URL` (prefer `/v1`), the chosen
      `VITE_AUTO_LOGIN_REMINDERS`, and an approved `VITE_NOTIFICATION_ASSET_REFERENCE`. Do not set
      `VITE_ALLOW_QA_QUERY` in a real build. Confirm the HTML includes the Jest SDK script before
      application code and that `JestSDK.init()` completes before any other SDK call.
- [ ] Prefer one static game origin with `/v1` reverse-proxied on that origin. Verify CSP
      `frame-ancestors https://jest.com https://*.jest.com`, CORS, no secrets, and no Node-only
      dependencies in the browser bundle.
- [ ] In Versions, choose **Add self-hosted URL**, enter the full URL, and create the version.
      Self-hosted URLs are an official Jest version type and are loaded verbatim in the iframe.
- [ ] Preview the version, then activate it explicitly. Record the version number and URL.
      ZIP upload remains a fallback.

## Simulator and sandbox evidence

- [ ] Run the exact active/preview version in the Simulator and save the self-review required by
      the Console before submission.
- [ ] Confirm no unhandled SDK errors; `getPlayer()`/`getPlayerSigned()` are called; `login()`
      preserves the same guest `playerId`; `JestSDK.data` set/delete/flush works; lifecycle
      hide/show/exit listeners unsubscribe; entry payload attribution is recorded.
- [ ] Confirm `setLoadingProgress` uses integer 0–100, `markGameLoaded()` is called once,
      `captureEvent()` emits non-PII stable names, and `markFirstMilestone()` is called.
- [ ] Confirm registered users receive the planned notification schedule. Every notification has
      valid one-of `scheduledAt`/`scheduledInDays`, identifier, body, CTA, attribution payload,
      and an approved asset. Test stale-identifier replacement after a meaningful return, verify a
      short tab switch does not reset the plan, and confirm the versioned per-player cursor rotates
      D1 copy/attribution after both a meaningful return and a cold relaunch. Do not promise exact
      delivery time; Jest may deliver at most one notification per user/day.
- [ ] Create a sandbox user and test login, guest→registered continuity, notifications, catalog
      display, purchase, crash/restart recovery, `hasMore` paging, and completion.
- [ ] Keep production `purchases.mintPremium=off` until paid payload validation and owner approval;
      the server must report `checkoutEnabled=false` and the UI must remain disabled. For a
      controlled sandbox-only Lab exercise, temporarily enable delivery on the isolated Lab server,
      verify that signed `sandbox:true` still grants zero, then turn the gate back off.
- [ ] Treat signed `sandbox: true` as authoritative before price. Current repository policy keeps
      sandbox `granted = 0`; do not change that constraint without owner approval. Official Jest
      guidance recommends delivering sandbox test items while excluding them from revenue and
      spend-based rewards, so this is an explicit pending product/ledger decision.
- [ ] Keep subscriptions out of this launch; the Jest subscription API is beta and deferred.

## Review submission and soak

- [ ] Confirm the game has an active version, support email, listing assets, products, approved
      notification assets, and a recorded Simulator self-review.
- [ ] Set the intended public/visible state in the Console. The docs use both “Public” and
      “Visible”; record the exact label shown by the current Console.
- [ ] Submit for review only after the Simulator checklist is complete.
- [ ] Run a 10+ minute mobile soak on real iOS Safari and Android Chrome: load, play, background,
      resume, platform exit/back, registration, notification return, purchase recovery, and no
      crash/freeze. Local mobile emulation is not a substitute.

## Evidence record

Record version, URL, game ID/aud, Console state, Simulator review link, sandbox user/test date,
device/browser results, notification identifiers, purchase/recovery outcomes, and unresolved
external gates. Re-review the linked Jest docs on each platform remediation or at least once per
release; update this runbook when official payloads, limits, or Console workflows drift.
