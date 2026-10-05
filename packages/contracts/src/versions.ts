// Build versions: one release version per production deploy. Git tags are `vX.Y.Z`;
// every version value (x-build-version, readiness, analytics, Settings) is the bare `X.Y.Z`,
// staging `X.Y.Z-staging.<run>`. Browser-safe: no TypeBox, so clients import it directly
// from '@foundation/contracts/versions'.

/** A strict version value: `X.Y.Z` with optional `-prerelease` and `+metadata`, no `v`. */
export const BUILD_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** A final release value (`X.Y.Z` only), as production announces. */
export const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isBuildVersion(value: string): boolean {
  return BUILD_VERSION_PATTERN.test(value);
}

function numericParts(version: string): number[] {
  return version
    .replace(/^[vV]/, '')
    .split('+')[0]!
    .split('-')[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Compare build versions by their numeric `X.Y.Z`. `-prerelease` and `+metadata` are
 *  ignored, so a staging build equals its release for minBuildVersion checks. A stray
 *  leading `v` is tolerated (without it `v1.0.0` would read as 0 and fail every check);
 *  other non-numeric parts count as 0, so 'dev' equals '0.0.0'. */
export function compareBuildVersions(a: string, b: string): number {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
