// Minimal argv parser shared by every `foundation` subcommand: `--key value`, `--key=value`,
// `--flag` (boolean), positionals. No dependencies.

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positionals: [], options: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out.options[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.options[key] = next;
        i++;
      } else out.options[key] = true;
      continue;
    }
    out.positionals.push(a);
  }
  return out;
}

export class UsageError extends Error {}

/** Required string option; throws UsageError with the flag name when missing. */
export function opt(args: ParsedArgs, name: string): string {
  const v = args.options[name];
  if (typeof v !== 'string' || v === '') throw new UsageError(`--${name} <value> is required`);
  return v;
}

export function optOr(args: ParsedArgs, name: string, fallback: string): string {
  const v = args.options[name];
  return typeof v === 'string' && v !== '' ? v : fallback;
}

export function optMaybe(args: ParsedArgs, name: string): string | undefined {
  const v = args.options[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function flag(args: ParsedArgs, name: string): boolean {
  const v = args.options[name];
  return v === true || v === 'true' || v === '1';
}

export function optInt(args: ParsedArgs, name: string): number | undefined {
  const v = optMaybe(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number`);
  return n;
}

/** Output sink so commands stay testable without capturing stdout. */
export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

export const consoleIo: Io = {
  log: (l) => console.log(l),
  error: (l) => console.error(l),
};
