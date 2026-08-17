// foundation fleet --check [--file fleet.json]   (§8 fleet.json shape)
import { resolve } from 'node:path';
import { loadFleet } from '../fleet.ts';
import { optMaybe, parseArgs, type Io } from '../args.ts';

export const usage = 'fleet --check [--file <fleet.json>]';

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const file = optMaybe(args, 'file');
  const r = file ? loadFleet(resolve(file)) : loadFleet();
  for (const e of r.fleet)
    io.log(`  ${e.name}: game=${e.game} env=${e.env} api=${e.apiUrl} static=${e.staticUrl}`);
  for (const p of r.problems) io.log(`  problem: ${p}`);
  io.log(r.ok ? `fleet: OK (${r.fleet.length} entries)` : `fleet: ${r.problems.length} problem(s)`);
  return r.ok ? 0 : 1;
}
