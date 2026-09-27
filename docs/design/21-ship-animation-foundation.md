# Ship and animation foundation

Status: implemented and desktop-phone verified in isolated worktree; integration and real-device review pending  
Parent direction: [Warp Crew product direction](20-product-direction-draft.md)  
Art inspected: `public/art/space/sparrow-hull-v3.png` at 1152 by 1728 and `public/art/char/walk-4dir.png` at 384 by 384

## Package outcome

The Sparrow home becomes a trustworthy, legible phone interaction surface. Each visible compartment owns its own tap region and crew destination. Crew use the actual four-direction walk frames at a readable size with a stable foot anchor and no synthetic bobbing.

This package does not redesign the daily loop, combat rules, store, or economy. It creates the spatial and animation foundation those packages will use.

Implementation evidence: [Ship and animation QA](../qa/2026-09-21-ship-animation-foundation.md)

## Visual interpretation of the current Sparrow art

The source art contains nine visibly separated compartments connected by a central spine:

| ID | Player label | Visible content | Primary system | Default role |
|---|---|---|---|---|
| `bridge` | Bridge | captain's chair and navigation wall | none | pilot |
| `operations` | Operations | console bank, upper-left | sensors | scout |
| `medbay` | Medbay | diagnostic bed, upper-right | medbay | medic |
| `quarters` | Quarters | four bunks, middle-left | quarters | none |
| `workshop` | Workshop | fabrication counter, middle-right | weapons | gunner |
| `cargo` | Cargo Hold | stacked freight, lower-left | cargo | trader |
| `mess` | Mess | table and chairs, lower-right | none | none |
| `stores` | Stores | secured crates, bottom-left | cargo | security |
| `engineering` | Engineering | machinery, bottom-right | engines | engineer |

The exterior thrusters are an effect anchor, not a tappable room. The central spine is navigable but not selectable.

## Normalized layout manifest

All geometry is expressed as percentages of the 1152 by 1728 source image. One `SPARROW_LAYOUT` manifest owns:

- `rooms`: identity, label, system, role, hit polygon, walk bounds, work anchor, label anchor, and door ID;
- `doors`: an ID, spine coordinate, and room coordinate;
- `halls`: rectangular walkable regions down the central spine and bridge neck;
- `blockers`: non-walkable furniture ellipses or rectangles;
- `effects`: thruster anchors;
- `sourceSize`: `{ width: 1152, height: 1728 }`.

Initial compartment bounds follow the visible floor plates, inset from the walls:

| Room | Left | Top | Width | Height |
|---|---:|---:|---:|---:|
| Bridge | 38% | 10% | 24% | 13% |
| Operations | 28% | 25% | 19% | 14% |
| Medbay | 54% | 25% | 19% | 14% |
| Quarters | 27% | 40% | 20% | 14% |
| Workshop | 54% | 40% | 20% | 14% |
| Cargo Hold | 25% | 56% | 22% | 16% |
| Mess | 54% | 56% | 21% | 16% |
| Stores | 24% | 73% | 23% | 13% |
| Engineering | 54% | 73% | 22% | 13% |

These bounds are starting coordinates derived from the art. The implementation must include a development-only overlay and a 390 by 844 rendered review so the final values can be corrected against the image before acceptance.

## Hit-region contract

1. Every room has one visible-floor polygon; rectangular rooms may use four points.
2. The rendered button uses `clip-path: polygon(...)` based on that polygon.
3. The accessible label uses the player label, system level when applicable, and current alert.
4. A selected room shows a subtle floor tint and a readable external label; persistent 10px labels over the art are removed.
5. On phone, each region must contain at least a 44 by 44 CSS-pixel selectable area at the rendered ship size.
6. Hit polygons cannot overlap. Boundary ownership is deterministic.
7. Tapping the corridor or ship hull does not guess the nearest room.
8. A development overlay can show polygons, labels, doors, walk bounds, blockers, and the point selected by the last tap.

The old `roomAt()` nearest-room fallback is not used for input. Movement may retain its current room when a coordinate is in a corridor.

