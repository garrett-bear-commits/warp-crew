// @ts-nocheck
import { STORY_BEATS } from '../data/sectors.js';

export function applyStoryFlag(player, flag) {
  if (!flag) return { player, beat: null, rewards: null, already: false };
  const beat = STORY_BEATS[flag] || null;
  if (player.flags?.[flag]) {
    return { player, beat, rewards: null, already: true };
  }
  const flags = { ...(player.flags || {}), [flag]: true };
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
  if (flag === 'ember_opened') {
    story.emberUnlocked = true;
  }
  if (flag === 'hollow_opened') {
    story.hollowUnlocked = true;
  }
  if (flag === 'crown_opened') {
    story.crownUnlocked = true;
  }
  const rewards = beat
    ? {
        credits: beat.rewards?.credits ?? 40,
        reputation: beat.rewards?.reputation ?? 3,
        medals: beat.rewards?.medals || 0,
        gems: beat.rewards?.gems || 0,
      }
    : { credits: 40, reputation: 3 };
  const wallet = {
    ...player.wallet,
    credits: (player.wallet.credits || 0) + (rewards.credits || 0),
    reputation: (player.wallet.reputation || 0) + (rewards.reputation || 0),
    medals: (player.wallet.medals || 0) + (rewards.medals || 0),
    gems: (player.wallet.gems || 0) + (rewards.gems || 0),
  };
  return {
    player: { ...player, flags, story, wallet },
    beat,
    rewards,
    already: false,
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
    emberUnlocked: Boolean(player.story?.emberUnlocked || flags.ember_opened),
    hollowUnlocked: Boolean(player.story?.hollowUnlocked || flags.hollow_opened),
    crownUnlocked: Boolean(player.story?.crownUnlocked || flags.crown_opened),
    beats: Object.entries(STORY_BEATS).map(([id, b]) => ({
      id,
      ...b,
      unlocked: Boolean(flags[id]),
    })),
  };
}
