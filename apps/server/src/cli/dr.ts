// DR CLI (§8, runbook restore-drill): erasure tombstone export/replay and isolated-restore
// verification. Managed PITR/object storage stay external; this operates on Postgres URLs + files.
//   dr export-erasures --out <file> --game <id> --env <env> [--schema-head <h>]      (DATABASE_URL = live)
//   dr replay-erasures --in <file> --game <id> --env <env>                          (DATABASE_URL = target)
//   dr verify-restore --restored-url <url> --manifest <file> --game <id> --env <env> [--erasures <file>] [--mark]
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { CONTRACT_VERSION } from '@foundation/contracts/enums';
import {
  exportErasures,
  writeErasureExport,
  readErasureExport,
  replayErasures,
  verifyIsolatedRestore,
  markRestoreVerified,
  listMigrations,
  schemaHead,
  type BackupManifest,
  type Q,
} from '@foundation/server';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return v;
}

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;

if (cmd === 'export-erasures') {
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const manifest: BackupManifest = {
    game: need('game'),
    env: need('env'),
    takenAt: Date.now(),
    schemaHead: arg('schema-head') ?? schemaHead(listMigrations()),
    contractVersion: CONTRACT_VERSION,
  };
  const e = await exportErasures(sql as unknown as Q, manifest);
  writeErasureExport(need('out'), e);
  await sql.end();
  console.log(`exported ${e.erasures.length} erasure(s) for ${manifest.game}/${manifest.env}`);
} else if (cmd === 'replay-erasures') {
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const e = readErasureExport(need('in'));
  const game = need('game');
  const env = need('env');
  if (e.manifest.game !== game || e.manifest.env !== env) {
    console.error(
      `refusing: export is for ${e.manifest.game}/${e.manifest.env}, destination is ${game}/${env}`,
    );
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const r = await replayErasures(sql as unknown as Q, e.erasures, 'cli');
  await sql.end();
  console.log(JSON.stringify(r));
  if (r.failed.length) process.exit(1);
} else if (cmd === 'verify-restore') {
  const manifest = JSON.parse(readFileSync(need('manifest'), 'utf8')) as BackupManifest;
  const erasuresFile = arg('erasures');
  const report = await verifyIsolatedRestore({
    restoredUrl: need('restored-url'),
    manifest,
    destination: { game: need('game'), env: need('env') },
    ...(erasuresFile ? { erasures: readErasureExport(erasuresFile).erasures } : {}),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.ok && process.argv.includes('--mark')) {
    if (!url) {
      console.error('DATABASE_URL (live) is required for --mark');
      process.exit(2);
    }
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    await markRestoreVerified(sql as unknown as Q, report, Date.now());
    await sql.end();
    console.log('restore_verified_at written on the live database');
  }
  process.exit(report.ok ? 0 : 1);
} else {
  console.error('usage: dr export-erasures | replay-erasures | verify-restore');
  process.exit(2);
}