## Navigation contract

- Each compartment connects to the central spine through one authored door.
- A route from one room to another exits through the origin door, travels through the spine, and enters through the destination door.
- A crew destination is sampled inside the room's walk bounds and then clamped to walkable space.
- Furniture remains excluded from walkable cells.
- Paths are four-connected and may be string-pulled only when the line remains walkable.
- Tests must prove all rooms are mutually reachable and no returned point is unwalkable.
- The corridor is a movement region, not a room assignment.

## Ninefold walk-sheet contract

The current sheet is four columns by four rows. Rows remain:

1. down;
2. left;
3. right;
4. up.

Each 96 by 96 cell contains substantial transparent padding. The standard humanoid profile starts with:

```js
{
  id: 'standard_humanoid',
  sourceCell: { width: 96, height: 96 },
  frameCrop: { x: 24, y: 12, width: 48, height: 72 },
  footAnchor: { x: 24, y: 66 },
  displayHeight: 52,
  shadow: { width: 18, height: 5, offsetY: 1 },
  framesPerDirection: 4,
  fps: 7
}
```

`frameCrop` is local to each source cell. `footAnchor` is local to the crop. The renderer places the foot anchor at the actor's path coordinate, so changing direction or frame cannot move the feet. The initial crop is deliberately conservative and must be checked against every direction in the rendered proof.

## Drawing contract

1. A pure frame helper returns the source rectangle from direction, frame, and profile.
2. A pure placement helper returns the destination rectangle from path coordinate, crop aspect ratio, foot anchor, and display height.
3. Walking advances all four sheet frames at the profile frame rate.
4. Idle uses the first directional frame until a compatible directional idle exists.
5. Working may use the existing doing strip, but switching states cannot shift the foot position.
6. No sine wave, CSS translation, or state-specific vertical offset may alter the actor's grounded position.
7. The shadow remains anchored to the path coordinate and does not bob.
8. Character draw order remains sorted by path Y.
9. Phone display height starts at 52 CSS pixels and may scale down only enough to prevent room overlap; it never falls below 44 pixels in the 390 by 844 target viewport.
10. Reduced-motion mode uses a static directional frame and suppresses nonessential particles while preserving position and state information.

## Body-family seam

This package introduces `bodyFamily` and an animation-profile lookup without fabricating unavailable art. Existing characters default to `standard_humanoid`. Future body-family assets can replace source sheet, crop, anchor, scale, and shadow without changing pathing or actor state.

The roster package will assign and author the broader families. Until those assets exist, the UI must not imply that recoloring the standard humanoid is final alien or droid art.

## Phone presentation

- The ship remains centered and uses the maximum height available between the 44px HUD and bottom navigation.
- HUD interactive controls use at least a 44px hit area.
- Room labels are at least 16px because they are short, transient interface annotations; room-sheet text follows the 18px player-facing scale.
- A room selection opens one bottom sheet with one primary action.
- The ship stays visible behind the sheet so selection retains spatial context.
- The persistent post-tutorial coach is outside this package, but it must not cover the room sheet in the acceptance capture.

## Required automated evidence

1. Manifest validation: unique IDs, valid polygons and bounds, non-overlapping room centers, valid systems, one door per room, and all door references resolved.
2. Geometry tests: representative points select the intended room, corridor points return `null`, and all pairwise routes contain only walkable points.
3. Animation tests: all direction rows, frame wrapping, source crop bounds, constant foot placement across frames and directions, and minimum phone display height.
4. Regression: `node test/sanity.mjs` passes and the default suite's two known stale expectations are reported separately until reconciled by their owning packages.
5. Build: `npm run build` passes.

## Required visual evidence

At 390 by 844 CSS pixels, capture:

1. unselected full ship;
2. geometry debug overlay;
3. each room selected at least once;
4. at least three crew walking vertically and horizontally;
5. idle and working states with stable feet;
6. reduced-motion state;
7. a touch-target overlay or browser measurement confirming the minimum target.

Acceptance requires comparing these captures with the pre-change audit, not merely confirming that the page renders.
