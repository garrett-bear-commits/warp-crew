import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** Directory holding the ordered *.sql migration files. */
export const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));
