// Reset every player's journey (runbook reset-all-players). Dry run unless --apply.
//   reset-players --batch <uuid> --reason <text> [--apply]      (DATABASE_URL = target)
import postgres from 'postgres';
import { resetAllPlayers } from '../ops/reset-players.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.DATABASE_URL;
const batchId = arg('batch');
const reason = arg('reason');
if (!url || !batchId || !reason) {
  console.error('DATABASE_URL, --batch <uuid> and --reason <text> are required');
  process.exit(2);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) {
  console.error('--batch must be a UUID');
  process.exit(2);
}
const apply = process.argv.includes('--apply');

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const r = await resetAllPlayers(sql, { batchId, reason, actor: 'ops:reset-players', apply });
  console.log(JSON.stringify({ apply, batchId, ...r }, null, 2));
} finally {
  await sql.end();
}
