// @ts-nocheck
/**
 * First-session script (v3). Beats follow committed contract and away actions.
 */
import { createCrewInstance } from '../data/crewRoster.js';

export const TUTORIAL_SCRIPT = 3;
export const TUTORIAL_RECRUIT_ID = 'merc_jen';

export const PHASES = [
  {
    id: 'distress',
    title: 'Distress signal',
    body: 'A freighter needs help. Review the Bridge alert for fuel, payout, danger, and favored crew.',
    cta: 'Review distress contract',
    tab: 'ship',
    spotlight: 'bridge-alert',
    kicker: '1 / 7',
  },
  {
    id: 'launch',
    title: 'Launch the Sparrow',
    body: 'Your rescue route is ready. Launch spends one fuel.',
    cta: 'Launch',
    tab: 'missions',
    spotlight: 'contract-launch',
    kicker: '2 / 7',
  },
  {
    id: 'order',
    title: 'Pirate Scout',
    body: 'Read the enemy tell and choose Brace to protect hull and crew. Victory is Guaranteed.',
    cta: 'Brace',
    tab: 'missions',
    spotlight: 'combat-order-brace',
    kicker: '3 / 7',
  },
  {
    id: 'return',
    title: 'Bring it aboard',
    body: 'Claim the rescue payout in Cargo and light up the Sparrow.',
    cta: 'Bring it aboard',
    tab: 'ship',
    spotlight: 'contract-claim',
    kicker: '4 / 7',
  },
  {
    id: 'recruit',
    title: 'Jen Park',
    body: 'The third berth is open. Recruit Jen and welcome her aboard.',
    cta: 'Recruit Jen',
    tab: 'crew',
    spotlight: 'tutorial-recruit',
    kicker: '5 / 7',
  },
  {
    id: 'choose',
    title: 'Your next contract',
    body: 'Review Reliable, Risky, and Strange, then accept your next job.',
    cta: 'Review contracts',
    tab: 'missions',
    spotlight: 'contract-board',
    kicker: '6 / 7',
  },
  {
    id: 'away',
    title: 'Dustfall expedition',
    body: 'Choose an away team. Review its return time, payout, risk, and unavailable crew before launch.',
    cta: 'Choose crew',
    tab: 'missions',
    spotlight: 'expedition-dustfall',
    kicker: '7 / 7',
  },
  {
    id: 'done',
    title: 'Back aboard',
    body: 'The Sparrow is yours. Your daily plan shows the next useful action.',
    cta: null,
    tab: 'ship',
    spotlight: null,
    kicker: '',
  },
];

/** @deprecated — kept so old call sites compiling against TUTORIAL_STEPS still resolve */
export const TUTORIAL_STEPS = PHASES;

const TABS_BY_PHASE = {
  distress: ['ship', 'missions'],
  launch: ['ship', 'missions'],
  order: ['ship', 'missions'],
  return: ['ship', 'missions'],
  recruit: ['ship', 'crew', 'missions'],
  choose: ['ship', 'crew', 'missions'],
  away: ['ship', 'crew', 'missions'],
  done: ['ship', 'crew', 'missions', 'shop', 'log'],
};

const FEATURES_BY_PHASE = {
  distress: ['nav_ship', 'nav_missions'],
  launch: ['nav_ship', 'nav_missions'],
  order: ['nav_ship', 'nav_missions'],
  return: ['nav_ship', 'nav_missions'],
  recruit: ['nav_ship', 'nav_crew', 'nav_missions'],
  choose: ['nav_ship', 'nav_crew', 'nav_missions'],
  away: ['nav_ship', 'nav_crew', 'nav_missions', 'expeditions'],
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
    phase: 'distress',
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
    ordersBeat: null,
  };
}

export function isTutorialActive(player) {
  const t = player?.tutorial || defaultTutorial();
  if (t.completed || t.dismissed) return false;
  return (t.script || 1) === TUTORIAL_SCRIPT;
}

export function tutorialPhase(player) {
  if (!isTutorialActive(player)) return 'done';
  return player.tutorial?.phase || 'distress';
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
  if (['return', 'recruit', 'choose', 'away'].includes(phase)) {
    return ['fuel', 'credits', 'medals'];
  }
  return ['fuel', 'credits'];
}

export function migrateTutorialV3(player) {
  const incoming = player?.tutorial || {};
  const t = { ...defaultTutorial(), ...incoming };
  const phases = ['distress', 'launch', 'order', 'return', 'recruit', 'choose', 'away', 'done'];
  const priorVeteran = incoming.script !== 2 && incoming.script !== TUTORIAL_SCRIPT
    && ((player?.stats?.jumps || 0) > 0 || (player?.stats?.combatsWon || 0) > 0);
  if (incoming.completed || incoming.dismissed || priorVeteran) {
    t.completed = true;
    t.phase = 'done';
    t.ordersBeat = 'done';
  } else if (incoming.script !== TUTORIAL_SCRIPT || !phases.includes(incoming.phase)) {
    t.phase = incoming.hiredThird ? 'choose' : incoming.firstCombat ? 'recruit' : 'distress';
  }
  t.script = TUTORIAL_SCRIPT;
  return { ...player, tutorial: t };
}

export const migrateTutorial = migrateTutorialV3;

export function setTutorialPhase(player, phase, extra = {}) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}), phase, ...extra };
  return { ...player, tutorial: t };
}

