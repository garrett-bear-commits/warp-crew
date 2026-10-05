// Dotted build version comparison (numeric segments; '-pre' and '+meta' ignored) — the same rule
// the server applies for minBuildVersion (426 build_too_old), so the client can show the update
// banner proactively from the public config instead of waiting for the first refused call.
export function compareBuildVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
