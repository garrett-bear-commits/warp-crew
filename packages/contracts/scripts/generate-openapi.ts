// Generates openapi.json from the ROUTES registry. Deterministic; a test asserts the committed
// file matches (run `pnpm openapi` after changing contracts).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildOpenApi } from '../src/openapi.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApi(), null, 2) + '\n');
console.log(`wrote ${out}`);
