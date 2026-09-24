// Session orchestration: pure transitions, followed by one durable publication boundary.
import { ensureContractBoard, generateContractBoard, tutorialDistressOffer, reviewContractOffer, contractRewardBand, acceptContract, previewContractAction, commitContractAction, claimContractReward, abandonContract } from './contracts.js';
import { ensureDailyLoop, markDailyMilestone, dailyPlan } from './dailyLoop.js';
import { isTutorialActive, isFeatureUnlocked, noteTutorialEvent, grantTutorialRecruit } from './tutorial.js';
import { advanceTutorialV4, nameShip, grantWelcomePull } from './tutorialV4.js';
import { advanceTutorialV5 } from './tutorialV5.js';
import { listCombatOrders, previewCombatOrder, encounterById } from './combat.js';
import { readyCrew } from './player.js';
import { assignStation, stationOutputs } from './stations.js';
import { applyEncounterAction, recoverEncounter } from './encounterState.js';
import { previewTravel, commitTravel } from './travel.js';
import { expeditionCrewOptions, recommendedExpeditionCrewIds, validateExpeditionParty, previewExpedition, expeditionPartySize, visiblePlanets, startExpedition } from './expedition.js';
import { nextUpgradeCost, upgradeSystem } from './hangar.js';
import { levelCrew, rankUpCrew } from './gacha.js';
import { medalLevelCostFor } from '../data/crewRoster.js';
import { ROOMS } from '../data/starterShip.js';
import { portraitFor } from '../data/portraits.js';
import { NODES } from '../data/sectors.js';
import { canAfford, formatReward } from './economy.js';

export function prepareSession(player, now = Date.now()) {
  let next = ensureDailyLoop(player, now);
  const early = isTutorialActive(next) && ([4, 5].includes(next.tutorial.script)
    || ['distress', 'launch', 'order', 'return', 'recruit'].includes(next.tutorial.phase));
  if (early && !next.contractBoard && !next.activeContract) {
    next = { ...next, contractBoard: { dayKey: next.dailyLoop.dayKey, offers: [tutorialDistressOffer(next)], completedOfferIds: [] } };
  } else if (!early && !next.activeContract && next.contractBoard?.offers.some(x => x.profile === 'distress')) {
    next = { ...next, contractBoard: generateContractBoard(next, now) };
  } else if (!early) next = ensureContractBoard(next, now).player;
  return next;
}

const event = (name, fields) => ({ event: name, fields });
const fromAnalytics = ({ event: name, ...fields }) => event(name, fields);
const elapsed = (started, now) => Math.max(0, Math.floor((now - (started || now)) / 1000));
const traitMatch = (player, trait) => trait?.kind === 'role'
  ? readyCrew(player).some(c => c.role === trait.id) : (player.ship?.systems?.[trait?.id] || 0) > 0;
const validIdentity = (contract, data) => contract && data.revision != null
  && String(contract.revision) === String(data.revision) && contract.acceptanceId === data.acceptanceId;

export function improvementFocus(player) {
  const base = { tab: 'ship', selectedRoom: null, selectedCrewId: null };
  if ((player.ship?.hull ?? 100) < 70) return { ...base, selectedRoom: 'engineering' };
  for (const room of ROOMS) {
    const cost = room.system && nextUpgradeCost(player, room.system);
    if (cost && canAfford(player.wallet, { credits: cost.credits })) return { ...base, selectedRoom: room.id };
  }
  const crew = player.crew.find(c => canAfford(player.wallet, { medals: medalLevelCostFor(c) }));
  if (crew) return { ...base, tab: 'crew', selectedCrewId: crew.instanceId };
  return { ...base, tab: 'missions', missionView: 'away' };
}

