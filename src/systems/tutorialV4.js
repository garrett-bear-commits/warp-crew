import { createCrewInstance } from '../data/crewRoster.js';
import { applyPullToRoster, recordPull, tickPity } from './gacha.js';

const PHASES = new Set(['board', 'station', 'fight', 'claim', 'name', 'pull', 'register', 'done']);
const WELCOME_CREW = [
  { id: 'merc_kira', station: 'weapons', role: null },
  { id: 'merc_tink', station: 'shields', role: null },
  { id: 'merc_nemi', station: null, role: 'away' },
];
const visibleCharacters = value => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
  .filter(({ segment }) => [...segment].some(character => !/\p{Default_Ignorable_Code_Point}/u.test(character))).length;

export function defaultTutorialV4() {
  return {
    script: 4,
    phase: 'board',
    completed: false,
    firstWin: false,
    firstClaim: false,
    named: false,
    welcomePulled: false,
    welcomeInstanceId: null,
    suggestedStation: null,
    suggestedRole: null,
    jestPrompted: false,
    registered: false,
  };
}

export function normalizeTutorialV4(saved) {
  const tutorial = { ...defaultTutorialV4(), ...(saved || {}), script: 4 };
  if (!PHASES.has(tutorial.phase)) tutorial.phase = 'board';
  if (tutorial.completed || tutorial.phase === 'done') {
    tutorial.phase = 'done';
    tutorial.completed = true;
  }
  return tutorial;
}

/**
 * Committed v4 events: board_ship, station_assigned, guided_win,
 * reward_claimed, registration_skipped, registration_completed.
 * Naming and welcome pull each commit their own next phase below.
 */
export function advanceTutorialV4(player, event) {
  const current = player?.tutorial;
  if (current?.script !== 4 || current.completed) return player;
  const t = normalizeTutorialV4(current);
  let update = null;
  if (t.phase === 'board' && event === 'board_ship') {
    update = { phase: 'station' };
  } else if (t.phase === 'station' && event === 'station_assigned') {
    const bolt = (player.crew || []).find(member => member.templateId === 'merc_bolt');
    if (bolt && player.stationAssignments?.[bolt.instanceId] === 'shields') update = { phase: 'fight' };
  } else if (t.phase === 'fight' && event === 'guided_win') {
    const contract = player.activeContract;
    const encounter = player.activeEncounter;
    if (contract?.offerId === 'offer_tutorial_distress' && contract.profile === 'distress'
      && contract.stage === 'return' && contract.result?.success === true
      && encounter?.kind === 'guided' && encounter.acceptanceId === contract.acceptanceId
      && encounter.result === 'win' && encounter.orders?.brace?.used === true) {
      update = { phase: 'claim', firstWin: true };
    }
  } else if (t.phase === 'claim' && event === 'reward_claimed') {
    if (t.firstWin && !player.activeContract
      && player.contractBoard?.completedOfferIds?.includes('offer_tutorial_distress')) {
      update = { phase: 'name', firstClaim: true };
    }
  } else if (t.phase === 'register' && t.welcomePulled
    && (event === 'registration_skipped' || event === 'registration_completed')) {
    update = { phase: 'done', completed: true, jestPrompted: true, registered: event === 'registration_completed' };
  }
  return update ? { ...player, tutorial: { ...t, ...update } } : player;
}

export function nameShip(player, name) {
  const t = player?.tutorial;
  if (t?.script !== 4 || t.phase !== 'name' || t.completed || !t.firstWin || !t.firstClaim || t.named) return player;
  if (typeof name !== 'string') throw new RangeError('Ship name must be text');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new RangeError('Ship name cannot contain control characters');
  const trimmed = name.trim();
  const chosen = trimmed || (typeof player.ship?.name === 'string' && player.ship.name.trim()) || 'Sparrow';
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(chosen) || visibleCharacters(chosen) > 24 || visibleCharacters(chosen) < 1) {
    throw new RangeError('Ship name must contain 1–24 visible characters without controls');
  }
  return { ...player, ship: { ...player.ship, name: chosen },
    tutorial: { ...normalizeTutorialV4(t), named: true, phase: 'pull' } };
}

export function grantWelcomePull(player, { rng = Math.random } = {}) {
  const t = player?.tutorial;
  if (t?.script !== 4 || t.phase !== 'pull' || t.completed || !t.firstWin || !t.firstClaim || !t.named || t.welcomePulled) {
    return { ok: false, reason: 'welcome_unavailable', player, instance: null };
  }
  const roll = rng();
  const candidate = WELCOME_CREW[Math.min(2, Math.max(0, Math.floor(roll * WELCOME_CREW.length)))];
  const drawn = createCrewInstance(candidate.id, { rng });
  const applied = applyPullToRoster(player, drawn);
  const gacha = recordPull(tickPity(player.gacha, 'uncommon'), applied.instance, applied.kind, 'welcome');
  const next = { ...applied.player, gacha,
    tutorial: { ...normalizeTutorialV4(t), phase: 'register', welcomePulled: true,
      welcomeInstanceId: applied.instance.instanceId, suggestedStation: candidate.station, suggestedRole: candidate.role } };
  return { ok: true, player: next, instance: applied.instance, kind: applied.kind, sold: applied.sold };
}
