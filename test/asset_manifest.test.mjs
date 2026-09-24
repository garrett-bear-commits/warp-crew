import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ART_VERTICAL_SLICE } from '../src/data/artManifest.js';
import { preloadEssentialAssets } from '../src/ui/essentialPreload.js';
import { renderSplash } from '../src/ui/bridge.js';
import { portraitFor, applyResolvedSlicePortraits } from '../src/data/portraits.js';

assert.deepEqual(Object.keys(ART_VERTICAL_SLICE).sort(), ['bolt', 'kira', 'nemi', 'rex', 'splash', 'tink']);
for (const [name, art] of Object.entries(ART_VERTICAL_SLICE)) {
  assert.equal(art.status, 'provisional', `${name} must not masquerade as approved art`);
  assert.ok(art.path.startsWith('/art/'));
  assert.ok(art.fallback.startsWith('/art/'));
  assert.ok(art.width > 0 && art.height > 0);
  const file = new URL(`../public${art.path}`, import.meta.url);
  const bytes = await readFile(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), art.sha256, `${name} source hash`);
  await readFile(new URL(`../public${art.fallback}`, import.meta.url));
}

const settled = [];
const loaded = [];
const resolved = await preloadEssentialAssets([
  { src: '/good.png', fallback: '/backup-good.png' },
  { src: '/broken.png', fallback: '/backup.png' },
], async src => {
  loaded.push(src);
  if (src === '/broken.png') throw new Error('primary failed');
  return src;
}, progress => settled.push(progress));
assert.deepEqual(resolved, ['/good.png', '/backup.png']);
assert.deepEqual(loaded, ['/good.png', '/broken.png', '/backup.png']);
assert.equal(settled.at(-1), 100);
assert.ok(settled.every((value, index) => index === 0 || value >= settled[index - 1]));

let fallbackDone;
const fallbackPending = new Promise(resolve => { fallbackDone = resolve; });
const delayedProgress = [];
const delayed = preloadEssentialAssets([{ src: '/broken.png', fallback: '/slow-backup.png' }], src => {
  if (src === '/broken.png') return Promise.reject(new Error('broken'));
  return fallbackPending;
}, value => delayedProgress.push(value));
await Promise.resolve();
await Promise.resolve();
assert.equal(delayedProgress.includes(100), false, 'a fallback still loading cannot mark Board ready');
fallbackDone();
assert.deepEqual(await delayed, ['/slow-backup.png']);
assert.equal(delayedProgress.at(-1), 100);

const twiceBrokenProgress = [];
assert.deepEqual(await preloadEssentialAssets([{ src: '/bad.png', fallback: '/also-bad.png' }],
  () => Promise.reject(new Error('image failed')), value => twiceBrokenProgress.push(value)), [null]);
assert.equal(twiceBrokenProgress.at(-1), 100, 'even a missing fallback must settle loading');

const emptyProgress = [];
assert.deepEqual(await preloadEssentialAssets([], () => { throw new Error('must not load'); },
  value => emptyProgress.push(value)), []);
assert.deepEqual(emptyProgress, [100]);

const loading = renderSplash({ progress: 40, ready: false });
assert.match(loading, /role="progressbar"[^>]*aria-valuenow="40"/);
assert.match(loading, /data-act="splash-dismiss"[^>]*disabled/);
assert.match(loading, /class="splash-scene"/);
assert.match(loading, /class="splash-logo"/);
const ready = renderSplash({ progress: 100, ready: true, scene: null });
assert.match(ready, /Board ship/);
assert.doesNotMatch(ready, /data-act="splash-dismiss"[^>]*disabled/);
assert.match(ready, /role="progressbar"[^>]*aria-valuenow="100"/);

const rexPrimary = portraitFor('merc_rex', 'pilot');
applyResolvedSlicePortraits({ rex: ART_VERTICAL_SLICE.rex.fallback });
assert.equal(portraitFor('merc_rex', 'pilot'), ART_VERTICAL_SLICE.rex.fallback);
applyResolvedSlicePortraits({ rex: rexPrimary });
