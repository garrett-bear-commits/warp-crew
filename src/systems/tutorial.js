// @ts-nocheck
/**
 * First-session script (v2).
 * Beats are action-gated after the welcome tap — one system at a time.
 * Inspired by Barrowdeep (spotlight one action, Jest card after the peak)
 * and Zlarn (hide nav until the system exists, one glow on the live target).
 */
import { createCrewInstance } from '../data/crewRoster.js';

export const TUTORIAL_SCRIPT = 2;
export const TUTORIAL_RECRUIT_ID = 'merc_jen';

export const PHASES = [
  {
    id: 'meet',
    title: 'Sparrow is yours',
    body: 'Two mercs on deck. Rex flies. Bolt keeps her together.',
    cta: 'Open missions',
    tab: 'ship',
    spotlight: 'nav-missions',
    kicker: '1 / 5',
  },
  {
    id: 'jump',
    title: 'First jump',
    body: 'Pirates tagged Dust Lane. Spend 1 fuel and jump.',
    cta: null,
    tab: 'missions',
    spotlight: 'node-lane_a',
    kicker: '2 / 5',
  },
  {
    id: 'combat',
    title: 'Raise shields',
    body: 'Shield Boost is primed. Tap Engage.',
    cta: null,
    tab: 'missions',
    spotlight: 'combat-engage',
    kicker: '3 / 5',
  },
  {
    id: 'victory',
    title: 'First contact',
    body: 'Pirates broke off. Salvage is yours — then draw a gunner.',
    cta: 'Draw teammate',
    tab: 'missions',
    spotlight: 'draw-cta',
    kicker: '4 / 5',
    modal: 'victory',
  },
  {
    id: 'recruit',
    title: 'Jen Park comes aboard',
    body: 'A station gunner hails from the wreck. Third berth is hers.',
    cta: 'Welcome aboard',
    tab: 'crew',
    spotlight: null,
    kicker: '5 / 5',
    modal: 'recruit',
  },
  {
    id: 'join',
    title: 'Keep this crew',
    body: 'Register on Jest so Rex, Bolt, and Jen stay with you.',
    cta: 'Join Jest',
    tab: 'ship',
    spotlight: null,
    kicker: 'Save',
    modal: 'join',
  },
];

/** @deprecated — kept so old call sites compiling against TUTORIAL_STEPS still resolve */
export const TUTORIAL_STEPS = PHASES;

const TABS_BY_PHASE = {
  meet: ['ship', 'missions'],
  jump: ['ship', 'missions'],
  combat: ['ship', 'missions'],
  victory: ['ship', 'missions'],
  recruit: ['ship', 'crew', 'missions'],
  join: ['ship', 'crew', 'missions'],
  done: ['ship', 'crew', 'missions', 'shop', 'log'],
};

const FEATURES_BY_PHASE = {
  meet: ['nav_ship', 'nav_missions'],
  jump: ['nav_ship', 'nav_missions'],
  combat: ['nav_ship', 'nav_missions'],
  victory: ['nav_ship', 'nav_missions'],
  recruit: ['nav_ship', 'nav_crew', 'nav_missions'],
  join: ['nav_ship', 'nav_crew', 'nav_missions'],
  done: [
    'nav_ship',
    'nav_crew',
    'nav_missions',
    'nav_shop',
    'nav_log',
    'map_extra',
    'expeditions',
    'hangar',
    'gacha',
    'shop',
    'hud_gems',
    'hud_medals',
  ],
};

export function defaultTutorial() {
  return {
    script: TUTORIAL_SCRIPT,
    phase: 'meet',
    completed: false,
    dismissed: false,
    firstTravel: false,
    firstCombat: false,
    firstExpedition: false,
    hiredThird: false,
    slot3Unlocked: false,
    slot4Unlocked: false,
    jestPrompted: false,
    lastRewards: null,
    recruit: null,
  };
}

export function isTutorialActive(player) {
  const t = player?.tutorial || defaultTutorial();
  if (t.completed || t.dismissed) return false;
  return (t.script || 1) === TUTORIAL_SCRIPT;
}

export function tutorialPhase(player) {
  if (!isTutorialActive(player)) return 'done';
  return player.tutorial?.phase || 'meet';
}

export function isFeatureUnlocked(player, feature) {
  const phase = tutorialPhase(player);
  const list = FEATURES_BY_PHASE[phase] || FEATURES_BY_PHASE.done;
  return list.includes(feature);
}

export function unlockedTabs(player) {
  const phase = tutorialPhase(player);
  return TABS_BY_PHASE[phase] || TABS_BY_PHASE.done;
}

export function isTabUnlocked(player, tab) {
  return unlockedTabs(player).includes(tab);
}

export function currentTutorialStep(player) {
  if (!isTutorialActive(player)) return null;
  const phase = tutorialPhase(player);
  return PHASES.find((p) => p.id === phase) || PHASES[0];
}

export function preferredTab(player, fallback = 'ship') {
  const step = currentTutorialStep(player);
  if (step?.tab) return step.tab;
  return fallback;
}

