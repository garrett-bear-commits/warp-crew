### Task 7: Fresh-only short tutorial, first win, ship name, and curated pull

**Files:** Create `src/systems/tutorialV4.js`; modify `src/systems/tutorial.js`, `src/systems/gacha.js`, `src/systems/player.js`, `src/systems/sessionLoop.js`, `src/ui/bridge.js`, `src/main.js`; create `test/tutorial_v4.test.mjs`, `test/tutorial_migration.test.mjs`.

**Interfaces:** `defaultTutorialV4()` begins at `board`; `advanceTutorialV4(player,event)` returns a new player only for legal events. `grantWelcomePull(player,{rng})` returns `{ ok,player,instance }` once, choosing uniformly from `merc_kira`, `merc_tink`, `merc_nemi`, rarity `uncommon`; increments `gacha.pulls`, resets/advances pity by normal rules, and appends to normal history. `nameShip(player,name)` trims to 1–24 visible characters or uses the current default. Script-3 helpers remain intact and are selected by `player.tutorial.script`.

- [ ] **Step 1: Write failing migration/reward tests**:

```js
import assert from 'node:assert/strict';
import { createNewPlayer, migratePlayer } from '../src/systems/player.js';
import { grantWelcomePull, nameShip } from '../src/systems/tutorialV4.js';
const fresh = createNewPlayer({ now: 1, rng: () => .2 });
assert.equal(fresh.tutorial.script, 4);
const readyForPull = { ...fresh, tutorial: { ...fresh.tutorial, phase: 'pull', firstWin: true } };
const first = grantWelcomePull(readyForPull, { rng: () => .5 });
assert.equal(first.ok, true);
assert.equal(first.instance.templateId, 'merc_tink');
assert.equal(first.instance.rarity, 'uncommon');
assert.equal(first.player.gacha.pulls, 1);
assert.equal(grantWelcomePull(first.player, { rng: () => .9 }).ok, false);
assert.equal(nameShip(first.player, '  ').ship.name, 'Sparrow');
const old = { ...fresh, version: 7, tutorial: { script: 3, phase: 'recruit', completed: false } };
assert.equal(migratePlayer(old).tutorial.script, 3);
assert.equal(migratePlayer({ ...old, tutorial: { script: 3, phase: 'done', completed: true } }).tutorial.completed, true);
```

- [ ] **Step 2: Run** `node test/tutorial_v4.test.mjs`; expect missing module or wrong script.
- [ ] **Step 3: Implement** fresh script 4 only, and migrate existing script 3 unchanged. The selector is keyed to the saved script, not a global version switch:

```js
const tutorial = player.tutorial?.script === 4
  ? normalizeTutorialV4(player.tutorial)
  : migrateTutorialV3(player).tutorial;
```

Set `ship.name='Sparrow'` on new saves and use it as the migration fallback. Gate actions to: Board ship → assign Bolt to Shields → guided encounter/Brace/win → claim visible repair/reputation → name ship → free pull → optional Jest registration/skip → next job. Show the new crew in a useful context: Kira at Weapons, Tink at Shields/Engineering, or Nemi in the future Away-team slot; allow the player to change that suggested assignment. Store stable phase plus one-time flags in player; ship naming and welcome pull use the durable transition boundary. Add `gacha.history` for both normal and welcome pulls (existing gacha has no history), passing `rng` into `createCrewInstance` and pity selection without changing odds. No first-session store/purchase UI.
- [ ] **Step 4: Add `tutorial_migration.test.mjs`** cases for active script-3 recruit, completed script 3, a version-7 veteran without tutorial, and script-4 reload at each phase. Begin with this frozen v3 case and extend it for the other three saved shapes:

```js
const v3 = { ...createNewPlayer({ now: 1, rng: () => .2 }), version: 7,
  tutorial: { script: 3, phase: 'recruit', completed: false, dismissed: false } };
const migrated = migratePlayer(JSON.parse(JSON.stringify(v3)));
assert.equal(migrated.tutorial.script, 3);
assert.equal(migrated.tutorial.phase, 'recruit');
assert.deepEqual(migrated.crew.map(c => c.instanceId), v3.crew.map(c => c.instanceId));
assert.deepEqual(migrated.wallet, v3.wallet);
```

Assert route identity and completed status remain unchanged in the other cases. Run `node test/tutorial_v4.test.mjs`, `node test/tutorial_migration.test.mjs`, `npm run test:loop`, `npm run test:balance`; expect PASS.
- [ ] **Step 5: Commit** `feat: add short fresh-save first session` with task files only.

