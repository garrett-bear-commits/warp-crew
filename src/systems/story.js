// @ts-nocheck
import { STORY_BEATS } from '../data/sectors.js';

export function applyStoryFlag(player, flag) {
  if (!flag) return { player, beat: null };
  const flags = { ...(player.flags || {}), [flag]: true };
  const beat = STORY_BEATS[flag] || null;
  let story = { ...(player.story || {}) };
  if (beat?.chapter && (story.chapter || 0) < beat.chapter) {
    story.chapter = beat.chapter;
  }
  if (flag === 'rumor_swarm' || flag === 'colony_help' || flag === 'scar_vision') {
    story.eclipseIntro = true;
  }
  if (flag === 'veil_opened') {
    story.veilUnlocked = true;
  }
  // Reputation bump for story progress
  const wallet = {
    ...player.wallet,
    reputation: (player.wallet.reputation || 0) + (beat ? 3 : 0),
    credits: (player.wallet.credits || 0) + (beat ? 40 : 0),
  };
  return {
    player: { ...player, flags, story, wallet },
    beat,
  };
}

export function storyProgress(player) {
  const flags = player.flags || {};
  const total = Object.keys(STORY_BEATS).length;
  const done = Object.keys(STORY_BEATS).filter((k) => flags[k]).length;
  return {
    chapter: player.story?.chapter || 0,
    done,
    total,
    veilUnlocked: Boolean(player.story?.veilUnlocked || flags.veil_opened),
    beats: Object.entries(STORY_BEATS).map(([id, b]) => ({
      id,
      ...b,
      unlocked: Boolean(flags[id]),
    })),
  };
}
