### Task 8: Phone-Sized Runtime Evidence, Final Audit, and Handoff

**Files:**
- Create: `docs/qa/artifacts/encounter-intelligence-390x844.png`
- Create: `docs/qa/artifacts/encounter-intelligence-360x800.png`
- Create: `docs/qa/artifacts/encounter-intelligence-reduced-motion.png`
- Modify: `docs/qa/2026-09-22-encounter-balance-evidence.md`
- Modify: `docs/audits/2026-09-22-encounter-balance-implementation-audit.md`
- Modify: `docs/NEXT.md`
- Modify: `docs/handoffs/2026-09-21-stopping-point.md`

**Interfaces:**
- Consumes: completed implementation, generated evidence, first Grok disposition, and local browser runtime.
- Produces: phone-sized screenshots/measurements, final read-only Grok verdict, exact verification ledger, and the next owner decision.

- [ ] **Step 1: Start the local production-like preview**

Run: `npm run build && npm run preview -- --port 4173`

Expected: Vite serves the built app locally. Do not publish Pages or touch Jest.

- [ ] **Step 2: Capture 390×844 and 360×800 interaction evidence**

At each viewport, use `?fresh=1`, complete the tutorial through production controls, and capture:

- Contract Board with a long literal payout range;
- review sheet with the identical visible and accessible range;
- encounter tell plus all enabled orders and exactly one recommendation;
- keyboard focus on an order and a contract action;
- measured action boxes at least 44×44 CSS pixels;
- measured essential consequence text at least 16px;
- no horizontal overflow or clipped dialog content.

Save screenshots under the exact paths listed above and add measured values plus browser/viewport details to the QA document.

- [ ] **Step 3: Capture reduced-motion evidence**

Emulate `prefers-reduced-motion: reduce`, repeat an encounter state, and prove the tell, recommendation, chances, costs, payouts, and consequences remain available without shake, camera motion, or reward-flight particles. Save the screenshot and record that this is emulation, not a physical-device run.

- [ ] **Step 4: Run the final automated gate**

Run: `npm run test:balance && npm run test:loop && npm test && npm run test:ship && npm run build && git diff --check fb21912...HEAD`

Expected: all commands PASS. Rerun report scripts and verify no generated-artifact diff.

- [ ] **Step 5: Request the final bounded Grok audit**

Use the same read-only constraints as Task 7, now including runtime screenshots, measured accessibility evidence, the first audit dispositions, and the exact final base/HEAD. Require `APPROVE` or `REQUEST CHANGES`; unavailable is not approval. Apply accepted fixes only through a new failing test and rerun every affected gate.

- [ ] **Step 6: Update continuation documents without claiming release authority**

Record:

- exact commits and diff range;
- tests actually run and their outcomes;
- report artifact paths and the evidence limits;
- both Grok verdicts and dispositions;
- browser-emulation evidence and explicit lack of physical-device proof;
- that numeric tuning, monetization work, Flora art, PR #1 merge, Pages publication, Jest upload, and Jest production activation remain separately gated;
- the recommended next package based on evidence, phrased as a proposal requiring owner approval.

- [ ] **Step 7: Commit the final evidence and handoff**

```bash
git add docs/qa/artifacts/encounter-intelligence-390x844.png docs/qa/artifacts/encounter-intelligence-360x800.png docs/qa/artifacts/encounter-intelligence-reduced-motion.png docs/qa/2026-09-22-encounter-balance-evidence.md docs/audits/2026-09-22-encounter-balance-implementation-audit.md docs/NEXT.md docs/handoffs/2026-09-21-stopping-point.md
git commit -m "docs: close encounter evidence package"
```

- [ ] **Step 8: Stop at the owner gate**

Report the package outcome and the proposed next package. Do not merge PR #1, publish, upload, activate Jest production, change economy numbers, begin monetization, or generate art without a new explicit owner decision.
