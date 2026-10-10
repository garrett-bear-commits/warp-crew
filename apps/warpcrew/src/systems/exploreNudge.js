// @ts-nocheck
/**
 * One-time pointers to the sector map for captains who just finished the script-5 first session:
 *   coach     — a coach mark on the Explore entry (Missions tab) until they open Explore once
 *   mapIntro  — a short card on their first visit to the map, until dismissed or their first jump
 *   eventHint — one line on their first event card
 * "Seen" flags live in player.flags (saved). Veterans who already jumped on the map never see them.
 */
import { isTutorialActive, missionViews } from './tutorial.js';

export const EXPLORE_NUDGE_FLAGS = Object.freeze({
  coach: 'exploreCoachSeen',
  mapIntro: 'exploreMapIntroSeen',
  eventHint: 'exploreEventHintSeen',
});
/** Set on a new captain's first map jump, so their first event card still gets its hint. */
const NEW_TO_MAP = 'exploreNewCaptain';

/**
 * Map jumps so far: every contract claim, won or lost, also counts a jump (and a completed contract), so those are
 * taken out. Losses are already inside contractsCompleted; subtracting them again stuck the count at 0.
 */
export function mapJumps(player) {
  const s = player?.stats || {};
  return Math.max(0, (s.jumps || 0) - (s.contractsCompleted || 0));
}

function newCaptain(player) {
  return player?.tutorial?.script === 5 && player.tutorial.completed === true && !isTutorialActive(player);
}

export function exploreNudges(player) {
  const flags = player?.flags || {};
  const fresh = newCaptain(player) && mapJumps(player) === 0 && !flags.mapUsed;
  const open = fresh && missionViews(player).includes('explore');
  return {
    coach: open && !flags[EXPLORE_NUDGE_FLAGS.coach],
    mapIntro: open && !flags[EXPLORE_NUDGE_FLAGS.mapIntro],
    eventHint: newCaptain(player) && !flags[EXPLORE_NUDGE_FLAGS.eventHint]
      && (flags[NEW_TO_MAP] === true || (mapJumps(player) === 0 && !flags.mapUsed)),
  };
}

/** Mark one nudge (coach, mapIntro, eventHint) seen. Returns the same player when nothing changes. */
export function markExploreNudge(player, nudge) {
  const flag = EXPLORE_NUDGE_FLAGS[nudge];
  if (!flag || player?.flags?.[flag]) return player;
  return { ...player, flags: { ...(player.flags || {}), [flag]: true } };
}

/** A jump was committed: the map has been found. A new captain keeps their first-event hint. */
export function noteMapJump(player, before) {
  const keepHint = exploreNudges(before).eventHint;
  return { ...player, flags: { ...(player.flags || {}), mapUsed: true,
    [EXPLORE_NUDGE_FLAGS.coach]: true, [EXPLORE_NUDGE_FLAGS.mapIntro]: true, ...(keepHint ? { [NEW_TO_MAP]: true } : {}) } };
}
