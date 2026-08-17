import { canonicalJson, sha256Hex } from '../db/canonical.ts';

/**
 * request_hash = SHA-256 over {commandType, canonicalPayload}. Auth and transport fields
 * (commandId, tokens, keys, requestId) are excluded by the caller before hashing, so the same
 * commandId reused for a different command type or payload can never replay another result.
 */
export function requestHash(commandType: string, payload: unknown): string {
  return sha256Hex(canonicalJson({ commandType, payload }));
}
