### Task 5: Canonical first-play portraits, movement silhouettes, and pirate art

**Files:** Add four captain portrait PNGs, two nonhuman movement sheets, and one pirate top-down PNG under public/art/pixel/vertical-slice/; modify src/data/artManifest.js, src/data/portraits.js, src/data/looks.js, src/ui/crewArt.js, docs/art/2026-09-23-vertical-slice-ledger.md, test/asset_manifest.test.mjs.

**Interfaces:** portraitFor(captain template ID) returns that captain's approved export. walkAssetFor uses the dedicated alien or droid sheet when those template IDs are active; human captains use distinct existing recolor profiles. All four appear recognizable beside the v3 splash and at 52px in-ship height.

- [ ] **Step 1: Write failing asset tests** for four portrait mappings, nonhuman sheet routing, hashes, and fallbacks. The break caught is a new captain silently becoming Rex art:

~~~js
for (const id of ['captain_cyborg', 'captain_gunner', 'captain_alien', 'captain_droid']) {
  assert.notEqual(portraitFor(id), portraitFor('merc_rex'));
  assert.ok(ART_VERTICAL_SLICE[id].path.startsWith('/art/pixel/vertical-slice/'));
}
assert.equal(lookIdFor('captain_alien', 'scout'), 'captain_alien');
assert.equal(lookIdFor('captain_droid', 'engineer'), 'captain_droid');
~~~

- [ ] **Step 2: Run** node test/asset_manifest.test.mjs; expect absent mappings.
- [ ] **Step 3: Produce exactly seven considered built-in image outputs:** four square portraits derived from the matching v3 splash characters; two 384×384 four-direction, four-frame walk sheets anchored to the matching portraits and the Ninefold row order down/left/right/up; one transparent top-down pirate scout ship with a visible weapons module. Use the game-art sprite-generation skill for the movement sheets and imagegen for raster edits. No Flora run, no duplicate generation, no automatic reroll. Save originals and exports under versioned names, then record the actual prompt, route, generated path, dimensions, SHA-256, and disposition in the ledger. If any sheet breaks its frame/alpha/foot-line contract, stop that asset for review; do not fake acceptance with a generic human sheet. Add only verified exports to the manifest and runtime maps.
- [ ] **Step 4: Run** art-qa-and-review automated checks on the two movement sheets and enemy transparency, make a uniquely named contact sheet over magenta and the actual ship/space background, then inspect 52px ship and 72px card composites. Run node test/asset_manifest.test.mjs, npm run test:ship, and npm run build:pages. Keep any failed output as a logged candidate, not an installed asset.
- [ ] **Step 5: Commit** accepted asset bytes, mapping, tests, and ledger as art: add first-play captain and pirate identities.

