/**
 * Mock provider pathologies (§3 testkit, §5.3 createMockPlatform(pathologies)). The conformance
 * suite drives the mock through every path a real provider must pass; these knobs make the mock
 * misbehave in the ways real platforms have.
 */
export interface ProviderPathologies {
  /** identity.ready() never resolves (SDK hangs). */
  identityNeverReady?: boolean;
  /** identity.ready() resolves after N ms. */
  identityDelayMs?: number;
  /** tokenFor() returns null (no token). */
  noToken?: boolean;
  /** getPlayer() flips to a different registered player after N ms (guest → account). */
  identitySwitchAfterMs?: { ms: number; playerId: string };
  /** payments.begin() resolves 'cancel'. */
  paymentsCancel?: boolean;
  /** payments.begin() resolves 'success' but omits purchaseSigned. */
  paymentsUnsignedSuccess?: boolean;
  /** payments.begin() throws. */
  paymentsThrow?: boolean;
  /** recoverIncomplete() yields N signed receipts. */
  incompletePurchases?: number;
  /** kv.set/flush reject. */
  kvWriteFails?: boolean;
  /** kv.readBreakGlass returns this value (or null). */
  kvBreakGlassValue?: string | null;
  /** notifications.eligible() false. */
  notificationsIneligible?: boolean;
  /** localStorage throws on access (blocked/partitioned). */
  storageBlocked?: boolean;
  /** localStorage quota exceeded on set. */
  storageQuotaExceeded?: boolean;
}
