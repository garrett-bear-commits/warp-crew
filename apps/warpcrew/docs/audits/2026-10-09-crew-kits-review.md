# Review: crew kits in FTL-lite fights (2026-10-09)

Reviewed commit: `de4e410` (crew signature moves, real passives and Auto). Reviewer: an independent fresh-context
Claude session, standing in for the usual Codex "Luna" audit (Codex is not installed in this cloud
environment). Method: read-only code review plus a fuzzer (23,000 random fights with random crews from all 50
kits, random taps, Auto, moves, Hold, targets, Overcharge, Board, Rally and concede, boarders, ship levels,
loadouts, flagships), checking `validFtlBody` after every command and beat and a JSON reload against
uninterrupted play; and a byte-for-byte comparison of no-kit fights against the pre-commit engine (3,000 seeds).

Every finding is fixed under a regression test in `test/crew_kits_audit.test.mjs` (all fail before the fix).

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | After Four-Arm Oath expired, a beat that ended before any tick (a Board, an ability kill) saved one shield layer over max, so a won fight failed validation and the contract was lost on claim. Fuzz: 15 in 23,000. | Shield layers are clamped to the cap at the start of every kit-fight beat. |
| 2 | Medium | Edited ability state passed validation: any kit on any role, a 200% trader passive with +100% salvage (+300% credits), sure-hits, dodges, pierce and evade with no such move aboard. | A kit must be a real merc of that role; a passive is capped at the role's best (5 stars); every effect must come from a kit aboard with at most its strength; contract and Explore fights check each fighter's merc, role and Ascension tier against the roster. |
| 3 | Medium | A weaker cast replaced a stronger running effect (Hard Burn overwrote The Hallway Moved; Zephyr's dodge charge was lost). | Timed effects merge: the stronger value and the later end win; Auto skips a move already covered. |
| 4 | Medium | The Hallway Moved ("every enemy shot misses") scaled with helm damage and let shields soak shots. | Ability dodge is added after helm damage; a 100% dodge misses before shields. |
| 5 | Low-medium | Later (and Brace) did not cover a failed boarding party. | The boarding hit goes through Brace and the Later hull line. |
| 6 | Low | Cold Read's pierce was spent by missiles and ion shots. | Only lasers and beams spend it. |
| 7 | Low | Targeting ignored Editing's lost enemy shield (idle and smart captains kept aiming at shields). | Targeting uses the reduced shield maximum. |
| 8 | Low | Stacked sure-hit moves dropped the better shots (HEX-19's crits lost to Juno's cast). | Stacking keeps the best of each field. |
| 9 | Low (UI) | Enemy charge bars animated forward during a bribe. | The next-beat bar respects stall and slow. |
| 10 | Low | No-kit fights reported enemy hit damage as hull lost instead of weapon damage (an analytics payload change). | No-kit fights report weapon damage, as before. |

Also aligned with the design: an engineer's repair passive now speeds fire-fighting too. The medic's charge
boost is ×(1 + 2 × passive), as the design now says.

One part of fix 2 was narrowed on purpose: a fighter's grade is not compared with today's power, because power
is recomputed on load and a fight must never be thrown away when a formula changes. Grade stays bounded 0–1.

## After the fixes

- Fuzz: 24,000 fights (passives drawn within each role's real range), 0 validation failures, reload identical.
- No-kit fights are byte-identical to the pre-commit engine, states and events.
- All suites pass; balance evidence regenerated.
