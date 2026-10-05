// foundation check-health --url <api> [--assert page|warn] [--ops-secret <s>] | --fleet <name>
import { checkHealth } from '../health.ts';
import { loadFleet } from '../fleet.ts';
import { UsageError, optMaybe, parseArgs, type Io } from '../args.ts';

export const usage =
  'check-health (--url <api> | --fleet <name> [--fleet-file <path>]) [--assert page|warn] [--ops-secret <s>]';

export async function run(argv: string[], io: Io, f: typeof fetch = fetch): Promise<number> {
  const args = parseArgs(argv);
  let url = optMaybe(args, 'url');
  const fleetName = optMaybe(args, 'fleet');
  if (!url && fleetName) {
    const fleetFile = optMaybe(args, 'fleet-file');
    const fleet = fleetFile ? loadFleet(fleetFile) : loadFleet();
    const entry = fleet.fleet.find((e) => e.name === fleetName);
    if (!entry) throw new UsageError(`fleet entry "${fleetName}" not found`);
    url = entry.apiUrl;
  }
  if (!url) throw new UsageError('--url <api> or --fleet <name> is required');
  const assertRaw = optMaybe(args, 'assert');
  if (assertRaw !== undefined && assertRaw !== 'page' && assertRaw !== 'warn')
    throw new UsageError('--assert must be page or warn');
  const opsSecret = optMaybe(args, 'ops-secret') ?? process.env.OPS_SECRET;
  const r = await checkHealth({
    url,
    assert: assertRaw,
    opsSecret,
    fetch: f,
  });
  for (const l of r.lines) io.log(l);
  io.log(r.ok ? 'check-health: OK' : 'check-health: FAILED');
  return r.ok ? 0 : 1;
}
