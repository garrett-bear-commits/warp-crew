# Encounter intelligence and balance evidence: first complete-diff audit

Date: 2026-09-22 (America/Los_Angeles)

## Scope and provenance

- Approved design: `docs/superpowers/specs/2026-09-22-encounter-intelligence-balance-evidence-design.md` (owner-approved 2026-09-22).
- Audit base: `fb21912a93fee53426f95315e2b130567bed4d7a`.
- Submitted implementation HEAD: `d44a106fd4f1d72011d75d0fbd880cf676247a17`.
- Reviewed range: `git diff fb21912...d44a106`; 28 package files, including production changes, tests, Markdown report, and two generated JSON artifacts. The JSON artifacts are represented in Grok's packet by metadata, hashes, and controller-generated ledger results; Grok did not directly read the complete diff or artifacts.
- Out of scope: pre-existing untracked `Mobile Game UI.jpg` and `package-lock.json`; PR merge, deployment, Jest upload/activation, numeric tuning, and production changes.

## Delegation prompt and access

The controller used `/Users/garrettdare/.codex/skills/grok-subscription-delegation/scripts/run-readonly-grok.sh` with an in-band evidence prompt in a fresh `/private/tmp` directory. The prompt began: “Analyze only the in-band evidence below; do not load skills or call tools.” It supplied the exact base/HEAD above, approved spec requirements, scoped line-numbered implementation excerpts, test results, artifact metadata, and known runtime gap. It required an `APPROVE`, `REQUEST CHANGES`, or explicit `UNAVAILABLE` response, Critical/Important findings only, and specific evidence and verification for each finding. It prohibited Grok from edits, commits, pushes, deploys, purchases, messages, PR merge, and Jest activation. It required Grok to label packet-only source access and not claim direct repository, artifact, test, or phone inspection.

The wrapper used the authenticated `/Users/garrettdare/.grok/bin/grok` subscription CLI with `XAI_API_KEY` and `GROK_API_KEY` removed, `--permission-mode plan`, `--disable-web-search`, `--no-subagents`, and `--output-format plain`. No API/key fallback was used.

## CLI attempts and verdict

1. Sandbox attempt: exit 1 before a session was created. Stderr reported repeated settings-fetch network errors at `cli-chat-proxy.grok.com/v1/settings`, followed by `FS_PERMISSION_DENIED` (“Couldn't create session: Permission denied”). No review stdout or session ID.
2. Escalated retry with the same read-only prompt, after changing the network/filesystem permission condition: emitted no stdout or stderr and no session ID or verdict for several minutes. The controller interrupted the hung process; exit 1 (`^C`).

The CLI verdict was **unavailable**. Its saved session `01a0cc05-f096-76a0-85ba-b8c7fc555bc3` (`grok-4.7` in local session metadata) contains the user prompt but no assistant response.

The owner then authorized an authenticated Chrome fallback. In [Grok chat `e1bdb16b-6b28-4dff-884f-1a9fa8129b8c`](https://grok.com/c/e1bdb16b-6b28-4dff-884f-1a9fa8129b8c), the initial compact packet returned `UNAVAILABLE`: the quoted source summaries and artifact hashes were insufficient for an independent verdict. One supplement in the same chat supplied all 16 literal tell strings, the unchanged coefficient-owner file list and combat-order values, 16 representative raw matrix rows, and one raw economy-run reconciliation. Grok then returned **`APPROVE (scoped)`**: no Critical or Important defect visible in those excerpts. The browser UI selected `Expert`; the response self-identified as Grok 4.6, but the UI did not expose a numbered model badge. Grok did not inspect the repository, full JSON artifacts, or a phone, and did not run tests. Its scoped approval applies to the pre-fix packet, not to subsequent code changes or release readiness.

## Local reconciliation and verification

- `npm run test:balance && npm run test:loop && npm test && npm run build`: PASS on submitted HEAD. Balance suite includes deterministic seams, encounter intelligence, contract rewards, balance matrix, and economy tests. Report generators found artifacts unchanged: 16 encounters, 192 matrix rows, 0 disabled; 15 economy runs of 30 days each, all ledgers reconciled. Loop and general suites, including 15 `final_review` subtests, passed. Vite built 52 modules.
- Initial `git diff --check fb21912...d44a106`: found one trailing blank line at `src/systems/contractRewards.js:145`. That formatting issue was removed before the final gate; no behavior was changed.
- Source check: the committed economy JSON contains zero `hull_critical` strings. `reward_unavailable` is present, but a blocked band can result from no executable launch/route when away and injured crew overlap. This audit does not treat those entries alone as a verified implementation defect.
- Grok's scoped response noted a residual possibility that `pirate_scout`'s tutorial-specific reason might appear outside the tutorial. The controller verified an executable path: `src/data/sectors.js:25` assigns Pirate Scout to normal Dust Lane travel; `src/systems/travel.js:38-65` can select it without `tutorialFight`; `src/systems/sessionLoop.js:114-120` renders its shared tell. The existing non-tutorial fixture in `test/encounter_intelligence.test.mjs` reached that path. A new assertion that the normal Scout tell must not promise a guarantee ran RED against “guaranteed counterattack.” The reason now states Brace's actual generic failure tradeoff. `node test/encounter_intelligence.test.mjs` and the full gate passed after the fix. Fix commit: `20cb9a3`.
- Artifact SHA-256: balance matrix `d04e77e636d365fcf7394235a921dcbee9fea7ed3ae8841fd3bc91fecf4bde18`; economy JSON `78a8972d6451b42e7015960be781a07b134ac5b0b0654ebd79b7b4020e7fdcb2`; Markdown report `0a1487174a17c9142a4146785ec6b4ff3bdc5ff0fbff19bd6eb04a5cb5a2d3a0`.

## Disposition and remaining gates

Grok returned no Critical or Important finding and explicitly limited its approval to quoted excerpts. The controller accepted and fixed the confirmed Scout tell issue surfaced by Grok's residual observation; no numeric tuning was made. A post-fix independent audit and phone-sized runtime review remain open under the approved spec. Automated tests and generated artifacts do not establish phone parity, balanced pacing, economy approval, or release readiness. No deployment, merge, upload, or activation occurred.
