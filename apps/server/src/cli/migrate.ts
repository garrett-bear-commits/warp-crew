// migrate CLI (§4.2): --up (release step, migrator role) | --status | --check <schema.sql> | --repair
import {
  migrateUp,
  checkSchema,
  repairChecksums,
  describeSchema,
  listMigrations,
  schemaHead,
} from '@foundation/server';
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
const arg = process.argv[2] ?? '--status';

if (arg === '--up') {
  const r = await migrateUp(url, { log: (m) => console.log(m) });
  console.log(
    `applied ${r.applied.length}, skipped ${r.skipped.length}, head ${r.head.slice(0, 16)}`,
  );
} else if (arg === '--status') {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const st = await checkSchema(sql);
  await sql.end();
  console.log(
    JSON.stringify(
      {
        ok: st.ok,
        state: st.state,
        head: st.head?.slice(0, 16),
        expected: st.expectedHead.slice(0, 16),
        pending: st.pending,
        mismatched: st.mismatched,
        ahead: st.ahead,
        files: listMigrations().length,
        diskHead: schemaHead(listMigrations()).slice(0, 16),
      },
      null,
      2,
    ),
  );
  process.exit(st.ok ? 0 : 1);
} else if (arg === '--check') {
  // diff a fresh DB (this DATABASE_URL after --up) against a committed schema.sql description
  const file = process.argv[3] ?? 'schema.sql';
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const desc = await describeSchema(sql);
  await sql.end();
  if (process.argv.includes('--write')) {
    writeFileSync(file, desc);
    console.log(`wrote ${file}`);
  } else {
    // Older snapshots contain harmless trailing spaces from nullable columns without defaults.
    // New descriptions are clean; normalize the reviewed legacy file during comparison so a
    // migration check remains structural rather than whitespace-sensitive.
    const expected = readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');
    if (expected !== desc) {
      console.error(
        `schema drift: ${file} differs from the database (run --check --write after a reviewed migration)`,
      );
      process.exit(1);
    }
    console.log('schema matches');
  }
} else if (arg === '--repair') {
  const repaired = await repairChecksums(url);
  console.log(`repaired checksums: ${repaired.join(', ') || 'none'}`);
} else {
  console.error('usage: migrate --up | --status | --check [schema.sql] [--write] | --repair');
  process.exit(2);
}
