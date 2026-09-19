// @ts-nocheck
/**
 * Resolve art paths for App Builder (`/art/...`), GitHub Pages
 * (`/warp-crew/art/...`), and Jest hosts that serve the same folder.
 */
export function artUrl(path) {
  const rel = String(path || '').replace(/^\//, '');
  if (typeof document !== 'undefined' && document.baseURI) {
    try {
      return new URL(rel, document.baseURI).href;
    } catch {
      /* fall through */
    }
  }
  let base = '/';
  try {
    const envBase = import.meta.env?.BASE_URL;
    if (typeof envBase === 'string' && envBase.length) base = envBase;
  } catch {
    /* ignore */
  }
  if (!base.endsWith('/')) base += '/';
  return base + rel;
}
