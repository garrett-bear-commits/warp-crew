/** Settle essential images, trying each fallback before counting that item complete. */
export async function preloadEssentialAssets(sources, load, onProgress = () => {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) {
    onProgress(100);
    return [];
  }
  let settled = 0;
  onProgress(0);
  return Promise.all(list.map(async item => {
    let path = null;
    try {
      await load(item.src);
      path = item.src;
    } catch {
      if (item.fallback && item.fallback !== item.src) {
        try {
          await load(item.fallback);
          path = item.fallback;
        } catch { /* CSS fallback remains available. */ }
      }
    } finally {
      settled += 1;
      onProgress(Math.round(100 * settled / list.length));
    }
    return path;
  }));
}

/** A timed image probe ensures a missing image cannot hold the opening forever. */
export function loadEssentialImage(src, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => {
      image.onload = image.onerror = null;
      reject(new Error(`Timed out loading ${src}`));
    }, timeoutMs);
    image.onload = () => { clearTimeout(timeout); resolve(src); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error(`Could not load ${src}`)); };
    image.src = src;
  });
}
