# Task 6A: Pure seeded crew-run encounter reducer

Read the approved spec's Crew-run combat and Interfaces sections: `/Users/garrettdare/warp-crew/docs/superpowers/specs/2026-09-22-living-ship-core-vertical-slice-design.md`. This is the first half of Task 6 from `/Users/garrettdare/warp-crew/docs/superpowers/plans/2026-09-23-living-ship-vertical-slice.md`. Implement only the pure model and its tests. Do not edit `sessionLoop.js`, `contracts.js`, `player.js`, UI, or save code; Task 6B will integrate this reducer.

**Files:** Create `src/systems/autoCombat.js` and `test/auto_combat.test.mjs` only.

**Interface:**

- `startEncounter({ acceptanceId, encounterId, kind, seed, assignments, outputs })` returns a JSON-serializable snapshot. `kind` is `'guided'` or `'normal'`; snapshot includes `version`, `acceptanceId`, `encounterId`, `kind`, integer `seed`, `revision:0`, `beat:0`, `phase`, crew assignment snapshot, station output snapshot, player `hull/shield/systems`, enemy `hull/target/pattern`, order cooldown/use state, `orderWindow`, and `result:null`.
- `advanceEncounter(state, order = null)` returns `{ state: next, events }` without mutating input or using `Math.random`, wall time, DOM, or save access. A completed state is a no-op `{state,events:[]}`. Invalid/unavailable orders must return a testable failure rather than silently consume the beat; choose `{ ok:false, reason, state }` for that branch and document it. Valid branch retains `{state,events}` shape.
- Version 1 only. Events contain plain objects with named types and explicit target/system/amount where relevant; `tell` has `beatsToImpact` so the UI can show a countdown. State includes enough cooldown, used-order, and seeded event-index data that JSON round-trip before any beat yields the same next state/events.
- Four effective outputs from Task 5 are numeric indices with unmanned baseline 100 and matching-role +10: `helm`, `shields`, `weapons`, `engineering`. The reducer must make at least one observable difference from a +10 Weapons assignment versus baseline, a +10 Shields assignment versus baseline, and engineering repair over time; no opaque total-power roll.
- Guided fight is authored short, forgiving, and a win within 20 beats when Brace is used at its one threat window. Do not force `result='win'` as an override or roll; use authored enemy health/damage and crew station effects. Normal fight can lose with zero weapons and no order within 40 beats, leaves hull >=1 and a clear loss reason. A normal fight with functional weapons can win. Normal decision window offers Brace, emergency repair, or no order; costs, cooldown, and consequence are explicit in state/events. No currency/fuel/rewards here.

**TDD steps:**

- [ ] Add `test/auto_combat.test.mjs` with literal fixtures and assertions for: seeded determinism across `structuredClone`/JSON; no input mutation; tell with target/countdown; Brace cost/use limit; repair cooldown; +10 Weapons changes damage; +10 Shields changes mitigation; guided win; normal zero-weapon loss with hull >=1; normal functioning-weapon win; terminal no-op. Name the production mutation each assertion catches. Follow `/Users/garrettdare/.codex/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/test-driven-development/writing-good-tests.md`.
- [ ] Run `node test/auto_combat.test.mjs` and record the expected RED missing-module or behavior failure.
- [ ] Implement the minimal pure state transition. Keep seeded variation deterministic via an integer hash of `seed` and `beat` if needed; do not use floating RNG state that is not saved. Keep systems/role effects visible in events.
- [ ] Run `node test/auto_combat.test.mjs`, `npm run test:balance`, `npm test`, `npm run build` and record results. Do not alter existing combat balance or reward code.
- [ ] Commit only the two task files with a concise conventional commit. Write RED/GREEN output, assumptions, and interface notes for 6B to `/Users/garrettdare/warp-crew/.superpowers/sdd/2026-09-23-living-ship-vertical-slice/task-6a-report.md`.

No art generation, merge, push, deploy, Jest production activation, or changes to user-owned untracked files.
