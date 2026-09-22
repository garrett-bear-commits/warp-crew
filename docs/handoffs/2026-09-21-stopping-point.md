# Warp Crew stopping-point handoff — 2026-09-21

## Reviewed implementation

- Reviewed gameplay HEAD: `9b9585ea794120696913216a2763c563a4ba7753`
- Base: `4e34e2e972d66c2f583215fd7f822a41dbadf479`
- Integration branch: `codex/contract-route-overhaul`
- Public QA target: <https://garrett-bear-commits.github.io/warp-crew/>
- Fresh-save QA: <https://garrett-bear-commits.github.io/warp-crew/?fresh=1>
- QA hub: <https://garrett-bear-commits.github.io/warp-crew/qa.html>

This is a strong package boundary, not completion of the full game overhaul. No Jest production upload or real-money activation is included.

## What is now working

- Phone-first nine-room Sparrow with manifest-driven room polygons, labels, doors, anchors, hit ownership, and pathing.
- Ninefold four-direction crew sprites without synthetic bobbing; deterministic station, departure, and arrival movement.
- Persistent three-offer Contract Board with Reliable, Risky, and Strange profiles.
- Short saved routes with preview/commit identity, reload safety, exact-once claims, abandonment rules, and clock-rollback completion protection.
- Brace, Burn, and Board combat orders in Contracts and Explore.
- Risky Secure/Push branches use authored low/high-power destination encounters and expose their actual consequences.
- Version-three first-session tutorial, Jen Airlock-to-Workshop arrival, selected-party Dustfall launch, and compact daily plan.
- Route/return/repair ship signals, selected-crew Airlock departure, launch presentation, focus restoration, and reduced-motion parity.
- Contract combat now grants existing win/route/participant-XP progression exactly once.
- Save version 7 migration and corrupt tutorial-route recovery, including missing/unknown profile cases.

## Verification at this stop

- `npm test` — GREEN on reviewed HEAD; 15 final-review cases plus the default suite.
- `npm run test:loop` — GREEN in the final implementation pass.
- `npm run test:ship` — GREEN in the final implementation pass.
- `npm run build` — GREEN; 51 modules in the final implementation pass.
- Targeted production-browser QA — GREEN at 390×844 and 360×800, normal and reduced motion.
- Whole-branch review — no open Critical or Important findings after the final scoped re-review.

Evidence: [Contract route runtime QA](../qa/2026-09-21-contract-route-loop.md), [ship/animation QA](../qa/2026-09-21-ship-animation-foundation.md), and [outcome requirements](../19-outcome-requirements.md).

## Deliberately open

- Real iPhone and Android touch, safe-area, assistive-technology, interruption, memory, thermal, and frame-pacing QA.
- Authored tell label, sentence, and recommendation for every encounter.
- Numeric reward bands in board/review UI and a full combat/contract balance matrix.
- Thirty-day free/light/high-spender economy simulations and human 5–10 minute pacing tests.
- Approved monetization fairness rules, offer catalog, signed purchase authority, restore/refund behavior, and cross-device saves.
- Distinct alien/robot movement-body families, additional ship visual transformation, hull identity, richer lore delivery, and long-term meta progression.
- Broader contrast audit and screens outside the contract/ship package.

## Resume tomorrow

1. Verify the public GitHub Pages build on a fresh save and record the deployed commit in this handoff if it differs.
2. Run the first physical-device pass on one iPhone and one Android: fresh tutorial, Risky route, return claim, Jen arrival, selected Away crew, reduced motion, and reload.
3. Write and approve the encounter-tell/recommendation roster before adding content.
4. Specify literal reward bands and build the deterministic 30-day economy simulator before changing reward or monetization values.
5. Approve the monetization fairness boundary, then write the offer/source/sink/authority specification.
6. Choose the next implementation package: encounter content + balance evidence, or body-family/ship visual polish. Do not combine both into one review surface.

## Safety boundary

GitHub Pages is a public QA build using local/mock platform behavior. Do not treat it as a Jest release, production economy approval, purchase-authority proof, or permission to activate paid products.