export function noteTutorialEvent(player, event, payload = {}) {
  let t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  let crewSlots = player.crewSlots || 2;
  let story = player.story;
  let advanced = false;
  const active = !t.completed && !t.dismissed && t.script === TUTORIAL_SCRIPT;
  const contract = player.activeContract;
  const expedition = player.activeExpedition;
  const committedAway = expedition?.payload?.crewInstanceIds?.length > 0;

  if (!active) {
    if ((event === 'expedition_start' && committedAway) || event === 'expedition_done') {
      t = { ...t, firstExpedition: true, slot4Unlocked: true };
      crewSlots = Math.max(crewSlots, 4);
    }
    if (event === 'travel_success' && !t.slot3Unlocked) {
      t = { ...t, firstTravel: true, slot3Unlocked: true };
      crewSlots = Math.max(crewSlots, 3);
    }
    return { player: { ...player, tutorial: t, crewSlots }, advanced: false };
  }

  if (event === 'contract_reviewed' && t.phase === 'distress'
    && payload.offerId === 'offer_tutorial_distress'
    && player.contractBoard?.offers?.some((offer) => offer.id === payload.offerId)) {
    t = { ...t, phase: 'launch' };
    advanced = true;
  } else if (event === 'contract_launched' && t.phase === 'launch'
    && contract?.profile === 'distress' && contract.stage === 'confrontation') {
    t = { ...t, phase: 'order', firstTravel: true };
    advanced = true;
  } else if (event === 'combat_order_done' && t.phase === 'order'
    && contract?.profile === 'distress' && contract.stage === 'return'
    && contract.orderId === 'brace' && contract.result?.success) {
    t = { ...t, phase: 'return', firstCombat: true, lastRewards: contract.result.rewards };
    advanced = true;
  } else if (event === 'contract_claimed' && t.phase === 'return' && !contract
    && player.contractBoard?.completedOfferIds?.includes('offer_tutorial_distress')) {
    t = { ...t, phase: 'recruit', slot3Unlocked: true };
    crewSlots = Math.max(crewSlots, 3);
    advanced = true;
  } else if (event === 'recruited' && t.phase === 'recruit'
    && t.hiredThird && player.crew?.some((member) => member.templateId === TUTORIAL_RECRUIT_ID)) {
    t = { ...t, phase: 'choose' };
    crewSlots = Math.max(crewSlots, 3);
    story = { ...story, chapter: Math.max(story?.chapter || 0, 1) };
    advanced = true;
  } else if (event === 'contract_accepted' && t.phase === 'choose'
    && contract && contract.profile !== 'distress' && contract.stage === 'briefing') {
    t = { ...t, phase: 'away' };
    advanced = true;
  } else if (event === 'expedition_start' && t.phase === 'away'
    && committedAway && expedition.payload.planetId === 'dustfall') {
    t = { ...t, phase: 'done', completed: true, firstExpedition: true, slot4Unlocked: true, ordersBeat: 'done' };
    crewSlots = Math.max(crewSlots, 4);
    story = { ...story, chapter: Math.max(story?.chapter || 0, 1) };
    advanced = true;
  }

  return { player: { ...player, story, tutorial: t, crewSlots }, advanced };
}

/** Compatibility for old UI handlers: only committed events advance v3. */
export function advanceTutorial(player) {
  return player;
}

export function dismissTutorial(player) {
  if (!player.tutorial?.completed) return player;
  return { ...player, tutorial: { ...player.tutorial, dismissed: true, phase: 'done' } };
}

export function completeTutorial(player, { registered = false } = {}) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  const story = { ...(player.story || {}) };
  if ((story.chapter || 0) < 1) story.chapter = 1;
  return {
    ...player,
    story,
    tutorial: {
      ...t,
      completed: true,
      phase: 'done',
      jestPrompted: true,
      registered,
      ordersBeat: t.ordersBeat || 'exp',
    },
    crewSlots: Math.max(player.crewSlots || 0, 3),
  };
}

export function grantTutorialRecruit(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  if (t.hiredThird) {
    return { player, instance: t.recruit };
  }
  if (!isTutorialActive(player) || t.phase !== 'recruit') {
    return { player, instance: null };
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
    tutorial: { ...t, jestPrompted: true },
  };
}

/** Soft 7-day goals for test week — hidden until the intro is done */
export function weekGoals(player) {
  const s = player.stats || {};
  const day = 1 + Math.floor((Date.now() - (player.createdAt || Date.now())) / 86400000);
  return {
    careerDay: day,
    goals: [
      {
        id: 'jumps_5',
        label: '5 jumps',
        done: (s.jumps || 0) >= 5,
        progress: `${s.jumps || 0}/5`,
      },
      {
        id: 'combat_3',
        label: 'Win 3 fights',
        done: (s.combatsWon || 0) >= 3,
        progress: `${s.combatsWon || 0}/3`,
      },
      {
        id: 'exp_2',
        label: '2 expeditions',
        done: (s.expeditions || 0) >= 2,
        progress: `${s.expeditions || 0}/2`,
      },
      {
        id: 'crew_4',
        label: '4 crew',
        done: player.crew.length >= Math.min(4, player.crewSlots),
        progress: `${player.crew.length}/${Math.min(4, player.crewSlots)}`,
      },
    ],
  };
}

export function skipOrders(player) {
  const t = { ...defaultTutorial(), ...(player.tutorial || {}) };
  return { ...player, tutorial: { ...t, ordersBeat: 'done' } };
}

/** Post-intro coach (expedition then hire). Null when the day loop is taught. */
export function ordersStep(player) {
  return null;
}

/** Compact home chip after the day-loop lesson. */
export function sessionHint(player, { fuel, now = Date.now() } = {}) {
  return null;
}
