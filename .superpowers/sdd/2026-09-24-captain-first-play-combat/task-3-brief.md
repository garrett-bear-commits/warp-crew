### Task 3: Versioned target-weapons combat

**Files:** Modify src/systems/autoCombat.js and src/systems/encounterState.js; extend test/auto_combat.test.mjs and test/encounter_session.test.mjs.

**Interfaces:** startEncounter accepts ruleset:'v1'|'v2' (default v2 for new pirate fights). v2 state includes enemy.weaponDisabledThroughBeat and orders.targetWeapons.used/uses. advanceEncounter(state,'target_weapons') returns a new state and a target-lock/system-disable event. validSnapshot accepts both saved v1 and new v2, checking each version's own schema.

- [ ] **Step 1: Write failing tests** for the exact effect and backward compatibility. The break caught is an order that looks useful but does not stop a volley:

~~~js
const opened = advanceEncounter(startEncounter({ ...baseArgs, ruleset: 'v2' })).state;
assert.equal(opened.orderWindow.orderOptions.target_weapons.available, true);
const locked = advanceEncounter(opened, 'target_weapons');
assert.equal(locked.state.orders.targetWeapons.used, true);
assert.ok(locked.events.some(e => e.type === 'enemy_weapon_disabled'));
const impact = advanceEncounter(locked.state);
assert.equal(impact.events.some(e => e.type === 'enemy_impact' && e.amount > 0), false);
assert.equal(advanceEncounter(impact.state, 'target_weapons').ok, false);
const legacy = startEncounter({ ...baseArgs, ruleset: 'v1' });
assert.equal(legacy.version, 1);
assert.deepEqual(advanceEncounter(JSON.parse(JSON.stringify(legacy))), advanceEncounter(legacy));
~~~

- [ ] **Step 2: Run** node test/auto_combat.test.mjs and node test/encounter_session.test.mjs; expect the v2 window assertion to fail.
- [ ] **Step 3: Implement** a v2 order option only when pirate weapons are charging, with cost { shield: 0 }, one use per encounter, and a saved disable-through-beat value. On the next impact beat, emit enemy_weapon_disabled and no damage instead of enemy_impact, then clear the disable. Keep the v1 Brace/Repair transition unchanged, including its old fixtures. beginContractEncounter selects v1 for script-4 distress and v2 for script-5 distress and new Reliable/Push fights; callers of other legacy encounter types explicitly request v1. Do not reinterpret a previously saved v1 encounter as v2.

~~~js
if (order === 'target_weapons') {
  next.orders.targetWeapons = { used: true, uses: 1 };
  next.enemy.weaponDisabledThroughBeat = next.beat + 2;
  events.push({ type: 'enemy_weapon_disabled', target: 'weapons', throughBeat: next.enemy.weaponDisabledThroughBeat });
}
if (next.version === 2 && next.enemy.weaponDisabledThroughBeat >= next.beat) {
  events.push({ type: 'enemy_volley_canceled', target: 'weapons' });
} else resolveEnemyImpact(next, selectedWindow, events);
~~~

- [ ] **Step 4: Test** stale revision, malformed v2 option, save/reload after lock, all four starting captain outputs, guided win, and normal-fight recoverable loss. Build one matching activeContract plus saved v1 encounter fixture and assert normalizeEncounterState retains it without conversion. Run focused combat tests, npm run test:balance, and npm run test:loop.
- [ ] **Step 5: Commit** only Task 3 files as feat: add saved pirate weapons targeting.

