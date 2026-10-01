// Which environment this page administers, from its own hostname (the API is always this origin).
// Production's admin host(s) are baked in at build time (VITE_ADMIN_PRODUCTION_HOSTS, a comma
// list, optional); without them a host naming staging or prod is read as such, so a platform's
// generated service domain (e.g. Railway's admin-production-xxxx.up.railway.app) still gets a badge.

export type EnvKind = 'production' | 'staging' | 'local' | 'unknown';

export interface EnvBadge {
  readonly kind: EnvKind;
  readonly label: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/\.$/, '');

/** `"admin.example.com, Ops.Example.com."` → `['admin.example.com', 'ops.example.com']`. */
export function parseHosts(list: string | undefined): string[] {
  return (list ?? '').split(',').map(normalizeHost).filter(Boolean);
}

/** Production's admin origin host(s), from the build (empty when the build sets none). */
export const PRODUCTION_ADMIN_HOSTS: readonly string[] = parseHosts(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_ADMIN_PRODUCTION_HOSTS,
);

export function environmentFor(
  hostname: string,
  productionHosts: readonly string[] = PRODUCTION_ADMIN_HOSTS,
): EnvBadge {
  const host = normalizeHost(hostname);
  if (productionHosts.includes(host)) return { kind: 'production', label: 'Production' };
  if (host.includes('staging')) return { kind: 'staging', label: 'Staging' };
  if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost'))
    return { kind: 'local', label: 'Local' };
  // A host naming production (its platform service name) is production data too.
  if (host.includes('prod')) return { kind: 'production', label: 'Production' };
  return { kind: 'unknown', label: 'Unknown env' };
}
