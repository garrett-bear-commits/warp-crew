/** Compare dotted build versions (semver-ish, numeric segments; '+meta' ignored). */
export function compareBuildVersions(a: string, b: string): number {
  const pa = a
    .split('+')[0]!
    .split('-')[0]!
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = b
    .split('+')[0]!
    .split('-')[0]!
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
