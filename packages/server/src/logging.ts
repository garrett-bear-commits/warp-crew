// pino JSON with a redaction list (§8): tokens, admin secrets, key-like path segments. The same
// module feeds Sentry beforeSend when SENTRY_DSN is set.
export function redactionPaths(): string[] {
  return [
    'req.headers.authorization',
    'req.headers["x-admin-secret"]',
    'req.headers["x-ops-secret"]',
    'headers.authorization',
    'token',
    'purchaseSigned',
    'purchasesSigned',
    'body.token',
    'body.purchaseSigned',
    'body.purchasesSigned',
    '*.purchaseSigned',
    '*.purchasesSigned',
    '*.body.purchaseSigned',
    '*.body.purchasesSigned',
    '*.token',
    '*.secret',
    '*.secretB64',
  ];
}

/** Scrub key-like path segments and bearer tokens from free text (Sentry beforeSend / logs). */
export function scrubText(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]')
    .replace(/\/players\/[^/\s?]+/g, '/players/[key]')
    .replace(/(x-player-key|playerKey)["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{4,}/gi, '$1=[key]');
}
