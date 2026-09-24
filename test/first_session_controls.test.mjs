import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderShipEncounter } from '../src/ui/contractView.js';

const base = {
  kind: 'guided', beat: 1, hull: 30, shield: 12, enemyHull: 20,
  outputs: { helm: 100, shields: 110, weapons: 100, engineering: 100 },
  systems: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
  orders: [{ id: 'brace', cost: 2, effectLabel: 'Block hit', cooldownLabel: 'Once', available: true }],
};
const view = encounter => renderShipEncounter({ revision: 1, acceptanceId: 'job-1', encounter });
assert.match(view({ ...base, beatsToImpact: 1 }), /data-act="encounter-order"[^>]*>\s*Brace/);
assert.match(view({ ...base, braceUsed: true, beatsToImpact: 1 }), /data-act="encounter-advance"[^>]*>Continue fight/);
assert.match(view({ ...base, result: 'win' }), /data-act="contract-claim"[^>]*>Bring cargo aboard/);

// A source guard supplements the phone-sized computed-style check in the QA report.
const css = await readFile(new URL('../src/ui/style.css', import.meta.url), 'utf8');
assert.ok(/\.wc-shell\.first-session \.ship-encounter button\s*\{[^}]*font-size:\s*16px/s.test(css), 'first-session combat buttons need 16px text');
assert.ok(/\.wc-shell\.first-session button\.primary\s*\{[^}]*background:\s*var\(--intro-accent\)/s.test(css), 'first-session primary actions need the splash accent');
