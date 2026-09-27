# Task 5 art report

**Status: partial.** Four captain portrait exports and one pirate top-down export passed visual and custom alpha review and are installed as QA candidates. Both nonhuman walk sheets failed the authored animation/registration contract and remain preserved, rejected, and unmapped. Do not treat Task 5 as complete until acceptable alien and droid sheets and routing are supplied.

## Generation ledger

Exactly seven one-shot outputs were made with Codex built-in `image_gen`. The tool exposed no exact model version or per-run price. No Flora runs, retries, or extra generations occurred. Raw prompts, complete generated paths, dimensions, hashes, and dispositions are recorded in [the art ledger](../../../docs/art/2026-09-23-vertical-slice-ledger.md).

| Output | Generated dimensions / SHA-256 | Disposition |
| --- | --- | --- |
| Cyborg captain portrait | 1254×1254 · `7098f55ee528a1a31d7499d6c4712ad7d5fa826c5ef2854ecf8cd4e12f93fe92` | Installed 256×256 QA candidate |
| Gunner captain portrait | 1254×1254 · `2c59741b138f50cd47ee5139039333080d00bf1366b5ca45776ac72cb46180cf` | Installed 256×256 QA candidate |
| Alien captain portrait | 1254×1254 · `ad690260990e3a990e30033cfc1615f56884f71d2de88eb09618519245da5269` | Installed 256×256 QA candidate |
| Droid captain portrait | 1254×1254 · `dfbb673e6fff8253b50cde0a69b1ecd2e187983a89698f3def5123c3f58ac918` | Installed 256×256 QA candidate |
| Alien walk sheet | 1254×1254 · `145267cae09e2bd56b9a328f028b241cfe75940625d08a3a000dd0f9c2562155` | Rejected: side rows reversed, repeated down poses, footline drift |
| Droid walk sheet | 1254×1254 · `4c547b5f1079365d3573d2edb8cf4c27c7bff9696378e8b6b9d720867cd423` | Rejected: repeated poses and substantial footline drift |
| Pirate top-down ship | 1024×1536 · `1179f14fc8d177c33966183c6cf78a87e66065b1228bc2d5fa5d90394dafccc0` | Installed 512×768 QA candidate; transparent export alpha-normalized |

Built-in route and exact tool prompts are recorded; the tool did not provide model-version or cost metadata. The outputs were not represented as GPT Image 2.5 or any exact backend. Original generated files remain under `docs/art/outputs/` and the image tool's generated-images directory.

## QA and integration

The unique review sheet [r2](../../../docs/art/reviews/task5-candidates-2026-09-24-r2.png) contains the four portraits at exact 72px card and 52px in-ship sizes over a current ship screenshot, the pirate at 170px width over magenta and dark starfield, and both rejected walk candidates over magenta and starfield. All captain identities are distinct at both requested display sizes; the pirate silhouette and attached paired cannons read clearly.

Pirate runtime export QA covered one image: 512×768 RGBA; alpha values are binary `[0,255]`; 64.92% transparent; bounds `(16,42)–(494,687)`; zero bright RGB under transparent pixels; zero partial-alpha fringe pixels. Source partial alpha was normalized to a hard pixel-art silhouette. The game-art package did not include its referenced `art_qa.py`/`contact_sheet.py` scripts, so the report distinguishes these custom Pillow checks from that unavailable gate.

Runtime mappings include the four portraits and `SPACE_ART.pirate`; the failed walk sheets are absent from runtime and the manifest. The captain portraits and pirate remain `qa-candidate`, not ship-approved. No runtime phone QA, Pages build, Jest build, `npm run test:ship`, or broad suite was run.

## Test evidence

- RED first: `node test/asset_manifest.test.mjs` failed at module import because `walkAssetPathFor` did not yet exist. The captain manifest and portrait entries were also absent at that point, though the import failure occurred before those assertions ran.
- GREEN after verified portrait/pirate exports and manifest/runtime updates: `node test/asset_manifest.test.mjs` passed.

The test now checks all five installed candidate paths, hashes, dimensions, fallbacks, distinct captain mappings, and pirate route. Dedicated nonhuman walk routing remains an explicit open item because both generated sheets failed QA.
