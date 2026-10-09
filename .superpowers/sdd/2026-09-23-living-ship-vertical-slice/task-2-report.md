# Task 2 report: stable gesture surface and camera controls

## Result

Implemented camera input on the persistent `.stage` element. The controller tracks pointers across regenerated ship content, pans after an 8px drag, zooms about the moving two-finger midpoint, clears cancelled or lost captures, and suppresses native pointer clicks after handled taps and gestures. Stationary taps are unprojected into ship world coordinates. At overview scale a room tap focuses it; at closer scale it invokes the existing room action. Keyboard hotspot clicks remain available. The camera lives on the rendered root, outside player/save state.

The stage HUD now has Focus, Zoom in, and Zoom out buttons with 44px minimum dimensions. `touch-action: none` applies only to `.stage`. Focus animation is disabled under `prefers-reduced-motion` and interrupted on the next pointer down.

## RED / GREEN

- RED: `node test/ship_camera_input.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `src/ui/shipCameraController.js` before implementation.
- GREEN: The first controller tests passed after adding the controller. They cover drag to pinch without a false tap, cancellation and lost capture cleanup, stationary release coordinates, and listener cleanup.
- A later incremental-drag regression failed at `4 !== 8`: crossing the threshold in two 4px moves panned only the last 4px. The controller now applies the accumulated 8px. Pinch midpoint and rapid stationary taps are also covered.
- A release-only drag regression failed at `1 !== 0`: a displaced pointerup without a preceding move incorrectly tapped. The controller now classifies the release displacement and pans without invoking the room action.

## Verification

- `node test/ship_camera_input.test.mjs` — PASS.
- `npm test` — PASS, including 15 final-review tests.
- `npm run test:ship` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.

## Self-review and limits

The controller is attached once to `.stage`; regenerated `.ship-fit`, hotspots, and HUD controls do not own gesture listeners. Room coordinates use the authored 1,152×1,728 ship canvas and existing room rectangles. The native click suppression intercepts pointer clicks while allowing keyboard activation and HUD controls. The UI wiring was build-verified but was not checked on a physical phone or in a browser interaction run. No gameplay, combat, or save files were changed. Existing untracked `Mobile Game UI.jpg` and `package-lock.json` were left untouched.

## Review fix round 1

Added focused tests before changing the implementation. `node test/ship_camera_input.test.mjs` first failed for battle-active drag with `0 !== 20` at line 37: the controller rejected pointerdown while `camera-disabled` was present. Reordering the two new test blocks and rerunning the same command showed the independent lost-capture failure, `false !== true` at line 38: the following pointer click was not stopped.

The controller no longer gates pointer gestures on the battle state. The bridge no longer marks the stage camera disabled while fighting; it keeps room activation guarded during combat. Cancellation now suppresses the following native pointer click for 350ms, while subsequent stationary taps and keyboard clicks remain available.

GREEN after the fix:

- `node test/ship_camera_input.test.mjs` — `ship_camera_input.test.mjs OK`.
- `npm test` — PASS, 15 final-review tests passed.
- `npm run test:ship` — PASS, all five ship scripts passed.
- `npm run build` — PASS, Vite built 54 modules in 494ms.
- `git diff --check` — PASS.
