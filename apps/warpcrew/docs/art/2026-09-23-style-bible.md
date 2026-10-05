# Warp Crew first-session visual direction

The opening should feel like a working mercenary ship, seen from inside. At phone size the crew should be recognizable before text is read: a human, an alien, a droid, and an odd silhouette sharing a lived-in bridge, with a vivid planet or nebula beyond the window. The player must see a ship worth entering.

## Pixel-art craft

- High pixel count with intentional hard clusters, clean silhouettes, and crisp material edges. Avoid blurred paint, photoreal skin, plastic gloss, and tiny low-resolution sprites enlarged without care.
- One light story: cool cyan instruments inside, warm amber hazard/window rim, rich violet/cobalt space outside. Faces and tools receive enough local contrast to read on a 360px phone.
- Industrial but inviting: worn steel frames, visible station consoles, doors, corridors, and usable handholds. Each crew identity should survive a head crop and a full-body station pose.
- Stage art stays behind UI. The Warp Crew wordmark and loading bar are separate HTML/SVG/CSS elements, never baked into the painting.

## First-session hierarchy

1. Opening: full viewport illustration, clear wordmark, one dark-backed loading/Board area. Board is the only action.
2. Ship: bridge and crew are the subject; the short bottom cue says the next action. HUD and camera controls remain legible but quiet.
3. Threat: visible pirate/ship motion and hull/shield bars; Brace is the single emphasized order in the guided fight.
4. Reward: cargo and reputation should visibly join the ship, followed by the third berth, ship name, and free crew reveal.

On mandatory screens use at least 16 CSS px player text, 18 px instructional body, 44×44 px tap controls, and padding for device safe areas. Text over art needs a solid dark plate. Amber marks the one primary action in this slice; cyan identifies ship systems, red marks damage. Do not rely on hue alone for a threat or reward.

## Current implementation and limits

Task 8A uses `jump.png` as a provisional full-bleed cockpit scene with existing Bolt/Nemi portraits layered into the crop, a separate CSS/SVG wordmark, and a dark loading/action plate. This is a layout prototype that can be inspected on a phone. The final art batch must replace the scene and identity sheets only after art approval, provenance logging, and true-size visual QA. Retain the same separate logo/progress UI when replacing the image.
