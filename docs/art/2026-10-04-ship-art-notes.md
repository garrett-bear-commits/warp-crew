# Ship art generation notes

Generated the Sparrow v4 player cutaway and six hostile cutaway families with the built-in image generation tool, using the existing Sparrow hull and crew art as the palette/style reference.

Cleanup was performed with Pillow: each render was converted to RGBA, resized through a 4x smaller nearest-neighbor image and back up to snap edges and details to the required pixel grid, and exported to the exact requested canvas sizes. The generator supplied transparent backgrounds; alpha was preserved and checked after export. Layout JSON was authored against the final normalized canvases, then used to draw the proof overlays.

The four required target rooms are readable in all six enemy families at the requested small comparison size. The Sparrow's bridge, shields, weapons and engineering are especially clear; the airlock is present as a port-side exterior hatch. The generated art is more detailed and less strictly limited-palette than the older sprite references, but the palette, silhouette language and transparent cutaway treatment are consistent.

No requested deliverable was intentionally omitted. With more time, I would do a second pixel-art pass to simplify a few enemy filler-room details and hand-tune the room boundaries against runtime hitboxes after an in-game display-size review.
