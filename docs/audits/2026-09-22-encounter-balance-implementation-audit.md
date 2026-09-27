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

Grok returned no Critical or Important finding and explicitly limited its approval to quoted excerpts. The controller accepted and fixed the confirmed Scout tell issue surfaced by Grok's residual observation; no numeric tuning was made. At this first-audit stop, post-fix independent audit and phone-sized runtime review were still open; the following section records their later dispositions. Automated tests and generated artifacts do not establish phone parity, balanced pacing, economy approval, or release readiness. No deployment, merge, upload, or activation occurred.

## Final post-fix bounded audit

The same authenticated [Grok Chrome chat](https://grok.com/c/e1bdb16b-6b28-4dff-884f-1a9fa8129b8c) received one final follow-up for `fb21912a93fee53426f95315e2b130567bed4d7a..f76d8d5edc3146543e1a9feaba334846c1b16782`. It quoted the exact Scout reason before/after `20cb9a3`, the non-tutorial Explore regression assertion, the local browser's literal Risky range and Swarm Skirmish order facts, viewport measurements, and screenshot hashes. It prohibited repository browsing, file/tool use, edits, deployments, purchases, merge, and Jest activation. The response returned **`APPROVE (scoped, post-fix only)`**, with zero Critical or Important findings visible in that packet. It specifically recognized the Scout guarantee error as closed by the generic Brace reason; no numeric combat change was part of that fix.

The Chrome extension blocked screenshot attachment (`fileChooser.setFiles` returned `Not allowed` because file-URL access is not enabled). Grok therefore saw the quoted measurements and SHA-256 values, **not image pixels**. It did not directly inspect the repository, full matrix/economy JSON, browser DOM, or a physical device; it ran no tests. The response self-identified as Grok 4.6, while the UI showed `Expert` without a numbered model badge. Its scoped verdict is not phone, economy, balance, monetization, or release approval. Codex separately captured and visually inspected [local runtime evidence](../qa/2026-09-22-encounter-balance-evidence.md#phone-sized-runtime-evidence) on the post-fix build.

Local final gate on `f76d8d5` plus the Task 8 evidence files: `npm run test:balance`, `npm run test:loop`, `npm test`, `npm run test:ship`, `npm run build`, and `git diff --check fb21912...HEAD` all passed. Both report generators reported the matrix JSON, economy JSON, and composed Markdown unchanged after their first Task 8 runtime-evidence append. The generated balance/economy data remains unchanged by the Scout copy fix. No Pages publication, Jest upload or activation, PR #1 merge, or art generation occurred.

## Whole-package supplement and screenshot provenance correction

A final same-chat Grok supplement covered the exact Task 8 implementation/evidence HEAD `a05bcf460b9f6faa6837ad7e16dec96b6d14a769` and new range `f76d8d5edc3146543e1a9feaba334846c1b16782..a05bcf460b9f6faa6837ad7e16dec96b6d14a769`. It quoted the report-generator composition, browser harness, distinct screenshot-name test and red/green result, current measurement hash, three normal/reduced screenshot hash pairs, and final local gate. Grok returned **`APPROVE (code / docs / evidence composition only)`** with no Critical or Important defect visible in the packet. It separately returned **`UNAVAILABLE` for screenshot-pixel review**: the Chrome extension could not attach a local file, and an ordinary Attach → Upload click produced no accessible picker or attachment. Grok did not inspect the repository, PNG bytes, full generated JSON, or run tests. Its verdict is not physical-device, balance, economy, monetization, or release approval.

The `a05bcf4` provenance fix gives all 15 captures distinct names. Previously the reduced-motion 390px Board/review runs overwrote their normal filenames, although the resulting pairs are byte-identical. The new committed reduced Board/review PNGs and `encounter_artifact_names.test.mjs` keep those modes separate and enforce unique names using committed JSON, without requiring Chrome during `test:balance`. The measurement JSON is SHA-256 `2c540a92e3d70fbe5c58c1b4be49c89fc7bbb17c55a94f390232e72c6c9ff2ae`; it supersedes the earlier `67480863...` hash. Normal/reduced 390px Board, review, and encounter screenshots are each byte-identical pairs, which proves only parity of those static captured states. Codex inspected the captures locally; independent pixel review and physical-phone QA remain open.

Final local gate on `a05bcf4`: `npm run test:balance`, `npm run test:loop`, `npm test`, `npm run test:ship`, `npm run build`, and `git diff --check` passed. Both report-generator orders produced unchanged matrix/economy JSON and stable composed Markdown after the runtime-fragment update. This ledger-only follow-up commit records the verdict and does not change implementation or evidence artifacts.
