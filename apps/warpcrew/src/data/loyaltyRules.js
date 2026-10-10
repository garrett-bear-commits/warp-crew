// @ts-nocheck
/**
 * What being Loyal does in a fight (Phase 3 design §5). Shared by the loyalty rules (src/systems/loyalty.js) and the
 * fight's save check (src/systems/ftlCombat.js), which must allow a Loyal merc's larger passive (audit 2026-10-10 H1).
 */
/** A Loyal merc's role passive counts this much more in fights. */
export const LOYAL_PASSIVE = 1.25;
/** A Loyal merc's fight grade rises by this much (capped at 1). */
export const LOYAL_GRADE = 0.05;
