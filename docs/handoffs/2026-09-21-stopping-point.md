# Warp Crew stopping-point handoff — 2026-09-21

## Reviewed implementation

- Reviewed gameplay HEAD: `9b9585ea794120696913216a2763c563a4ba7753`
- Base: `4e34e2e972d66c2f583215fd7f822a41dbadf479`
- Integration branch: `codex/contract-route-overhaul`
- Draft PR: <https://github.com/garrett-bear-commits/warp-crew/pull/1>
- QA deployment: `gh-pages@fcab3f1` from source `codex/contract-route-overhaul@9bec3a2`
- Deployment workflow: GitHub Pages run `35690544860` — successful
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

1. Re-open the public GitHub Pages fresh-save build and record any overnight/device-only difference from `gh-pages@fcab3f1`. **Verified 2026-09-22 at 07:17 PDT:** the live `?fresh=1` path launched the seven-step Contract Board tutorial and opened `Distress at Dust Lane`, not the older Grok flow. The artifact identifies build `2026-09-22T05:23:08Z`, source `codex/contract-route-overhaul@9bec3a2e4d`, reviewed gameplay `9b9585ea79`, and Pages ref `fcab3f1cf238c54f68273e7d4518fc493a9e97be`. This is browser evidence, not physical-device evidence.
2. Run the first physical-device pass on one iPhone and one Android: fresh tutorial, Risky route, return claim, Jen arrival, selected Away crew, reduced motion, and reload.
3. Write and approve the encounter-tell/recommendation roster before adding content.
4. Specify literal reward bands and build the deterministic 30-day economy simulator before changing reward or monetization values.
5. Approve the monetization fairness boundary, then write the offer/source/sink/authority specification.
6. Choose the next implementation package: encounter content + balance evidence, or body-family/ship visual polish. Do not combine both into one review surface.

## 2026-09-22 package choice

Garrett approved **Encounter intelligence and balance evidence** as the next package. Its proposed design is [Encounter intelligence and balance evidence](../superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md). It authors all 16 current tells/recommendations, derives literal reward ranges, and produces deterministic combat/30-day free-player evidence without changing values. Body-family and ship visual work remain outside this review surface.

## Safety boundary

GitHub Pages is a public QA build using local/mock platform behavior. Do not treat it as a Jest release, production economy approval, purchase-authority proof, or permission to activate paid products.

## 2026-09-22 continuation: encounter intelligence and balance evidence

The owner-approved [encounter package design](../superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md) has been implemented on the same `codex/contract-route-overhaul` branch. Exact package base is `fb21912a93fee53426f95315e2b130567bed4d7a`; implementation/audit HEAD before runtime evidence is `f76d8d5edc3146543e1a9feaba334846c1b16782`; browser evidence and final audit commit is `c1c6b10d5743780148e5ddb2ae2c80d92c6fc71b`. Focused commits are `90028a7` (time/RNG seams), `bf53ab7` (tells/telemetry), `8bc8ec6` and `ffcfb96` (shared payouts/content validation), `cf494e8` (live Board/review ranges), `a535767` (combat matrix), `d44a106` (30-day free economy), and `959f01b`, `20cb9a3`, `f76d8d5` (first audit, truthful Scout fix, reconciliation). The handoff update itself follows `c1c6b10`; `git log -1 --format=%H -- docs/handoffs/2026-09-21-stopping-point.md` resolves that final documentation SHA.

All 16 existing encounters now have distinct tells and truthful order recommendations; the UI shows no preselected order or hidden bonus. Board and review share a derived, inclusive “Possible payout now” range from currently executable saved-route outcomes. Invalid content disables acceptance rather than presenting a fabricated range. Gameplay numbers, save version, and exact-once claims were not changed for this package. The [balance/economy report](../qa/2026-09-22-encounter-balance-evidence.md) contains 192 production-preview combat rows and 15 seeded free-player 30-day runs, with all currency ledgers reconciled. The report's cautious/balanced/ambitious median useful sessions are 18/13/8 days of 30, but this is diagnostic evidence, not a target or balance verdict. `reward_unavailable` in some simulations can mean no currently executable route while crew are injured/away; zero `hull_critical` strings appear in the committed run. Classify the reasons before tuning.

Final local gate passed: `npm run test:balance`, `npm run test:loop`, `npm test`, `npm run test:ship`, `npm run build`, and `git diff --check fb21912...HEAD`. Both report generators were rerun and reported unchanged JSON/Markdown after the runtime section was added. Headless Chrome 153 drove a local fresh-save production preview at 390×844 and 360×800 plus reduced motion at 390×844: identical Risky Board/review/accessibility range, one Swarm Skirmish recommendation with all three orders enabled, 44×44px minimum sampled actions, 16px minimum essential text, visible keyboard focus, no horizontal document overflow, and an unclipped review sheet. [Screenshots and measurements](../qa/2026-09-22-encounter-balance-evidence.md#phone-sized-runtime-evidence) are desktop emulation, not physical phone QA. The post-fix [Grok audit](../audits/2026-09-22-encounter-balance-implementation-audit.md#final-post-fix-bounded-audit) returned scoped approval on quoted code/runtime facts; Grok could not inspect image pixels or run the repository.

Recommended next owner decision: approve a bounded daily-loop friction and physical-device validation package, with one real iPhone and Android short-session pass and an explicit classification of non-useful simulator days. Agree useful-session and source/sink targets before any value changes. Monetization fairness/purchase authority, Flora GPT Image 2.5 art with a spend cap, new body/ship assets, PR #1 merge, Pages publication, Jest upload, and Jest production activation remain separate unapproved gates. The previously verified Pages fresh-save deployment is still the older QA build; this package was **not** published there.
