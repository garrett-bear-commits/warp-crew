# Task 5 report: production-preview combat balance matrix

## Result

Implemented `buildCombatBalanceMatrix({ now, fuel })` and `renderCombatBalanceMarkdown(matrix)` for all 16 encounter IDs, four pre-order crew-power ratios, and three orders (192 rows). The committed baseline uses one available fuel so Brace, Burn, and Board can be compared at every ratio. The matrix uses non-tutorial risky contract fixtures; tutorial guarantees are separate.

The production `previewContractAction` result supplies each enabled row's effective power, rubber-banded enemy power, chance, and fuel cost. `resolveContractCombatPayout` with deterministic success/failure RNG supplies post-floor payouts; the report weights each currency independently by the preview chance. The fixture crew is ready, has exact requested pre-order power, and has no passive bonuses. The fixture uses the production starter ship and its current combat bonuses.

The 192-row count is a completeness count, not an executable count. For a zero-fuel fixture, all 64 Burn rows are `enabled=false` with `reason=not_enough_fuel`; their chance, power, success/failure payout, and expected payout are `null`. A funded production preview supplies the displayed required fuel gate for these disabled rows. The committed one-fuel baseline has 192 enabled rows and zero disabled rows.

## RED / GREEN evidence

- RED: `node test/contract_balance.test.mjs` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/sim/contractBalance.js` before implementation.
- GREEN: the same focused test exited 0 with `contract_balance.test.mjs OK` after implementation. It checks encounter and ratio coverage, row count, 94% cap, currency shape, Board success difference, the zero-fuel disabled state, and deterministic equality for the same `now`.

## Commands and results

- `node test/contract_balance.test.mjs`: PASS after implementation and again after final copy change.
- `npm run report:contract-balance`: first run wrote both artifacts; second run printed `unchanged` for both. After the final tutorial-scope clarification, the generator rewrote Markdown once; the following run printed `unchanged` for both.
- `npm run test:loop`: PASS, run once. All listed loop scripts passed; `final_review.test.mjs` reported 15 pass, 0 fail.
- `npm test`: PASS. All listed scripts passed; `final_review.test.mjs` reported 15 pass, 0 fail.
- `git diff --check`: PASS before final copy change; rerun at commit gate.

## Outputs and files

- `src/sim/contractBalance.js`: fixture construction, production preview/payout matrix, currency weighting, Markdown rendering.
- `scripts/contract-balance-report.mjs`: stable JSON and Markdown writer; only writes changed content and prints paths/row counts.
- `test/contract_balance.test.mjs`: focused behavior and repeatability coverage.
- `package.json`: `report:contract-balance` command.
- `docs/qa/artifacts/encounter-balance-matrix.json`: machine-readable 192-row baseline, 6,815 lines.
- `docs/qa/2026-09-22-encounter-balance-evidence.md`: grouped comparison table, 277 lines, showing per-order chance, payout, expected payout, fuel, hull, and injury effects.

## Self-review and concerns

- No numeric combat, reward, fuel, or economy tuning was changed. No target band or balance verdict was added.
- The baseline has one fuel available so every order can be compared. The zero-fuel test proves disabled states are represented without executable expected payouts, but zero-fuel rows are not in the committed artifact. The generator can build that matrix via the exported function if needed.
- The report is observational for a synthetic ready crew and starter ship. It is not a population-weighted player forecast, and expected rewards do not combine currencies into a synthetic score.
- `Mobile Game UI.jpg` and `package-lock.json` were unrelated untracked files and were preserved without staging.
- The first staged whitespace check found an extra blank line at the Markdown end. The renderer was corrected, artifacts regenerated to an unchanged second run, and `git diff --cached --check` then passed.
