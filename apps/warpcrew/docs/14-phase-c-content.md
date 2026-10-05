# Phase C — Content, Corvette, Soft Launch

## Content added
- **22 mercenaries** across human / alien / droid + 5 rarities
- **11 map nodes** (Spur + Veil Edge unlock via `veil_opened`)
- **8 expedition sites**
- **6 combat encounters** including Swarm Frigate Echo
- **Story beats** (6) with chapter tracking and captain log text
- **Hangar**: Sparrow upgrades, Corvette (800g / 12k cr), Frigate (Ch.4 gate)

## Corvette economy
| Path | Cost | Effect |
|------|------|--------|
| Gems | 800 | Instant 6 crew slots + fuel max +4 |
| Credits | 12,000 | Same, long grind / prestige |

## Soft-launch checklist (Jest week)
- [ ] Register SKUs: `wc_fuel_5`, `wc_gems_100`, `wc_gems_500`, `wc_starter`
- [ ] Upload Vite `dist/` build to Jest Dev Console
- [ ] Sandbox IAP purchase each SKU
- [ ] Verify notifications: fuel full, expedition done (use short 15m timers)
- [ ] Guest → register prompt after first purchase
- [ ] boglightgames.com link + blurb
- [ ] Keep expedition at 15m for test; flip to 360 for scale-up
- [ ] Analytics events visible in console: session_start, travel, combat, iap_success, hull_buy

## boglightgames.com blurb (draft)
> **Warp Crew: Idle Starship** — Command a mercenary starship across the Spur. Fuel regenerates while you're away; launch short expeditions, hire alien and droid crews, and push back the Eclipse Swarm. Built for daily sessions and deep progression. Play free on Jest — coming soon.  
> A Boglight Games production.
