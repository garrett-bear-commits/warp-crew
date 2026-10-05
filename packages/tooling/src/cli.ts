// `foundation` CLI (§3 tooling, ADR-023). Run: `pnpm foundation <cmd>` or
// `node --experimental-strip-types packages/tooling/src/cli.ts <cmd> [options]`.
// Each subcommand is a small module under ./commands; pure logic lives beside them and is
// exported from ./index.ts for tests.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { UsageError, consoleIo, type Io } from './args.ts';
import * as deployStatic from './commands/deploy-static.ts';
import * as zip from './commands/zip.ts';
import * as checkHealth from './commands/check-health.ts';
import * as preflight from './commands/preflight.ts';
import * as newServer from './commands/new-server.ts';
import * as newFeature from './commands/new-feature.ts';
import * as manifest from './commands/manifest.ts';
import * as bundleSize from './commands/bundle-size.ts';
import * as fleet from './commands/fleet.ts';

type Command = { usage: string; run: (argv: string[], io: Io) => Promise<number> };

export const COMMANDS: Record<string, Command> = {
  'deploy-static': deployStatic,
  zip,
  'check-health': { usage: checkHealth.usage, run: (a, io) => checkHealth.run(a, io) },
  preflight,
  'new-server': newServer,
  'new-feature': newFeature,
  'manifest-check': { usage: manifest.usageCheck, run: manifest.runCheck },
  'manifest-write': { usage: manifest.usageWrite, run: manifest.runWrite },
  'bundle-size': bundleSize,
  fleet,
};

export function usageLines(): string[] {
  return [
    'usage: foundation <command> [options]',
    '',
    ...Object.values(COMMANDS).map((c) => `  ${c.usage}`),
    '',
    'exit codes: 0 ok · 1 failure/usage · 2 manifest refused (wrong destination)',
  ];
}

export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    for (const l of usageLines()) io.log(l);
    return name ? 0 : 1;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.error(`unknown command: ${name}`);
    for (const l of usageLines()) io.log(l);
    return 1;
  }
  try {
    return await cmd.run(rest, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.error(`${name}: ${e.message}`);
      io.error(`usage: foundation ${cmd.usage}`);
      return 1;
    }
    io.error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
