import { createCrewInstance } from '../data/crewRoster.js';
import { defaultTutorialV4, grantWelcomePull, nameShip } from './tutorialV4.js';

const PHASES = new Set(['board', 'captain', 'hire', 'assign', 'fight', 'claim', 'name_ship', 'pull', 'register', 'done']);

export function defaultTutorialV5() {
  return {
    script: 5, phase: 'board', completed: false,
    firstHireUsed: false, firstHireInstanceId: null,
    firstWin: false, firstClaim: false, named: false,
    welcomePulled: false, welcomeInstanceId: null,
    suggestedStation: null, suggestedRole: null,
    jestPrompted: false, registered: false,
  };
}

export function normalizeTutorialV5(saved) {
  const tutorial = { ...defaultTutorialV5(), ...(saved || {}), script: 5 };
  if (!PHASES.has(tutorial.phase)) tutorial.phase = 'board';
  if (tutorial.firstHireInstanceId) tutorial.firstHireUsed = true;
  if (tutorial.completed || tutorial.phase === 'done') {
    tutorial.phase = 'done';
    tutorial.completed = true;
  }
  return tutorial;
}

export function advanceTutorialV5(player, event) {
  const current = player?.tutorial;
  if (current?.script !== 5 || current.completed) return player;
  const t = normalizeTutorialV5(current);
  let update = null;
  if (t.phase === 'board' && event === 'board_ship') update = { phase: 'captain' };
  else if (t.phase === 'captain' && event === 'captain_chosen') {
    if (player.captainInstanceId && player.crew?.some(c => c.instanceId === player.captainInstanceId && c.isCaptain)) update = { phase: 'hire' };
  } else if (t.phase === 'assign' && event === 'station_assigned') {
    const hired = player.crew?.find(c => c.instanceId === t.firstHireInstanceId);
    const required = hired?.templateId === 'merc_bolt' ? 'shields' : hired?.templateId === 'merc_jen' ? 'weapons' : null;
    if (t.firstHireUsed && required && player.stationAssignments?.[hired.instanceId] === required) update = { phase: 'fight' };
  } else if (t.phase === 'fight' && event === 'guided_win') {
    const contract = player.activeContract;
    const encounter = player.activeEncounter;
    if (t.firstHireUsed && contract?.offerId === 'offer_tutorial_distress' && contract.profile === 'distress'
      && contract.stage === 'return' && contract.result?.success === true
      && encounter?.kind === 'guided' && encounter.acceptanceId === contract.acceptanceId
      && encounter.result === 'win' && encounter.orders?.targetWeapons?.used === true) update = { phase: 'claim', firstWin: true };
  } else if (t.phase === 'claim' && event === 'reward_claimed') {
    if (t.firstWin && !player.activeContract && player.contractBoard?.completedOfferIds?.includes('offer_tutorial_distress')) {
      update = { phase: 'name_ship', firstClaim: true };
    }
  } else if (t.phase === 'register' && t.welcomePulled
    && (event === 'registration_skipped' || event === 'registration_completed')) {
    update = { phase: 'done', completed: true, jestPrompted: true, registered: event === 'registration_completed' };
  }
  return update ? { ...player, tutorial: { ...t, ...update } } : player;
}

export function hireFirstCrew(player, { rng = Math.random } = {}) {
  const t = player?.tutorial;
  if (t?.script !== 5 || t.completed || t.phase !== 'hire' || t.firstHireUsed || t.firstHireInstanceId
    || !player.captainInstanceId || player.crew?.length !== 1) {
    return { ok: false, reason: 'first_hire_unavailable', player, instance: null };
  }
  const captain = player.crew.find(c => c.instanceId === player.captainInstanceId && c.isCaptain);
  if (!captain) return { ok: false, reason: 'first_hire_unavailable', player, instance: null };
  const instance = createCrewInstance(captain.role === 'gunner' ? 'merc_bolt' : 'merc_jen', { rng });
  const next = { ...player, crew: [...player.crew, instance],
    tutorial: { ...normalizeTutorialV5(t), phase: 'assign', firstHireInstanceId: instance.instanceId, firstHireUsed: true } };
  return { ok: true, player: next, instance };
}

// Share v4's validated naming and welcome-pull/pity implementation. Only the
// temporary input changes script; the returned player keeps its script-5 state.
export function nameShipV5(player, value) {
  const t = player?.tutorial;
  if (t?.script !== 5 || t.phase !== 'name_ship' || t.completed || !t.firstWin || !t.firstClaim || t.named) return player;
  const named = nameShip({ ...player, tutorial: { ...defaultTutorialV4(), phase: 'name', firstWin: true, firstClaim: true } }, value);
  return { ...named, tutorial: { ...normalizeTutorialV5(t), phase: 'pull', named: true } };
}

export function grantWelcomePullV5(player, options = {}) {
  const t = player?.tutorial;
  if (t?.script !== 5 || t.phase !== 'pull' || t.completed || !t.firstWin || !t.firstClaim || !t.named || t.welcomePulled) {
    return { ok: false, reason: 'welcome_unavailable', player, instance: null };
  }
  const temporary = { ...player, tutorial: { ...defaultTutorialV4(), phase: 'pull', firstWin: true, firstClaim: true, named: true } };
  const result = grantWelcomePull(temporary, options);
  if (!result.ok) return { ...result, player };
  return { ...result, player: { ...result.player,
    tutorial: { ...normalizeTutorialV5(t), phase: 'register', welcomePulled: true,
      welcomeInstanceId: result.instance.instanceId,
      suggestedStation: result.player.tutorial.suggestedStation,
      suggestedRole: result.player.tutorial.suggestedRole } } };
}
