/**
 * First-session tutorial + soft week goals (Track A + B).
 * Non-blocking: player can dismiss, progress still tracked.
 */

export const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome aboard',
    body: 'You command the freighter Sparrow with two mercs. Claim offline fuel anytime, then open MISSIONS.',
    tab: 'ship',
  },
  {
    id: 'travel',
    title: 'First jump',
    body: 'Travel to Dust Lane (1 fuel). Peaceful outcomes pay credits; combat opens the assist picker.',
    tab: 'missions',
  },
  {
    id: 'assist',
    title: 'Combat assists',
    body: 'When pirates jump you, pick assists (Shield / Repair / Overcharge) then Engage. No permadeath.',
    tab: 'missions',
  },
  {
    id: 'hire',
    title: 'Third crew slot',
    body: 'After your first successful jump, a third crew slot unlocks. Use Free hire on CREW (or expand quarters).',
    tab: 'crew',
  },
  {
    id: 'expedition',
    title: 'Launch an expedition',
    body: 'Send ready crew to Dustfall Outpost (short timer). Claim when done — or Skip with gems for QA.',
    tab: 'missions',
  },
  {
    id: 'done',
    title: 'You are cleared',
    body: 'Grow reputation, chase story beats toward Veil Gate, save for Corvette. Check WEEK GOALS on SHIP.',
    tab: 'ship',
  },
];

export function defaultTutorial() {
  return {
    stepIndex: 0,
    completed: false,
    dismissed: false,
    // event flags
    firstTravel: false,
    firstCombat: false,
    firstExpedition: false,
    hiredThird: false,
    slot3Unlocked: false,
    slot4Unlocked: false,
  };
}

export function migrateTutorial(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  return { ...player, tutorial: t };
}

/** Advance tutorial when matching events fire */
export function noteTutorialEvent(player, event) {
  let t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  let crewSlots = player.crewSlots;
  let advanced = false;

  // Progression unlocks still apply after tutorial is completed/dismissed
  if (event === 'travel_success' && !t.slot3Unlocked) {
    t = { ...t, firstTravel: true, slot3Unlocked: true };
    crewSlots = Math.max(crewSlots, 3);
  }
  if (event === 'expedition_done' || (event === 'expedition_start' && t.firstTravel)) {
    t = { ...t, firstExpedition: true, slot4Unlocked: true };
    crewSlots = Math.max(crewSlots, 4);
  }

  if (t.completed || t.dismissed) {
    return { player: { ...player, tutorial: t, crewSlots }, advanced: false };
  }

  if (event === 'travel_success' && !t.firstTravel) {
    t = { ...t, firstTravel: true, slot3Unlocked: true };
    crewSlots = Math.max(crewSlots, 3);
    if (t.stepIndex < 2) {
      t = { ...t, stepIndex: 2 }; // point at assist tip (or hire if no combat yet)
      advanced = true;
    }
  }
  if (event === 'combat_done' && !t.firstCombat) {
    t = { ...t, firstCombat: true };
    if (t.stepIndex < 3) {
      t = { ...t, stepIndex: 3 };
      advanced = true;
    }
  }
  if (event === 'hired' && player.crew.length >= 3 && !t.hiredThird) {
    t = { ...t, hiredThird: true };
    if (t.stepIndex < 4) {
      t = { ...t, stepIndex: 4 };
      advanced = true;
    }
  }
  if (event === 'expedition_start' && !t.firstExpedition) {
    t = { ...t, firstExpedition: true };
    if (t.stepIndex < 5) {
      t = { ...t, stepIndex: 5 };
      advanced = true;
    }
  }
  if (event === 'expedition_done') {
    t = { ...t, firstExpedition: true, slot4Unlocked: true };
    crewSlots = Math.max(crewSlots, 4);
  }

  // Auto-complete when all key actions done
  if (
    t.firstTravel &&
    (t.firstCombat || t.firstExpedition) &&
    t.hiredThird &&
    t.firstExpedition &&
    !t.completed
  ) {
    t = { ...t, completed: true, stepIndex: TUTORIAL_STEPS.length - 1 };
    advanced = true;
  }

  return {
    player: { ...player, tutorial: t, crewSlots },
    advanced,
  };
}

export function advanceTutorial(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  if (t.completed || t.dismissed) return player;
  const next = Math.min(TUTORIAL_STEPS.length - 1, (t.stepIndex || 0) + 1);
  const completed = next >= TUTORIAL_STEPS.length - 1 && t.firstTravel;
  return {
    ...player,
    tutorial: { ...t, stepIndex: next, completed: completed || t.completed },
  };
}

export function dismissTutorial(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  return { ...player, tutorial: { ...t, dismissed: true } };
}

export function currentTutorialStep(player) {
  const t = player.tutorial || defaultTutorial();
  if (t.dismissed || t.completed) return null;
  return TUTORIAL_STEPS[t.stepIndex] || TUTORIAL_STEPS[0];
}

/** Soft 7-day goals for test week */
export function weekGoals(player) {
  const s = player.stats || {};
  const flags = player.flags || {};
  const day = 1 + Math.floor((Date.now() - (player.createdAt || Date.now())) / 86400000);
  return {
    careerDay: day,
    goals: [
      {
        id: 'jumps_5',
        label: 'Complete 5 jumps',
        done: (s.jumps || 0) >= 5,
        progress: `${s.jumps || 0}/5`,
      },
      {
        id: 'combat_3',
        label: 'Win 3 combats',
        done: (s.combatsWon || 0) >= 3,
        progress: `${s.combatsWon || 0}/3`,
      },
      {
        id: 'exp_2',
        label: 'Finish 2 expeditions',
        done: (s.expeditions || 0) >= 2,
        progress: `${s.expeditions || 0}/2`,
      },
      {
        id: 'rep_25',
        label: 'Reach 25 reputation',
        done: (player.wallet.reputation || 0) >= 25,
        progress: `${player.wallet.reputation || 0}/25`,
      },
      {
        id: 'story_2',
        label: 'Unlock 2 story beats',
        done: Object.keys(flags).filter((k) => flags[k]).length >= 2,
        progress: `${Object.keys(flags).filter((k) => flags[k]).length}/2`,
      },
      {
        id: 'crew_4',
        label: 'Hold 4 crew (or max slots)',
        done: player.crew.length >= Math.min(4, player.crewSlots),
        progress: `${player.crew.length}/${Math.min(4, player.crewSlots)}`,
      },
      {
        id: 'corvette_or_ch2',
        label: 'Own Corvette OR reach story Ch.2',
        done:
          (player.ship?.ownedHulls || []).includes('corvette') ||
          (player.story?.chapter || 0) >= 2,
        progress: (player.ship?.ownedHulls || []).includes('corvette')
          ? 'Corvette'
          : `Ch.${player.story?.chapter || 0}`,
      },
    ],
  };
}
