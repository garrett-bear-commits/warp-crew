### Task 7: First Complete-Diff Grok Audit and Reconciliation

**Files:**
- Create: `docs/audits/2026-09-22-encounter-balance-implementation-audit.md`
- Modify only if findings are accepted: files named by the verified finding

**Interfaces:**
- Consumes: exact package base/HEAD, approved spec, implementation diff, automated test ledger, and generated artifacts.
- Produces: a substantive bounded verdict with each finding classified as accepted, rejected with source evidence, or unresolved.

- [ ] **Step 1: Establish the exact audit range and clean scope**

Run:

```bash
git status --short
git rev-parse fb21912
git rev-parse HEAD
git diff --stat fb21912...HEAD
git diff --check fb21912...HEAD
```

Expected: only package files plus the two pre-existing untracked user files (`Mobile Game UI.jpg`, `package-lock.json`); no merge, deployment, or production changes.

- [ ] **Step 2: Run the complete local evidence gate before delegation**

Run: `npm run test:balance && npm run test:loop && npm test && npm run build`

Expected: every command PASS. Record exact commands and results; do not describe unrun checks as passing.

- [ ] **Step 3: Request the bounded read-only Grok audit**

Use the `grok-subscription-delegation` skill. Give Grok:

- base `fb21912` and the exact current HEAD;
- the approved spec and scoped diff;
- the test ledger and generated reports;
- a request for `APPROVE` or `REQUEST CHANGES` with Critical/Important findings only;
- explicit prohibitions on edits, commits, pushes, deploys, purchases, PR merge, and Jest activation.

If Grok times out or returns no substantive verdict, record `unavailable`; never infer approval.

- [ ] **Step 4: Verify every finding against source and tests**

For an accepted finding, first add a failing focused test, run it RED, implement the smallest fix, rerun focused plus affected regression gates, and commit:

```bash
git add -p
git commit -m "fix: reconcile encounter evidence audit"
```

For a rejected finding, cite the exact production path/test proving it false. Do not implement speculative suggestions or numeric tuning.

- [ ] **Step 5: Write the audit ledger and rerun the full gate**

The audit document records prompt scope, base/HEAD, verdict, raw finding summary, disposition, verification command, and remaining unknowns. Run: `npm run test:balance && npm run test:loop && npm test && npm run build && git diff --check fb21912...HEAD`

Expected: PASS with no open Critical or Important finding.

- [ ] **Step 6: Commit the reconciliation ledger**

```bash
git add docs/audits/2026-09-22-encounter-balance-implementation-audit.md
git commit -m "docs: record encounter evidence implementation audit"
```

---

