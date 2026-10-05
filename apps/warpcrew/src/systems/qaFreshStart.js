// QA's fresh-save link is intentionally destructive once, not on every refresh.
export function consumeFreshStart({ location, history, clearSave }) {
  const url = new URL(location.href);
  if (url.searchParams.get('fresh') !== '1') return false;
  clearSave();
  url.searchParams.delete('fresh');
  history.replaceState(history.state ?? null, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
