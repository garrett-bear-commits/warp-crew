# Task 8A implementer report — no-cost visual foundation

## Result

- Replaced the 360px opening card with a viewport-filling provisional cockpit scene, separate SVG/CSS Warp Crew mark, dark text/action plate, and a real essential-image progress bar. Board is disabled until all seven essential image entries settle. The saved `splash-dismiss` action is unchanged.
- Added a six-key `ART_VERTICAL_SLICE` manifest with measured pixel dimensions, SHA-256 of existing source bytes, explicit existing fallback paths, and `status: 'provisional'`. No final art is claimed.
- Added timed image probes and `preloadEssentialAssets`: primary and fallback attempts settle per entry; progress counts only completed entries; zero sources report 100; double failure returns null and still lets loading finish. Successful fallback portraits are used by later renders. Splash falls back to CSS if both scene paths fail.
- Shortened first-session station, guided Brace, name, pull, and registration text. The save statement now says progress is in this browser, without cloud or cross-device claims. Mapped first-session blocked-action reason codes to human instructions. The ship-name input now matches the existing 24-character rule.
- Corrected the fresh script-4 starting camera after a phone capture showed the ship still opened at overview scale. The bridge now sits near the upper third at close zoom, revealing the central corridor and work rooms beneath it.
- Added a provisional style bible, art ledger, and before/after copy inventory.

## TDD record

- RED: missing `artManifest.js`/`essentialPreload.js` and unexported splash renderer; focused tests failed before implementation.
- RED: browser-save and guided Brace copy assertions failed on prior text; implementation then made them GREEN.
- RED: opening-camera test failed first on missing helper, then on centered bridge after the 360/390 capture showed excessive empty space. The final upper-third framing passed.
- RED: resolved-fallback portrait test failed on missing application function; the runtime now applies loaded fallback paths.
- GREEN: `node test/asset_manifest.test.mjs`, `node test/first_session_copy.test.mjs`, `node test/ship_camera_opening.test.mjs`, and `node --test test/tutorial_v4_session.test.mjs` (9/9).

## Browser capture and measurements

Local Vite preview `http://127.0.0.1:5173/?fresh=1`, Chrome task tab, local mock (no Jest host), source branch `codex/contract-route-overhaul`. Reload with `fresh=1` for each opening shot, then click Board for ship shots. Screenshot files are ignored scratch captures in this plan workspace:

- `captures/task-8a-splash-360x800.png`
- `captures/task-8a-splash-390x844.png`
- `captures/task-8a-ship-360x800.png`
- `captures/task-8a-ship-390x844.png`

At 360×800 and 390×844, document scroll dimensions equaled the viewport. Splash Board was 52px high with 18px text; the backing copy plate was 320px wide at 360. First ship instruction was 18px, its button 44px high, and stage remained behind the cue. These are desktop Chrome viewport captures, not physical-phone or Jest-host QA. No image-load failure was manually forced in Chrome; the rejection/fallback/zero-source paths were exercised by the focused test.

## Verification and limitations

After the camera correction and resolved-portrait fallback, `npm run test:loop`, `npm run test:ship`, `npm run test:balance`, `npm test`, `npm run build`, and `git diff --check` all passed. The balance reports regenerated unchanged (16 encounters / 192 rows; 15 runs of 30 days). This exact tested state was committed as `96a8673` (`feat: build provisional first-session visual shell`).

The `jump.png` cockpit art is landscape and the layered Bolt/Nemi cutouts are placeholders. It does not yet show the requested finished mixed crew/planet/nebula composition. Crew in the near-bridge ship view are still tiny and low-contrast; that remains a concrete Task 8B/9 visual gate. True phone touch, guided beat timing, and Jest-host registration overlay also remain unverified. No Flora generation, purchase, push, merge, deployment, or Jest activation occurred. Art batch cost approval remains pending.

## Review fix round 1 — first-session actions

- RED: the live 360×800 local preview computed Brace at 15px with a pale-blue primary fill, while the ship cue was already 16px. A focused test covering Brace, Continue fight, and Bring cargo aboard failed on the missing first-session encounter-button rule.
- GREEN: first-session combat buttons now have 16px text and a 44px minimum height. First-session primary actions share the splash amber accent. The scoped CSS leaves later-session controls unchanged.
- At 360×800 and 390×844, live Chrome computed Brace at 16px, amber `rgb(241, 182, 107)`, and 62px high; Bring cargo aboard at 16px, amber, and 44px high. Continue fight is rendered in the test and shares the same CSS selector, but its brief auto-advancing state was not live-measured. Viewport override was reset after capture. These are local browser checks, not physical-phone or Jest-host QA.
- `node test/first_session_controls.test.mjs`, `node test/first_session_copy.test.mjs`, `node test/asset_manifest.test.mjs`, `node test/ship_camera_opening.test.mjs`, `node --test test/tutorial_v4_session.test.mjs` (9/9), `npm run test:loop` (15/15), `npm run test:ship`, `npm run test:balance`, `npm test`, `npm run build`, and `git diff --check` passed. Balance artifacts stayed unchanged.
- Crew readability remains deferred to Task 8B/9. No art generation, push, merge, deployment, or Jest activation occurred.