function orderDisplay(id, preview, encounter, guaranteed) {
  return {
    id, name: id[0].toUpperCase() + id.slice(1), enabled: Boolean(preview.ok ?? preview.enabled),
    chance: preview.consequence?.chance ?? preview.chance,
    chanceLabel: guaranteed ? 'Guaranteed' : `${Math.round((preview.consequence?.chance ?? preview.chance ?? 0) * 100)}%`,
    costLabel: `${preview.cost?.fuel ?? preview.fuel ?? 0}F extra`,
    rewardLabel: id === 'board' ? 'Victory: +25% credits and medals' : 'Normal payout',
    consequence: id === 'brace' ? 'Failure: half hull loss · no crew injury' : id === 'board' ? '−10% effective power · failure injures one crew member' : '+12 effective power · normal failure hull loss and injury',
    reason: preview.reason || '', recommended: id === encounter.tell.recommendedOrder,
  };
}

function combatModel(encounter, orders, guaranteed, extra = {}) {
  return { title: encounter.name, guaranteed, orders, canCancel: !guaranteed,
    tell: encounter.tell, ...extra };
}

export function sessionModels(player, ui = {}, now = Date.now()) {
  const contract = player.activeContract;
  const stations = stationOutputs(player, now);
  const models = { missionView: ui.missionView || 'contracts', dailyPlan: dailyPlan(player, now),
    contractBoard: player.contractBoard ? { ...player.contractBoard, offers: player.contractBoard.offers.map(offer => {
      const rewardBand = contractRewardBand(player, offer, { now });
      return { ...offer, rewardBand, primaryReward: rewardBand.label, enabled: rewardBand.available && !player.contractBoard.completedOfferIds.includes(offer.id) };
    }) } : null, activeContractView: null, combatOrders: null, contractReview: null, awayPicker: null, contractPreviews: {} };
  if (ui.reviewedOfferId) {
    const review = reviewContractOffer(player, ui.reviewedOfferId);
    if (review.ok) {
      const rewardBand = contractRewardBand(player, review.offer, { now });
      models.contractReview = { ...review, rewardBand, destinationName: NODES[review.offer.destinationId]?.name,
        enabled: rewardBand.available && !contract && !player.contractBoard.completedOfferIds.includes(review.offer.id) };
    }
  }
  if (contract) {
    const labels = { launch: 'Launch', secure: 'Secure the contract', push: 'Push the signal' };
    const ids = contract.stage === 'briefing' ? ['launch'] : contract.stage === 'choice' ? ['secure', 'push'] : [];
    const actions = ids.map(id => {
      const preview = previewContractAction(player, { id }, now);
      models.contractPreviews[id] = preview;
      const consequence = preview.consequence;
      const combatChoice = consequence?.encounterName
        ? `${consequence.encounterName} · power ${consequence.encounterPower} · victory ${formatReward(consequence.encounterRewards)}. ${consequence.sameEncounter ? 'Same encounter and payout on both paths.' : contract.profile === 'risky' ? id === 'secure' ? 'Lower-power confrontation.' : 'Higher-power confrontation.' : 'Combat confrontation.'}` : null;
      return { id, label: `${labels[id]} · ${preview.cost.fuel}F`, enabled: preview.ok, primary: id !== 'push', reason: preview.reason,
        consequence: combatChoice || (id === 'secure' ? 'Resolve the secured route outcome.' : id === 'push' ? 'Follow the signal to its snapshotted discovery.' : 'Spend fuel and depart.') };
    });
    if (contract.stage === 'return') actions.push({ id: 'claim', label: 'Bring it aboard', enabled: true, primary: true });
    models.activeContractView = { ...contract, actions,
      crewLabel: readyCrew(player, now).map(c => c.name).join(', ') || 'No ready crew',
      result: contract.result ? { ...contract.result, rewardLabel: formatReward(contract.result.rewards) } : null,
      abandon: contract.profile === 'distress' || player.activeEncounter ? null : { enabled: true, label: contract.stage === 'briefing' ? 'Abandon' : 'Break contract', consequence: 'No pending reward. Spent fuel is not refunded.' },
    };
    if (player.activeEncounter) {
      const encounter = player.activeEncounter;
      const options = encounter.orderWindow?.orderOptions || {};
      models.activeContractView.encounter = {
        acceptanceId: encounter.acceptanceId,
        revision: encounter.revision,
        beat: encounter.beat,
        kind: encounter.kind,
        braceUsed: encounter.orders.brace.used,
        result: encounter.result,
        lossReason: encounter.lossReason,
        hull: encounter.hull,
        shield: encounter.shield,
        systems: encounter.systems,
        enemyHull: encounter.enemy.hull,
        target: encounter.orderWindow?.target || encounter.enemy.target,
        beatsToImpact: encounter.orderWindow?.beatsToImpact
          || (encounter.beat > 0 && encounter.enemy.pattern === 'charging_volley' ? 3 - (encounter.beat % 3) : null),
        outputs: encounter.outputs,
        orders: Object.entries(options).map(([id, option]) => ({ id, cost: option.cost.shield,
          available: option.available, reason: option.reason, cooldownBeats: option.cooldownBeats,
          effectLabel: id === 'brace' ? 'Blocks the next hit' : 'Restore up to 8 hull',
          cooldownLabel: id === 'brace' && encounter.kind === 'guided' ? 'Once this fight'
            : `${id === 'brace' ? 3 : 4}-beat cooldown` })),
      };
    } else if (contract.stage === 'confrontation') {
      const encounter = encounterById(contract.encounterId);
      const guaranteed = contract.profile === 'distress';
      const orders = listCombatOrders({ tutorial: guaranteed }).map(({ id, extraFuel }) => {
        const preview = previewContractAction(player, { id: 'order', orderId: id }, now);
        models.contractPreviews[`order:${id}`] = preview;
        // Keep consequence facts visible even when the wallet cannot pay. The
        // actual cached preview remains disabled and is the only commit token.
        const facts = !preview.ok && preview.reason === 'not_enough_fuel'
          ? { ...previewContractAction({ ...player, wallet: { ...player.wallet, fuel: extraFuel } }, { id: 'order', orderId: id }, now), ok: false, reason: preview.reason }
          : preview;
        return orderDisplay(id, facts, encounter, guaranteed);
      });
      models.activeContractView.combat = combatModel(encounter, orders, guaranteed, { legacy: true, action: 'contract-order', revision: contract.revision, acceptanceId: contract.acceptanceId, stationOutputs: stations });
    }
  }
  if (ui.pendingCombat) {
    const preview = ui.pendingCombat;
    const orders = listCombatOrders().map(({ id }) => orderDisplay(id, previewCombatOrder({
      playerPower: preview.playerPower, enemyPower: preview.encounter.power, orderId: id,
      fuel: player.wallet.fuel - preview.fuelCost, tutorial: preview.tutorialFight,
    }), preview.encounter, preview.tutorialFight));
    models.combatOrders = combatModel(preview.encounter, orders, preview.tutorialFight, { stationOutputs: stations });
  }
  if (ui.selectedExpeditionId) {
    const id = ui.selectedExpeditionId;
    const planet = visiblePlanets(player, now).find(p => p.id === id);
    if (planet) {
      const selectedIds = ui.selectedExpeditionCrewIds || [];
      const validation = validateExpeditionParty(player, id, selectedIds, now);
      // Never pass a missing/invalid selection to the legacy recommendation fallback.
      const preview = validation.ok ? previewExpedition(player, id, selectedIds, now) : null;
      const options = expeditionCrewOptions(player, id, now).map(crew => ({ ...crew, portrait: portraitFor(crew.templateId, crew.role) }));
      models.awayPicker = { destination: planet, cap: expeditionPartySize(player), selectedIds, options,
        chance: preview?.chance, chanceLabel: preview ? `${Math.round(preview.chance * 100)}%` : 'Select ready crew',
        successReward: preview ? formatReward(preview.win) : 'Select crew to preview',
        failureReward: preview ? formatReward(preview.fail) : 'Select crew to preview',
        injuryRisk: 'Failure injures the away team.', returnLabel: new Date(now + planet.minutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        opportunityCost: `${preview?.crew.map(c => c.name).join(', ') || 'Selected crew'} unavailable for contracts until return.`,
        enabled: validation.ok && !player.activeExpedition && isFeatureUnlocked(player, 'expeditions'), reason: validation.reason };
    }
  }
  return models;
}

export function sessionAction(player, ui, act, data = {}, { now = Date.now(), rng = Math.random } = {}) {
  const before = player;
  const events = [];
  const nextUi = {};
  let effect = null;
  const fail = reason => ({ ok: false, reason, player: before });
  const v4 = player.tutorial?.script === 4 && !player.tutorial.completed;
  const v5 = player.tutorial?.script === 5 && !player.tutorial.completed;
  const phase = player.tutorial?.phase;
  if (v4 && phase === 'register' && act === 'tutorial-register-start') return null;
  const tutorial = (name, payload) => {
    if (v4 || v5) {
      const v4Event = { combat_order_done: 'guided_win', contract_claimed: 'reward_claimed' }[name];
      if (v4Event) player = v4 ? advanceTutorialV4(player, v4Event) : advanceTutorialV5(player, v4Event);
    } else player = noteTutorialEvent(player, name, payload).player;
  };
  if (v4) {
    const permitted = {
      board: ['splash-dismiss'], station: ['station-assign'],
      fight: player.activeEncounter ? ['encounter-order', 'encounter-advance'] : ['tutorial-fight-start'],
      claim: ['contract-claim'], name: ['tutorial-name'], pull: ['tutorial-welcome-pull'],
      register: ['tutorial-register-skip', 'tutorial-register-complete'],
    };
    if (!permitted[phase]?.includes(act)) return fail('tutorial_action_locked');
    if (phase === 'station' && (act !== 'station-assign' || data.id !== player.crew.find(c => c.templateId === 'merc_bolt')?.instanceId || data.station !== 'shields')) {
      return fail('tutorial_station_required');
    }
    if (phase === 'fight' && player.activeEncounter?.kind === 'guided' && player.activeEncounter.orderWindow
      && !player.activeEncounter.orders.brace.used && act !== 'encounter-order') return fail('brace_required');
    if (phase === 'fight' && act === 'encounter-order' && data.order !== 'brace') return fail('brace_required');
  }
  if (v5) {
    const permitted = {
      board: ['splash-dismiss'], captain: ['captain-choose'], hire: ['tutorial-first-hire'],
      assign: ['station-assign'],
      fight: player.activeEncounter ? ['encounter-order', 'encounter-advance'] : ['tutorial-fight-start'],
      claim: ['contract-claim'], name_ship: ['tutorial-name'], pull: ['tutorial-welcome-pull'],
      register: ['tutorial-register-skip', 'tutorial-register-complete'],
    };
    if (!permitted[phase]?.includes(act)) return fail('tutorial_action_locked');
    // Task 4 wires these committed actions. Until then, never acknowledge an
    // allowlisted action without applying its player transition.
    if (act === 'captain-choose' || act === 'tutorial-first-hire') return fail('tutorial_action_unavailable');
    if (phase === 'assign' && (data.id !== player.tutorial.firstHireInstanceId
      || data.station !== (player.crew.find(c => c.instanceId === data.id)?.templateId === 'merc_bolt' ? 'shields' : 'weapons'))) {
      return fail('tutorial_station_required');
    }
    if (phase === 'fight' && player.activeEncounter?.kind === 'guided' && player.activeEncounter.orderWindow
      && !player.activeEncounter.orders.brace.used && act !== 'encounter-order') return fail('brace_required');
    if (phase === 'fight' && act === 'encounter-order' && data.order !== 'brace') return fail('brace_required');
  }
  const milestone = name => {
    const prior = ensureDailyLoop(before, now).dailyLoop[name] === true;
    player = markDailyMilestone(player, name, now);
    if (!prior) events.push(event('daily_plan_progress', { day: player.dailyLoop.dayKey, milestone: name, completedCount: dailyPlan(player, now).completed }));
  };
  const boardSeen = () => {
    const board = player.contractBoard;
    if (!player.activeContract && board?.offers.length === 3) events.push(event('contract_board_seen', { boardDay: board.dayKey, destinationIds: board.offers.map(x => x.destinationId), completedCount: board.offers.filter(x => board.completedOfferIds.includes(x.id)).length }));
  };
  if (act === 'splash-dismiss') {
    player = { ...player, flags: { ...player.flags, splashSeen: true } };
    if (v4) player = advanceTutorialV4(player, 'board_ship');
    if (v5) player = advanceTutorialV5(player, 'board_ship');
  } else if (act === 'tutorial-fight-start') {
    if (!v4 || phase !== 'fight' || player.activeContract || player.activeEncounter) return fail('guided_encounter_unavailable');
    const ready = prepareSession(player, now);
    const accepted = acceptContract(ready, 'offer_tutorial_distress', now);
    if (!accepted.ok) return fail(accepted.reason);
    const preview = previewContractAction(accepted.player, { id: 'launch' }, now);
    if (!preview.ok) return fail(preview.reason);
    const launched = commitContractAction(accepted.player, preview, { rng, now });
    if (!launched.ok || !launched.player.activeEncounter) return fail(launched.reason || 'guided_encounter_unavailable');
    const first = applyEncounterAction(launched.player, {
      acceptanceId: launched.player.activeEncounter.acceptanceId,
      revision: launched.player.activeEncounter.revision,
    }, now);
    if (!first.ok) return fail(first.reason);
    player = first.player;
    events.push(fromAnalytics(accepted.analytics), fromAnalytics(launched.analytics), fromAnalytics(first.analytics));
    Object.assign(nextUi, { tab: 'ship', selectedRoom: null, reviewedOfferId: null });
    effect = { kind: 'encounter-beat', events: first.events, outcome: null };
  } else if (act === 'tutorial-name') {
    if (!v4 || phase !== 'name') return fail('ship_name_unavailable');
    try { player = nameShip(player, data.name ?? ''); }
    catch (error) { return fail(error instanceof RangeError ? 'invalid_ship_name' : 'ship_name_unavailable'); }
    if (player === before) return fail('ship_name_unavailable');
  } else if (act === 'tutorial-welcome-pull') {
    if (!v4 || phase !== 'pull') return fail('welcome_unavailable');
    const result = grantWelcomePull(player, { rng });
    if (!result.ok) return fail(result.reason);
    player = result.player;
    effect = { kind: 'crew-arrival', crewInstanceId: result.instance.instanceId };
    events.push(event('gacha_pull', { rarity: 'uncommon', free: true, gems: false, kind: result.kind, source: 'welcome' }));
  } else if (act === 'tutorial-register-skip' || act === 'tutorial-register-complete') {
    if (!v4 || phase !== 'register') return fail('registration_unavailable');
    if (act === 'tutorial-register-complete' && data.registered !== true) return fail('registration_unconfirmed');
    player = advanceTutorialV4(player, act === 'tutorial-register-skip' ? 'registration_skipped' : 'registration_completed');
    if (player === before) return fail('registration_unavailable');
    if (act === 'tutorial-register-complete') player = { ...player, _jestRegistered: true,
      captainName: data.username || player.captainName };
    player = prepareSession(player, now);
    Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
  } else if (act === 'mission-view' || act === 'goto-contracts' || act === 'goto-away' || act === 'goto-missions') {
    const view = act === 'mission-view' ? data.view : act === 'goto-away' ? 'away' : 'contracts';
    if (!['contracts', 'away', 'explore'].includes(view)) return fail('unknown_mission_view');
    if (isTutorialActive(player) && view === 'explore') return fail('tutorial_contract_required');
    player = prepareSession(player, now);
    Object.assign(nextUi, { tab: 'missions', missionView: view, selectedRoom: null });
    if (view === 'contracts') boardSeen();
  } else if (act === 'daily-improve') {
    Object.assign(nextUi, improvementFocus(player));
  } else if (act === 'contract-review') {
    const review = reviewContractOffer(player, data.offer);
    if (!review.ok || player.activeContract || player.contractBoard.completedOfferIds.includes(data.offer)) return fail(review.reason || 'offer_unavailable');
    nextUi.reviewedOfferId = data.offer;
    events.push(event('contract_reviewed', { offerId: data.offer, profile: review.offer.profile, destination: review.offer.destinationId, fuel: review.cost.fuel, traitMatch: traitMatch(player, review.favoredTrait) }));
    tutorial('contract_reviewed', { offerId: data.offer });
  } else if (act === 'contract-review-close') nextUi.reviewedOfferId = null;
  else if (act === 'contract-accept') {
    const review = reviewContractOffer(player, data.offer);
    if (review.ok && !contractRewardBand(player, review.offer, { now }).available) return fail('reward_unavailable');
    const res = acceptContract(player, data.offer, now);
    if (!res.ok) return res;
    player = res.player;
    events.push(fromAnalytics({ ...res.analytics, traitMatch: traitMatch(player, player.activeContract.favoredTrait) }));
    tutorial('contract_accepted');
    Object.assign(nextUi, { reviewedOfferId: null, tab: 'missions', selectedRoom: null, missionView: player.tutorial.phase === 'away' ? 'away' : 'contracts' });
  } else if (['encounter-advance', 'encounter-order', 'encounter-recover'].includes(act)) {
    const result = act === 'encounter-recover'
      ? recoverEncounter(player, data)
      : applyEncounterAction(player, { acceptanceId: data.acceptanceId, revision: data.revision,
        order: act === 'encounter-order' ? data.order : null }, now);
    if (!result.ok) return result;
    player = result.player;
    events.push(fromAnalytics(result.analytics));
    if (act === 'encounter-recover') {
      Object.assign(nextUi, { tab: 'ship', selectedRoom: 'engineering' });
    } else {
      for (const beatEvent of result.events) events.push(event('encounter_event', { acceptanceId: data.acceptanceId, beat: player.activeEncounter.beat, ...beatEvent }));
      if (player.activeEncounter.result === 'win') {
        tutorial('combat_order_done');
        events.push(event('contract_resolved', { profile: player.activeContract.profile, success: true, beats: player.activeEncounter.beat,
          order: data.order || null, ...player.activeContract.result.rewards, hullLoss: player.activeContract.result.hullLoss, injury: null }));
        Object.assign(nextUi, { tab: 'ship', selectedRoom: 'cargo' });
      }
      effect = { kind: 'encounter-beat', events: result.events, outcome: player.activeEncounter.result };
    }
  } else if (['contract-action', 'contract-order', 'contract-claim', 'contract-abandon', 'contract-abandon-confirm'].includes(act)) {
    const contract = player.activeContract;
    if (!validIdentity(contract, data)) return fail('stale_contract_action');
    if (act === 'contract-abandon' && contract.stage !== 'briefing') {
      if (contract.profile === 'distress') return fail('tutorial_contract_required');
      nextUi.confirmAbandon = { revision: contract.revision, acceptanceId: contract.acceptanceId };
    } else if (act.startsWith('contract-abandon')) {
      if (act === 'contract-abandon-confirm' && !validIdentity(contract, ui.confirmAbandon || {})) return fail('stale_contract_action');
      const res = abandonContract(player, { revision: Number(data.revision), acceptanceId: data.acceptanceId });
      if (!res.ok) return res;
      player = res.player;
      events.push(fromAnalytics(res.analytics));
      Object.assign(nextUi, { tab: 'ship', selectedRoom: null, confirmAbandon: null });
    } else if (act === 'contract-claim' || data.action === 'claim') {
      const res = claimContractReward(player, now);
      if (!res.ok) return res;
      player = { ...res.player, dailyLoop: ensureDailyLoop(before, now).dailyLoop };
      milestone('contract');
      events.push(fromAnalytics(res.analytics));
      tutorial('contract_claimed');
      if (v4 && player.tutorial.phase === 'name') {
        player = { ...player, crewSlots: Math.max(3, player.crewSlots || 2),
          flags: { ...player.flags, berth3Opened: true } };
      }
      Object.assign(nextUi, improvementFocus(player));
    } else {
      const action = act === 'contract-order' ? { id: 'order', orderId: data.order } : { id: data.action };
      const key = action.id === 'order' ? `order:${action.orderId}` : action.id;
      const preview = ui.contractPreviews?.[key] || previewContractAction(player, action, now);
      const res = commitContractAction(player, preview, { rng, now });
      if (!res.ok) return res;
      player = res.player;
      events.push(fromAnalytics(res.analytics));
      if (!before.activeEncounter && player.activeEncounter) Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
      if (act === 'contract-order') {
        const recommendedOrder = encounterById(contract.encounterId).tell.recommendedOrder;
        events.push(event('combat_order_selected', { encounter: contract.encounterId, order: data.order, shownChance: preview.consequence.chance, extraFuel: preview.cost.fuel, recommendedOrder, followedRecommendation: data.order === recommendedOrder }));
        tutorial('combat_order_done');
        effect = { kind: 'combat', preview: { encounter: encounterById(contract.encounterId) }, win: res.result.success };
      } else if (action.id === 'launch') {
        tutorial('contract_launched');
        effect = { kind: 'launch' };
        Object.assign(nextUi, { tab: 'ship', missionView: 'contracts', selectedRoom: null });
      }
      if (player.activeContract.stage === 'return') {
        const result = player.activeContract.result;
        events.push(event('contract_resolved', { profile: contract.profile, success: result.success, beats: player.activeContract.revision, order: player.activeContract.orderId, ...result.rewards, hullLoss: result.hullLoss, injury: result.injuredCrewId }));
        Object.assign(nextUi, { tab: 'ship', selectedRoom: 'cargo' });
      }
    }
  } else if (act === 'contract-abandon-cancel') nextUi.confirmAbandon = null;
  else if (act === 'exp-choose') {
    if (!isFeatureUnlocked(player, 'expeditions')) return fail('expeditions_locked');
    if (!visiblePlanets(player, now).some(p => p.id === data.planet) || (isTutorialActive(player) && data.planet !== 'dustfall')) return fail('unknown_planet');
    if (player.activeExpedition) return fail('expedition_active');
    Object.assign(nextUi, { selectedExpeditionId: data.planet, selectedExpeditionCrewIds: recommendedExpeditionCrewIds(player, data.planet, now) });
  } else if (act === 'exp-crew-toggle') {
    const id = ui.selectedExpeditionId;
    if (!id || !expeditionCrewOptions(player, id, now).some(c => c.id === data.id)) return fail('unavailable_crew');
    const selected = ui.selectedExpeditionCrewIds || [];
    const ids = selected.includes(data.id) ? selected.filter(x => x !== data.id) : [...selected, data.id];
    if (ids.length > expeditionPartySize(player)) return fail('party_cap');
    nextUi.selectedExpeditionCrewIds = ids;
    const valid = validateExpeditionParty(player, id, ids, now);
    const preview = valid.ok ? previewExpedition(player, id, ids, now) : null;
    events.push(event('expedition_party_changed', { destination: id, partySize: ids.length, roleMatch: Boolean(preview?.roleHit), shownChance: preview?.chance ?? null }));
  } else if (act === 'exp-picker-close') {
    Object.assign(nextUi, { selectedExpeditionId: null, selectedExpeditionCrewIds: [] });
  } else if (act === 'exp-start' || act === 'exp-launch') {
    if (!isFeatureUnlocked(player, 'expeditions')) return fail('expeditions_locked');
    if (player.activeExpedition) return fail('expedition_active');
    if (data.planet !== ui.selectedExpeditionId || !visiblePlanets(player, now).some(p => p.id === data.planet)
      || (isTutorialActive(player) && data.planet !== 'dustfall')) return fail('unknown_planet');
    const ids = ui.selectedExpeditionCrewIds || [];
    const valid = validateExpeditionParty(player, data.planet, ids, now);
    if (!valid.ok) return fail(valid.reason);
    const preview = previewExpedition(player, data.planet, ids, now);
    const job = startExpedition({ planetId: data.planet, crewInstanceIds: ids, minutes: preview.planet.minutes, successChance: preview.chance, roleHit: preview.roleHit, startedAt: now });
    player = { ...player, activeExpedition: job, crew: player.crew.map(c => ids.includes(c.instanceId) ? { ...c, status: 'expedition' } : c) };
    tutorial('expedition_start');
    milestone('away');
    events.push(event('expedition_start', { planet: data.planet }));
    Object.assign(nextUi, { selectedExpeditionId: null, selectedExpeditionCrewIds: [], tab: 'ship', selectedRoom: null });
    effect = { kind: 'expedition', crewInstanceIds: [...ids] };
  } else if (act === 'tutorial-draw') {
    const res = grantTutorialRecruit(player, { rng });
    if (!res.instance || res.player === player) return fail('recruit_unavailable');
    player = res.player;
    tutorial('recruited');
    Object.assign(nextUi, { tab: 'ship', missionView: 'contracts', selectedRoom: null });
    effect = { kind: 'crew-arrival', crewInstanceId: res.instance.instanceId };
    player = prepareSession(player, now);
  } else if (act === 'station-assign') {
    const res = assignStation(player, data.id, data.station === '' ? null : data.station, now);
    if (!res.ok) return fail(res.reason);
    player = res.player;
    if (v4) player = advanceTutorialV4(player, 'station_assigned');
    if (v5) player = advanceTutorialV5(player, 'station_assigned');
  } else if (['ship-upgrade', 'level-crew', 'rank-up'].includes(act)) {
    if (isTutorialActive(player)) return fail('improvements_locked');
    const res = act === 'ship-upgrade' ? upgradeSystem(player, data.system) : act === 'level-crew' ? levelCrew(player, data.id) : rankUpCrew(player, data.id);
    if (!res.ok) return res;
    player = res.player;
    milestone('improve');
    if (act === 'ship-upgrade') events.push(event('ship_upgrade', { system: data.system }));
  } else if (act === 'travel-to') {
    if (player.activeContract) return fail('active_contract');
    if (isTutorialActive(player)) return fail('tutorial_contract_required');
    if (ui.pendingCombat) return fail('combat_pending');
    const preview = previewTravel(player, data.node, { rng });
    if (!preview.ok) return fail(preview.reason);
    if (preview.needsAssists) nextUi.pendingCombat = preview;
    else {
      const res = commitTravel(player, preview, { rng });
      if (!res.ok) return res;
      player = res.player;
      tutorial('travel_success');
      events.push(event('travel', { node: data.node, kind: res.result.kind }));
      effect = { kind: 'travel', result: res.result };
    }
  } else if (act === 'combat-order') {
    if (!ui.pendingCombat || player.activeContract) return fail('no_pending_combat');
    const preview = ui.pendingCombat;
    const shown = sessionModels(player, ui, now).combatOrders.orders.find(x => x.id === data.order);
    if (!shown?.enabled) return fail('order_unavailable');
    const res = commitTravel(player, preview, { orderId: data.order, rng });
    if (!res.ok) return res;
    player = res.player;
    tutorial('travel_success');
    Object.assign(nextUi, { pendingCombat: null, tab: 'ship', selectedRoom: null });
    const recommendedOrder = preview.encounter.tell.recommendedOrder;
    events.push(event('combat_order_selected', { encounter: preview.encounter.id, order: data.order, shownChance: shown.chance, extraFuel: data.order === 'burn' ? 1 : 0, recommendedOrder, followedRecommendation: data.order === recommendedOrder }));
    events.push(event('combat', { success: res.result.combat.success, encounter: preview.encounter.id }));
    effect = { kind: 'combat', preview, win: res.result.combat.success, result: res.result };
  } else if (act === 'combat-cancel') {
    if (ui.pendingCombat?.tutorialFight) return fail('tutorial_contract_required');
    nextUi.pendingCombat = null;
  } else return null;
  if (before.tutorial?.phase !== player.tutorial?.phase) events.push(event('tutorial_stage', { script: player.tutorial.script, phase: player.tutorial.phase, elapsedSeconds: elapsed(player.createdAt, now) }));
  return { ok: true, player, ui: nextUi, events, effect };
}

export function persistSessionTransition(result, { save, publish, capture, animate }) {
  if (!result?.ok) return result;
  // writeSave returns false on quota/security failure. Never publish an uncommitted result.
  let saved = false;
  try { saved = save(result.player) === true; } catch { /* leave the live session unchanged */ }
  if (!saved) return { ok: false, reason: 'save_failed' };
  publish(result);
  for (const item of result.events) capture?.(item.event, item.fields);
  if (result.effect) animate?.(result.effect);
  return result;
}
