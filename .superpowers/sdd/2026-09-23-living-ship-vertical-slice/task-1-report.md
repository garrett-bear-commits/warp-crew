# Task 1 Report: Pure ship camera transforms

## Result

Implemented the presentation-only camera math in `src/ui/shipCamera.js` and added focused coverage in `test/ship_camera.test.mjs`. The module exports `makeCamera`, `project`, `unproject`, `pan`, `zoomAt`, `resizeCamera`, `focusCamera`, and `clampCamera`. Camera updates return fresh values; the module has no dependencies and does not touch combat or save state.

## TDD evidence

RED: after adding the test and before adding the module, `node test/ship_camera.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `src/ui/shipCamera.js`, as expected.

GREEN:

- `node test/ship_camera.test.mjs` — passed (`ship_camera.test.mjs OK`).
- `npm run test:ship` — passed all five existing ship tests.
- `npm test` — passed; 15 final-review tests passed, zero failed, and all preceding scripts reported OK.

Assertions cover inverse projection, actual midpoint-stable zoom with a scale change, extreme narrow-viewport overlap, near-scale derivation and target floor, centered fit, bounded pan, resize center retention, focus centering, finite viewport handling, and immutable return values.

## Camera scale and bounds

The far limit uses the 1,152×1,728 ship with a 55% framing margin. The near limit uses the smallest authored room hit width (19% of world width), framing about 2.5 such rooms across the viewport while keeping that room at least 44 CSS px wide. `clampCamera` guarantees overlap of at least `min(viewport extent, 20% of rendered world extent)` per oversized axis; if the world fits an axis, it is centered on that axis. Invalid dimensions fall back to positive finite defaults; non-finite coordinates and movement values are guarded.

## Files and scope

- `src/ui/shipCamera.js` — new transform, bounds, scale, and validation functions.
- `test/ship_camera.test.mjs` — new real-module tests.

No dependencies added. No combat/save files changed. Existing untracked user files were preserved and excluded from the commit.

## Self-review

- Projection math follows the specified world-origin screen offset convention.
- Zoom preserves the anchor world point except where boundary clamping necessarily constrains the requested frame.
- Resize carries the old viewport-center world coordinate to the new viewport center, then clamps the result.
- Scale limits are recomputed from the current viewport and world dimensions.
- Focus and pan are clamped and do not mutate the original camera.
- Tests exercise the module directly without mocks.

## Commit

Commit `1c16e6f1cc15c8743e10f021ce79d5795e1cec27` contains only the two task files above. The report itself remains outside the commit as requested.

## Review round 1 fixes

### RED

Updated `test/ship_camera.test.mjs` first to exercise a real zoom-in from below the max scale, a 100×1,000 viewport panned by a very large delta, a world that fits the viewport, and the authored 19% room-width scale rule. Before the production fix, `node test/ship_camera.test.mjs` failed at the new actual zoom anchor assertion:

```text
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  assert.ok(Math.abs(unproject(enlarged, midpoint).x - before.x) < 0.001)
    at test/ship_camera.test.mjs:15:8
```

The test stopped at that first assertion, so later new cases were not reached in this RED run. They remain direct regression assertions in the passing test.

### GREEN

- `node test/ship_camera.test.mjs` — passed (`ship_camera.test.mjs OK`).
- `npm run test:ship` — passed all five existing ship tests.
- `npm test` — passed; all scripts reported OK and final review reported 15 passed, zero failed.

The overlap clamp now uses the true viewport/world intersection bounds, and centers a rendered world axis whenever it fits. The focused station width now derives from the authored smallest room hit width, with the 2.5-room framing rule and 44px minimum floor. The zoom regression starts at 80% scale and zooms in by 10%, below the max limit, so it verifies an actual scale change and midpoint stability.

### Fix commit

Commit `f988757b5c321d1be31cf1c8f0a89b185a7f8ca1` contains only `src/ui/shipCamera.js` and `test/ship_camera.test.mjs`. This report remains uncommitted.
