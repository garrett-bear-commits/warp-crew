# Shared Foundation (Ninefold → Warp Crew)

Ninefold is a **separate future game**. Warp Crew reuses proven systems and art pipeline only.

## Reused
- Wall-clock timer model (`src/shared/timer.js`)
- Jest platform adapter patterns (to be fully wired)
- Notification ladder concepts
- Pixel character strips + recolor approach
- Vite + ESM architecture

## Assets in repo
- `assets/sunnyside/char/` — layered game strips (reskin later)
- `public/art/char/` — runtime copy for Vite

## Not reused
Village / Heartwood / night raid loop, plot seats, food economy.
