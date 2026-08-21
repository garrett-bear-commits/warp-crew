// @foundation/client — the web adapter (§5): engine contract + loop, storage tiers + codec +
// envelope, sync (verdicts, ratchet, reconcile, client), boot machine, restore + gate, generations,
// tabs, journal, clock, identity switch, providers (types, mock, standalone, jest, conformance),
// createGameClient. React shells live in './react' (separate entry point).
export * from './api.ts';
export * from './ids.ts';
export * from './engine/contract.ts';
export * from './engine/loop.ts';
export * from './clock/index.ts';
export * from './storage/index.ts';
export * from './sync/verdicts.ts';
export * from './sync/ratchet.ts';
export * from './sync/reconcile.ts';
export * from './sync/client.ts';
export * from './boot/machine.ts';
export * from './restore/gate.ts';
export * from './restore/index.ts';
export * from './generations.ts';
export * from './tabs/leader.ts';
export * from './journal/index.ts';
export * from './identity/switch.ts';
export * from './providers/types.ts';
export * from './providers/mock.ts';
export * from './providers/standalone.ts';
export * from './providers/jest.ts';
export * from './providers/conformance.ts';
export * from './game-client.ts';
