## Phone-sized runtime evidence

This section is appended by both report generators from this file, so regenerating the balance and economy reports preserves the browser evidence. It is a local production-build check, not a published Pages or Jest build and not physical-device proof.

Fresh `?fresh=1` saves were driven by pointer controls in headless Google Chrome 153 using mobile viewport emulation at 390×844 and 360×800 CSS pixels (device scale factor 1), plus 390×844 with emulated `prefers-reduced-motion: reduce`. The route covered splash, tutorial review/accept/launch/Brace/claim/recruit, the normal three-offer Board, Risky review/accept/launch/Push, and a Swarm Skirmish order choice. `npm run build` produced 52 modules before capture. The reproducible harness is [`scripts/encounter-intelligence-qa.mjs`](../../scripts/encounter-intelligence-qa.mjs); its complete measurements are [JSON](artifacts/encounter-intelligence-measurements.json).

| Measured item | 390×844 | 360×800 | Reduced 390×844 |
| --- | --- | --- | --- |
| Risky Board / review payout | 26–150 credits · 2–12 medals · 0–5 reputation, identical | identical | identical |
| Review Accept accessible label | Contains the same literal range | same | same |
| Minimum scoped action size | 44×44 CSS px | 44×44 CSS px | 44×44 CSS px |
| Minimum sampled essential text | 16px | 16px | 16px |
| Document width / viewport | 390 / 390px | 360 / 360px | 390 / 390px |
| Review sheet | Entirely above bottom navigation; content does not overflow its box | same | same |
| Keyboard focus | Review and Brace each reached by Tab with visible solid outline | same | same |

The Risky card was intentionally scrolled into view before checking its full bounds; the encounter has vertical scrolling because three full order cards cannot fit on one phone-sized screen. No horizontal overflow was measured. The Swarm Skirmish screen showed the authored “Pack spreading wide.” tell and reason, exactly one recommended order (Brace), and all three orders enabled: Brace 58%/0F, Burn 76%/1F, Board 52%/0F. Their consequences and payout tradeoffs stayed legible at 16px in normal and reduced-motion emulation. The static normal and reduced 390px encounter PNGs are byte-identical; that establishes parity of the captured choice state, not the absence of every possible animation across the game. Reduced-motion code suppresses combat cinematic effects and uses static launch presentation; this harness did not measure physical camera motion or frame pacing.

Screenshot set: [390 Board](artifacts/encounter-intelligence-board-390x844.png), [390 review](artifacts/encounter-intelligence-review-390x844.png), [390 tell/Brace](artifacts/encounter-intelligence-390x844.png), [390 Burn](artifacts/encounter-intelligence-order-burn-390x844.png), [390 Board order](artifacts/encounter-intelligence-order-board-390x844.png); [360 Board](artifacts/encounter-intelligence-board-360x800.png), [360 review](artifacts/encounter-intelligence-review-360x800.png), [360 tell/Brace](artifacts/encounter-intelligence-360x800.png), [360 Burn](artifacts/encounter-intelligence-order-burn-360x800.png), [360 Board order](artifacts/encounter-intelligence-order-board-360x800.png); [reduced tell/Brace](artifacts/encounter-intelligence-reduced-motion.png), [reduced Burn](artifacts/encounter-intelligence-order-burn-reduced-390x844.png), and [reduced Board order](artifacts/encounter-intelligence-order-board-reduced-390x844.png). The screenshots were visually inspected locally. No physical iPhone or Android, assistive technology, safe-area hardware, interruption, thermal, or frame-pacing test was performed.
