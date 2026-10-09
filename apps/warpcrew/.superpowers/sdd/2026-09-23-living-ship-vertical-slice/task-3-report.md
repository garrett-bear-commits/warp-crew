# Task 3 report — shared world projection

## Result

Implemented deterministic space landmarks and world-anchored combat effects against the camera from Tasks 1–2. Crew canvas dimensions now remain 1152×1728 world pixels inside the already transformed `.ship-fit`; camera zoom is applied once. The battle HUD remains in screen space. No save, combat resolver, reward, or authoritative outcome code changed.

## TDD evidence

1. Wrote `test/world_projection.test.mjs` first. The test asserts `worldProjection` and `effectScreenPoint` literal coordinates; stable landmark world coordinates for shared IDs after pan/resize/zoom; and a changed layout for a different seed.
2. RED command: `node test/world_projection.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/ui/worldProjection.js`, the expected missing-feature failure.
3. Implemented `worldProjection.js` with `project` delegation, per-draw effect projection, and a local seeded PRNG. GREEN command: `node test/world_projection.test.mjs` exited 0, `world projection tests passed`.
4. Self-review caught that the initial world-space space renderer omitted the preexisting black-hole art. Added a test requiring a visible `hole` in a wide view. RED command: `node test/world_projection.test.mjs` exited 1 with `AssertionError: the existing black-hole landmark remains in the world`. Restored the landmark and image/fallback draw. GREEN command exited 0, `world projection tests passed`.

The landmark expectation is independent of the function under test: common IDs must keep their literal `worldX/worldY` pairs under camera changes, and another seed must change the generated layout. This replaces the brief's self-equality assertion.

## Implementation files

- `src/ui/worldProjection.js`: camera delegation, frame-time effect projection, cached seeded landmarks in stable world coordinates, viewport culling.
- `src/ui/spaceFlight.js`: draws stars, planets, nebula, black hole, and moving rocks through the camera; missing images use drawn fallbacks; art loads do not gate startup.
- `src/ui/combatView.js`: stores pirate, laser, and spark positions in world coordinates and projects them on every draw. HP bars stay in screen coordinates at the bottom of the stage so they do not cover the stage HUD. The existing `win` input and callback still govern the presentation sequence.
- `src/ui/crewWalk.js`: fixes the canvas bitmap to 1152×1728 within `.ship-fit`; missing walk art uses the existing cyan shape instead of creating an unloaded `Image` each frame.
- `src/ui/bridge.js`: supplies the camera getter and fixed seed; hull art failure retries the existing cutaway via `artUrl`, then leaves a solid hull-layer fallback if both images fail.
- `test/world_projection.test.mjs`: focused projection, seed, camera-stability, and preserved-landmark assertions.

## Verification

- Final `node test/world_projection.test.mjs`: exit 0, `world projection tests passed`.
- Final `npm test`: exit 0; all existing chained tests and 15 `final_review` tests passed, 0 failed.
- Final `npm run test:ship`: exit 0; layout, pathing, animation, view, and debug tests passed.
- Final `npm run build`: exit 0; Vite transformed 55 modules and built `dist/assets/index-CXolLRuz.js`.
- `git diff --check`: exit 0.
- Local Chrome at 390×844: captured and inspected full-ship overview, close zoom, and battle overview through the browser screenshot tool. Hull, crew, hotspots, landmarks, and battle ships remained aligned in those views. The first battle capture exposed overlapping HP bars; after moving them, the second battle capture showed the bars above the bottom navigation and separate from the top stage HUD. Browser console error log was empty. These screenshots are in the tool record; no image files were written to the worktree.

## Self-review and remaining limits

The diff is limited to the six Task 3 source/test paths. Existing untracked `Mobile Game UI.jpg` and `package-lock.json` remain untouched. The optional-image fallback paths were inspected in code, but missing-image behavior was not forced in the browser. The browser checks used a local mock at 390×844, not a physical phone or Jest host. The short combat animation was visually sampled at overview; continuous pan during the animation was covered by per-frame projection structure and pure projection assertions, not a recorded gesture capture.

## Review fix round 1

Three Important findings were addressed in a descendant commit. The work now changes `src/ui/combatView.js`, `src/ui/bridge.js`, `src/ui/spaceFlight.js`, `src/ui/style.css`, `test/world_projection.test.mjs`, and `test/contract_ship_feedback.test.mjs`.

- Battle framing: `attachCombat` accepts the camera setter, and `playCombat` applies a presentation-only whole-ship overview before its first draw. Later gestures continue to use the same camera controller. RED: after adding the integration assertion, `node test/world_projection.test.mjs` exited 1 with `combat applies a camera overview before drawing`, actual setter calls 0 versus expected 1. GREEN: after wiring the setter and overview, the command exited 0. The test checks that the close view widens and both ship anchors fit in safe viewport bounds. An attempted exact midpoint assertion was discarded: Task 1's clamp centers the entire rendered world when it fits the viewport, so demanding an exact midpoint for only the two anchors would force a clamp change or clip the hull. Safe visibility and a complete hull are the battle framing contract here.
- Focus alignment: removed the `.ship-fit.is-focusing` transform transition and its class/timer path, so hull, hotspots, feedback, crew, space, and combat all use the destination camera immediately. At 390×844 in local Chrome, computed `.ship-fit` transition duration was `0s` before and after Focus. Its transform changed from scale `0.240815` to `0.712719` immediately. This CSS behavior was verified in the browser; the Node suite has no CSS renderer for an automated transition assertion.
- World-canvas contract: baseline RED `node test/contract_ship_feedback.test.mjs` exited 1 because it expected old 100×100 canvas coordinates, while observed crew feet were world pixels (for example x `541.44`, y `1106.92`). The test now asserts a 1152×1728 bitmap and normalizes sampled feet back to authored percent coordinates after removing the 1-world-pixel shadow offset; Airlock, station, departure, arrival, reduced-motion, and ownership assertions remain. A subsequent RED reached `normal space drift resumes` because a no-getter `attachSpace` produced no draw. It now uses a compatible default camera and seeds initial moving rocks. GREEN: `node test/contract_ship_feedback.test.mjs` exited 0, `contract_ship_feedback.test.mjs OK`.

Final review-fix verification after the last edit: `node test/world_projection.test.mjs` passed; `npm run test:loop` passed including `contract_ship_feedback` and 15 final-review tests (0 failures); `npm run test:ship` passed all five named ship tests; `npm test` passed including 15 final-review tests (0 failures); `npm run build` exited 0 after transforming 55 modules; `git diff --check` exited 0. A local Chrome 390×844 battle capture after entering from a close focus showed both ships and the whole hull at scale `0.218414`, with HP bars separated from the stage HUD; computed transform transition remained `0s`, and browser error logs were empty. The capture is in the tool record, not an on-disk file. No physical-device or Jest-host check was performed in this round.
