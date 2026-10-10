// @ts-nocheck
/**
 * Every transmission the game can play, by id (Phase 3 §1): the campaign's (src/data/campaign.js) and the bond scenes
 * and loyalty missions (src/data/bonds.js): bond_<templateId>_1 and _2, loyal_<templateId>_brief and _debrief.
 */
import { TRANSMISSIONS } from '../data/campaign.js';
import { BONDS } from '../data/bonds.js';
import { catalogById } from '../data/crewRoster.js';

const BOND_ID = /^(bond|loyal)_(merc_[a-z0-9_]+?)_(1|2|brief|debrief)$/;

/** A bond scene or loyalty mission transmission by id, or null. */
export function bondTransmission(id) {
  const match = BOND_ID.exec(String(id || ''));
  const bond = match && Object.hasOwn(BONDS, match[2]) ? BONDS[match[2]] : null;
  if (!bond) return null;
  const kind = match[3];
  const panels = match[1] === 'bond'
    ? (kind === '1' ? bond.scene1 : kind === '2' ? bond.scene2 : null)
    : (kind === 'brief' ? bond.mission.briefing : kind === 'debrief' ? bond.mission.debrief : null);
  if (!panels) return null;
  const kicker = match[1] === 'bond' ? (kind === '1' ? 'Trusted' : 'Close') : kind === 'brief' ? 'Loyalty' : 'Loyal';
  return { id, kicker, title: match[1] === 'loyal' ? bond.mission.title : catalogById(match[2])?.name || 'Crew', panels };
}

/** A transmission ready to show (the UI resolves speakers), or null for an unknown id. */
export function transmissionById(id) {
  if (Object.hasOwn(TRANSMISSIONS, id)) return { id, ...TRANSMISSIONS[id] };
  return bondTransmission(id);
}

export const isTransmissionId = id => typeof id === 'string' && Boolean(transmissionById(id));
