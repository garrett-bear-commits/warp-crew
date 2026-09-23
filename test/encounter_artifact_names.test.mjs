import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile(new URL('../docs/qa/artifacts/encounter-intelligence-measurements.json', import.meta.url), 'utf8'));
const names = report.scenarios.flatMap(scenario => scenario.screenshots);
assert.equal(new Set(names).size, names.length, 'normal and reduced captures must not overwrite each other');
assert.ok(names.includes('encounter-intelligence-board-reduced-390x844.png'));
assert.ok(names.includes('encounter-intelligence-review-reduced-390x844.png'));
console.log('encounter_artifact_names.test.mjs OK');
