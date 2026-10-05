// storage (§5.2 Storage tiers, ADR-005): localStorage primary → memory shim; origin-scoped slots;
// the cache envelope (sync metadata lives here, never in S); the save codec with numbered
// migrations and a never-throwing trialDeserialize; navigator.storage.persist() once; IndexedDB
// only for the journal spool.
export * from './tiers.ts';
export * from './codec.ts';
export * from './envelope.ts';
export * from './spool.ts';
