// identity client entry (browser-safe): thin fetch wrapper, types only.
import type { Api } from '../../http/client-fetch.ts';
/** identity has no player routes of its own: the verifier runs on every authenticated call. */
export function identityClient(_api: Api) {
  return {};
}
