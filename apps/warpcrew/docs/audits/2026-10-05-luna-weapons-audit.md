# Luna audit: weapons, armory, flagship tiers (2026-10-05)

Codex `gpt-5.6-luna` (medium) read-only audit of commits 3863c66 and 5ee8303. All three findings were fixed in 7320d50 with regression tests in `test/ship_weapons.test.mjs`.

Found 3 bugs.

1. Medium — buying during a live fight mutates the loadout

- `src/systems/armory.js:35-46`
- `src/systems/sessionLoop.js:678-683`
- `src/ui/bridge.js:1058-1061`

`weapon-equip` is blocked in combat, but `weapon-buy` is not. With an empty slot, buying a weapon during an active encounter immediately adds it to the persisted loadout.

Failing scenario: Weapons level 4, live fight, 5,000 credits → click “Buy Missile” → credits decrease and `ship.loadout` gains `missile` mid-fight. The current encounter snapshot does not use it, but the ship is refitted before the fight ends.

2. High — boolean flagship input creates a fight that fails its own validator

- `src/systems/ftlCombat.js:102-105`
- `src/systems/ftlCombat.js:167-173`
- `src/systems/ftlCombat.js:645-651`

`enemyLoadout(..., { flagship: true })` treats `true` as tier 2, but `startFtlEncounter` stores it as numeric flagship tier 1.

Failing scenario:

```js
const fight = startFtlEncounter({
  acceptanceId: 'x',
  encounterId: 'pirate_wing',
  seed: 1,
  flagship: true
});
validFtlBody(fight) // false
```

The saved enemy has two shield layers but validator reconstruction sees flagship tier 1 and expects one. Reload normalization can discard the active fight via `normalizeEncounterState`.

3. Medium — duplicate weapons can bypass the “one weapon per slot” rule

- `src/systems/armory.js:28-32`
- `src/systems/ftlCombat.js:132-135`
- `src/systems/ftlCombat.js:632-635`

`shipLoadout` does not deduplicate IDs, `startFtlEncounter` accepts duplicates, and `validFtlBody` checks catalog membership/count but not uniqueness.

Failing scenario: a save containing `ship.loadout = ['burst', 'burst']` starts with two Burst weapons; `validFtlBody` returns true. That produces an extra firing weapon without owning a second distinct gun.

The focused tests passed: `ftl_combat`, `ftl_audit_fixes`, `session_loop`, and `ship_weapons`. No free-purchase or unowned-weapon fitting path was found.