export function hudChips(player) {
  const phase = tutorialPhase(player);
  if (phase === 'done') return ['fuel', 'credits', 'gems', 'medals'];
  if (phase === 'victory' || phase === 'recruit' || phase === 'join') {
    return ['fuel', 'credits', 'medals'];
  }
  return ['fuel', 'credits'];
}

export function migrateTutorial(player) {
  const incoming = player?.tutorial || {};
  const t = { ...defaultTutorial(), ...incoming };
  if (t.script !== TUTORIAL_SCRIPT) {
    t.script = TUTORIAL_SCRIPT;
    if (!incoming.completed && !incoming.dismissed && !(player?.stats?.jumps > 0)) {
      Object.assign(t, defaultTutorial());
    } else {
      t.completed = true;
      t.phase = 'done';
    }
  }
  if (t.completed) t.phase = 'done';
  return { ...player, tutorial: t };
}

export function setTutorialPhase(player, phase, extra = {}) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}), phase, ...extra };
  return { ...player, tutorial: t };
}

export function noteTutorialEvent(player, event, payload = {}) {
  let t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  let crewSlots = player.crewSlots;
  let advanced = false;
  const active = !t.completed && !t.dismissed && t.script === TUTORIAL_SCRIPT;

  if (event === 'travel_success') {
    t = { ...t, firstTravel: true };
  }
  if (event === 'expedition_done' || event === 'expedition_start') {
    t = { ...t, firstExpedition: true, slot4Unlocked: true };
    crewSlots = Math.max(crewSlots, 4);
  }

  if (!active) {
    if (event === 'travel_success' && !t.slot3Unlocked) {
      t = { ...t, slot3Unlocked: true };
      crewSlots = Math.max(crewSlots, 3);
    }
    return { player: { ...player, tutorial: t, crewSlots }, advanced: false };
  }

  if (event === 'combat_ready' && t.phase === 'jump') {
    t = { ...t, phase: 'combat' };
    advanced = true;
  }
  if (event === 'combat_abort' && t.phase === 'combat') {
    t = { ...t, phase: 'jump' };
    advanced = true;
  }
  if (event === 'combat_done' && !t.firstCombat) {
    t = {
      ...t,
      firstCombat: true,
      firstTravel: true,
      slot3Unlocked: true,
      phase: 'victory',
      lastRewards: payload.rewards || t.lastRewards,
    };
    crewSlots = Math.max(crewSlots, 3);
    advanced = true;
  }
  if (event === 'recruited' && !t.hiredThird) {
    t = { ...t, hiredThird: true, phase: 'recruit' };
    crewSlots = Math.max(crewSlots, 3);
    advanced = true;
  }
  if (event === 'jest_prompted') {
    t = { ...t, jestPrompted: true, phase: 'join' };
    advanced = true;
  }
  if (event === 'tutorial_complete') {
    t = { ...t, completed: true, phase: 'done', jestPrompted: true };
    crewSlots = Math.max(crewSlots, 3);
    advanced = true;
  }

  return { player: { ...player, tutorial: t, crewSlots }, advanced };
}

export function advanceTutorial(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  if (t.completed || t.dismissed) return player;
  const order = PHASES.map((p) => p.id);
  const idx = Math.max(0, order.indexOf(t.phase));
  const next = order[Math.min(order.length - 1, idx + 1)];
  return { ...player, tutorial: { ...t, phase: next } };
}

export function dismissTutorial(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  // First-session beats are not skippable. Dismiss only after the Jest prompt.
  if (t.phase !== 'join' && !t.completed) return player;
  return {
    ...player,
    tutorial: { ...t, dismissed: true, completed: true, phase: 'done' },
  };
}

export function completeTutorial(player, { registered = false } = {}) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  return {
    ...player,
    tutorial: {
      ...t,
      completed: true,
      phase: 'done',
      jestPrompted: true,
      registered,
    },
    crewSlots: Math.max(player.crewSlots || 0, 3),
  };
}

export function grantTutorialRecruit(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  if (t.hiredThird) {
    return { player: { ...player, tutorial: { ...t, phase: 'recruit' } }, instance: t.recruit };
  }
  const already = player.crew?.some((c) => c.templateId === TUTORIAL_RECRUIT_ID);
  const instance = already
    ? player.crew.find((c) => c.templateId === TUTORIAL_RECRUIT_ID)
    : createCrewInstance(TUTORIAL_RECRUIT_ID);
  const crew = already ? player.crew : [...(player.crew || []), instance];
  return {
    player: {
      ...player,
      crewSlots: Math.max(player.crewSlots || 0, 3),
      crew,
      tutorial: {
        ...t,
        hiredThird: true,
        slot3Unlocked: true,
        phase: 'recruit',
        recruit: {
          instanceId: instance.instanceId,
          templateId: instance.templateId,
          name: instance.name,
          role: instance.role,
          rarity: instance.rarity,
          blurb: instance.blurb,
        },
      },
    },
    instance,
  };
}

export function beginJoinPrompt(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  return {
    ...player,
    tutorial: { ...t, phase: 'join', jestPrompted: true },
  };
}

/** Soft 7-day goals for test week — hidden until the intro is done */
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
