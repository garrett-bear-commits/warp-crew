# Task 6 UI cue reference — 2026-09-24

Garrett's addition: consider dark overlays while pop-ups direct a button press, a glow/pulse on that button, and small red dots to guide new players. This refines the approved captain-first slice, not the combat/save rules.

## Read-only reference findings

- Apple onboarding guidance favors a short, interactive lesson and contextual instruction close to the element it describes: https://developer.apple.com/design/human-interface-guidelines/onboarding
- Android mobile onboarding guidance favors just-in-time feature discovery over modal explanation: https://developer.android.com/design/ui/mobile/guides/patterns/onboarding
- Apple motion guidance says attention animation should be purposeful, brief, optional, and not the only signal: https://developer.apple.com/design/human-interface-guidelines/motion
- Android badge guidance treats badges as new/unread/actionable state, not ornamental chrome: https://developer.android.com/develop/ui/compose/components/badges
- Barrowdeep checkout `/Users/garrettdare/Idle Dungeon RPG` at `0ca5370e` contains `src/ui/CoachVeil.tsx` (dark scrim plus elevated clickable target and separate caption), `src/index.css` coach-pulse and inset variant, and semantic attention derivation in `src/engine/tutorial.ts`. That checkout is NOT proven to be the current live build: its `package.json` differs from a 2026-09-20 handoff's active Jest version; the existing Chrome Barrowdeep tab points at an older explicit version ID. Treat as source-pattern reference only.

## Task 6 acceptance interpretation

- Use a scrim only when the next button/station is a specific taught action; keep the actual ship/combat event visible when its meaning matters.
- Elevate the real target, not a duplicate proxy; target remains tappable and keyboard-focusable. Other taps cannot accidentally choose an action.
- One primary amber pulse at a time, within edge bounds. `prefers-reduced-motion` keeps a static outline and the same text cue.
- Use red dots after onboarding for genuinely new/ready actionable containers, not every UI button. Clear after open/resolve, and include a label/icon for non-color comprehension.
- Test 360 and 390 phone viewports for caption/target overlap, safe areas, stacking, and stale badge state after reload.
