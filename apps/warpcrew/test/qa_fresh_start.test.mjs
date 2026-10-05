import { consumeFreshStart } from '../src/systems/qaFreshStart.js';

let clears = 0;
let replaced = '';
const location = { href: 'https://example.test/warp-crew/?fresh=1&utm_source=qa#ship' };
const history = { replaceState(_state, _unused, url) { replaced = url; } };
const didClear = consumeFreshStart({ location, history, clearSave: () => { clears += 1; } });
if (!didClear || clears !== 1) throw new Error('fresh start did not clear once');
if (replaced !== '/warp-crew/?utm_source=qa#ship') throw new Error('fresh URL not consumed safely');
if (consumeFreshStart({ location: { href: `https://example.test${replaced}` }, history, clearSave: () => { clears += 1; } })) {
  throw new Error('consumed fresh start repeated');
}
if (clears !== 1) throw new Error('fresh start cleared on reload');
console.log('qa_fresh_start.test.mjs OK');
