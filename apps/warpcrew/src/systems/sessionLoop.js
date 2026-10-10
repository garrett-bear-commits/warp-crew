// Session orchestration: pure transitions, followed by one durable publication boundary.
import { trustedNow } from '../shared/time.js';
import { syncCommission } from './subscription.js';
import { dockRepair } from './passives.js';
import { ensureContractBoard, generateContractBoard, tutorialDistressOffer, reviewContractOffer, contractRewardBand, acceptContract, previewContractAction, commitContractAction, claimContractReward, abandonContract } from './contracts.js';
import { ensureDailyLoop, markDailyMilestone, dailyPlan } from './dailyLoop.js';
import { isTutorialActive, isFeatureUnlocked, noteTutorialEvent, grantTutorialRecruit } from './tutorial.js';
import { advanceTutorialV4, nameShip, grantWelcomePull } from './tutorialV4.js';
import { advanceTutorialV5, hireFirstCrew, nameShipV5, grantWelcomePullV5 } from './tutorialV5.js';
import { chooseCaptain } from './captainFirstPlay.js';
import { listCombatOrders, previewCombatOrder, encounterById, crewPower } from './combat.js';
import { readyCrew } from './player.js';
import { assignStation, stationOutputs, STATIONS } from './stations.js';
import { applyEncounterAction, recoverEncounter, applyEncounterCommand, guidedTargetDone } from './encounterState.js';
import { FTL_VERSION, PLAYER_WEAPONS, weaponDef, playerChargePerBeat, enemyChargePerBeat, currentTarget, playerEvasion, enemyEvasion, playerShieldCap, enemyShieldCap, ftlTacticStatus, RULES as FTL_RULES, OVERCHARGE, enemyStartHull, kitFight, memberKit, abilityGainPerBeat } from './ftlCombat.js';
import { describeKit } from '../data/crewKits.js';
import { previewTravel, commitTravel } from './travel.js';
import { expeditionCrewOptions, recommendedExpeditionCrewIds, validateExpeditionParty, previewExpedition, expeditionPartySize, visiblePlanets, startExpedition } from './expedition.js';
import { buyWeapon, equipWeapon } from './armory.js';
import { nextUpgradeCost, upgradeSystem, completeShipBuild, skipShipBuild } from './hangar.js';
import { levelCrew, rankUpCrew, ascendCrew } from './gacha.js';
import { medalLevelCostFor } from '../data/crewRoster.js';
import { ROOMS } from '../data/starterShip.js';
import { portraitFor } from '../data/portraits.js';
import { NODES } from '../data/sectors.js';
import { canAfford, formatReward } from './economy.js';
import { beatDelayMs } from './fightPacing.js';
import { evaluateStarterOffer, evaluateWallPackOffer } from './offers.js';
import { ensureWallOffer, currentWall } from './walls.js';
import { refuelWithGems, RALLY } from './gemSinks.js';
import { tacticStatus, BURN, repelStatus } from './autoCombat.js';
import { readyContractCrew } from './contractRewards.js';
import { contractThreat, contractFightArgs, threatLabel, pickDefender } from './encounterState.js';
import { fightOdds, offerFightContract } from './fightOdds.js';
import { beginTravelFight, applyTravelFightAction, claimTravelFight, applyTravelFightCommand } from './travelFight.js';
import { arrivalOpensEvent, openTravelEvent, resolveTravelEvent, eventView, routeEventFor, routeChoiceMatches } from './travelEvents.js';
import { laneCheck, sectorMapModel } from './sectorMap.js';
import { resolveRoutePayout } from './contractRewards.js';
import { markExploreNudge, noteMapJump } from './exploreNudge.js';

export function prepareSession(player, now = trustedNow()) {
  let next = ensureDailyLoop(player, now);
  const early = isTutorialActive(next) && ([4, 5].includes(next.tutorial.script)
    || ['distress', 'launch', 'order', 'return', 'recruit'].includes(next.tutorial.phase));
  if (early && !next.contractBoard && !next.activeContract) {
    next = { ...next, contractBoard: { dayKey: next.dailyLoop.dayKey, offers: [tutorialDistressOffer(next)], completedOfferIds: [] } };
  } else if (!early && !next.activeContract && next.contractBoard?.offers.some(x => x.profile === 'distress')) {
    next = { ...next, contractBoard: generateContractBoard(next, now) };
  } else if (!early) next = ensureContractBoard(next, now).player;
  if (!early) next = ensureWallOffer(next, now);
  if (!early) next = evaluateWallPackOffer(next, currentWall(next, now), now);
  next = completeShipBuild(next, now).player;
  next = dockRepair(next, now);
  next = syncCommission(next, now);
  return evaluateStarterOffer(next, now);
}

const event = (name, fields) => ({ event: name, fields });
const fromAnalytics = ({ event: name, ...fields }) => event(name, fields);
const elapsed = (started, now) => Math.max(0, Math.floor((now - (started || now)) / 1000));
const traitMatch = (player, trait) => trait?.kind === 'role'
  ? readyCrew(player).some(c => c.role === trait.id) : (player.ship?.systems?.[trait?.id] || 0) > 0;
const validIdentity = (contract, data) => contract && data.revision != null
  && String(contract.revision) === String(data.revision) && contract.acceptanceId === data.acceptanceId;
const v5FirstHire = player => {
  const tutorial = player.tutorial;
  const captain = player.crew?.find(member => member.instanceId === player.captainInstanceId && member.isCaptain);
  const hired = player.crew?.find(member => member.instanceId === tutorial?.firstHireInstanceId);
  const templateId = captain?.role === 'gunner' ? 'merc_bolt' : 'merc_jen';
  if (!tutorial?.firstHireUsed || !captain || !hired || hired.isCaptain
    || hired.instanceId === captain.instanceId || hired.templateId !== templateId) return null;
  return { hired, station: templateId === 'merc_bolt' ? 'shields' : 'weapons' };
};

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

const pct = (value, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0);
const ENEMY_ROOM_LABELS = { weapons: 'Weapons', shields: 'Shields', engines: 'Engines', helm: 'Helm' };

/** Fight-screen model for an FTL-lite (v3) fight. */
function ftlEncounterView(player, encounter, { settled, ui = {} }) {
  const catalog = encounterById(encounter.encounterId);
  const rallyCost = player.flags?.rallyFreeUsed ? RALLY.gems : 0;
  const crewById = Object.fromEntries((player.crew || []).map(member => [member.instanceId, member]));
  const room = (rooms, id, label) => ({ id, label, integrity: Math.round(rooms[id].integrity), fire: rooms[id].fire > 0,
    offline: rooms[id].integrity <= 0, damaged: rooms[id].integrity < 50 });
  return {
    ftl: true,
    guided: encounter.guided === true,
    encounterId: encounter.encounterId,
    acceptanceId: encounter.acceptanceId,
    revision: encounter.revision,
    version: encounter.version,
    beat: encounter.beat,
    kind: encounter.kind,
    beatMs: beatDelayMs(encounter),
    result: encounter.result,
    settled,
    retryBeat: !encounter.result && ui.guidedBeatSaveFailed?.acceptanceId === encounter.acceptanceId
      && ui.guidedBeatSaveFailed?.revision === encounter.revision,
    downed: encounter.phase === 'downed' ? { enemyHull: encounter.enemy.hull, free: rallyCost === 0, rallyCost,
      canAfford: (player.wallet?.gems || 0) >= rallyCost } : null,
    lossReason: encounter.lossReason,
    enemyName: catalog.name,
    tell: catalog.tell ? { label: catalog.tell.label, text: catalog.tell.text } : null,
    threat: encounter.enemy.threat,
    threatLabel: threatLabel(encounter.enemy.threat),
    hull: encounter.hull,
    hullMax: FTL_RULES.playerHullMax,
    shields: { layers: encounter.shields.layers, max: playerShieldCap(encounter), full: encounter.shields.max,
      rechargePct: pct(encounter.shields.rechargeMs, FTL_RULES.shieldRechargeMs) },
    evasion: playerEvasion(encounter),
    rooms: Object.fromEntries(Object.keys(encounter.rooms).map(id => [id, { ...room(encounter.rooms, id, STATIONS[id]?.label || id), roomId: STATIONS[id]?.roomId || id }])),
    weapons: encounter.weapons.map(weapon => {
      const def = weaponDef(weapon.id);
      const live = !encounter.result && encounter.phase === 'combat';
      return { id: weapon.id, name: def.name, shots: def.shots, damage: def.damage, chargePct: pct(weapon.chargeMs, def.chargeMs),
        nextPct: live ? pct(Math.min(def.chargeMs, weapon.chargeMs + playerChargePerBeat(encounter)), def.chargeMs) : pct(weapon.chargeMs, def.chargeMs),
        chargeMs: weapon.chargeMs, maxMs: def.chargeMs, ready: weapon.chargeMs >= def.chargeMs, kind: def.kind,
        ...(def.kind === 'missile' ? { ammo: encounter.ammo?.missile ?? 0 } : {}) };
    }),
    hold: encounter.intent.hold,
    target: currentTarget(encounter),
    targetChosen: encounter.intent.target !== null,
    crew: encounter.crew.map(member => ({ id: member.id, name: crewById[member.id]?.name || 'Crew', role: member.role,
      portrait: crewById[member.id] ? portraitFor(crewById[member.id].templateId, crewById[member.id].role) : null,
      room: encounter.intent.moves?.[member.id] || member.room, station: member.station,
      moving: Boolean(encounter.intent.moves?.[member.id]), manual: member.manualUntil > encounter.beat,
      // The signature move: its charge now and at the next beat, and whether a tap is already queued.
      ability: memberKit(member) ? { move: memberKit(member).move, text: describeKit(memberKit(member)),
        chargePct: member.charge, ready: member.charge >= 100, queued: (encounter.intent.cast || []).includes(member.id),
        nextPct: !encounter.result && encounter.phase === 'combat' ? Math.min(100, member.charge + abilityGainPerBeat(encounter, member)) : member.charge } : null })),
    abilities: kitFight(encounter),
    auto: encounter.intent.auto === true,
    enemy: {
      hull: encounter.enemy.hull,
      hullMax: enemyStartHull(encounter),
      shields: { layers: encounter.enemy.shields.layers, max: enemyShieldCap(encounter), full: encounter.enemy.shields.max,
        rechargePct: pct(encounter.enemy.shields.rechargeMs, FTL_RULES.enemyShieldRechargeMs), ionized: (encounter.enemy.shields.ionMs || 0) > 0 },
      evasion: enemyEvasion(encounter),
      rooms: Object.fromEntries(Object.keys(encounter.enemy.rooms).map(id => [id, room(encounter.enemy.rooms, id, ENEMY_ROOM_LABELS[id])])),
      weapons: encounter.enemy.weapons.map(weapon => ({ id: weapon.id, shots: weapon.shots, damage: weapon.damage,
        chargePct: pct(weapon.progressMs, weapon.chargeMs), progressMs: weapon.progressMs, maxMs: weapon.chargeMs,
        nextPct: !encounter.result && encounter.phase === 'combat' ? pct(Math.min(weapon.chargeMs, weapon.progressMs + enemyChargePerBeat(encounter)), weapon.chargeMs) : pct(weapon.progressMs, weapon.chargeMs),
        target: weapon.target, targetLabel: STATIONS[weapon.target]?.label || weapon.target })),
    },
    boarders: encounter.boarders && encounter.boarders.phase !== 'none' ? { phase: encounter.boarders.phase, room: encounter.boarders.room,
      roomLabel: STATIONS[encounter.boarders.room]?.label || encounter.boarders.room,
      strengthPct: pct(encounter.boarders.hp, FTL_RULES.boarderHp) } : null,
    tactics: Object.keys(encounter.tactics || {}).map(id => {
      const status = ftlTacticStatus(encounter, id);
      const noFuel = id === 'burn' && (player.wallet?.fuel ?? 0) < OVERCHARGE.fuel;
      return { id, available: status.available && !noFuel, reason: noFuel && status.available ? 'not_enough_fuel' : status.reason,
        chance: status.chance ?? null, used: encounter.tactics[id].uses > 0,
        success: id === 'board' ? encounter.tactics.board.success : null,
        burning: id === 'burn' && encounter.tactics.burn.throughBeat >= encounter.beat && encounter.tactics.burn.uses > 0 };
    }),
  };
}

/** Ship-panel model for any live crew fight (contract or Explore jump). */
function encounterView(player, encounter, { settled, ui = {}, now = trustedNow() }) {
  if (encounter.version === FTL_VERSION) return ftlEncounterView(player, encounter, { settled, ui });
  const options = encounter.orderWindow?.orderOptions || {};
  return {
    acceptanceId: encounter.acceptanceId,
    revision: encounter.revision,
    version: encounter.version,
    beat: encounter.beat,
    kind: encounter.kind,
    braceUsed: encounter.orders.brace.used,
    beatMs: beatDelayMs(encounter),
    targetWeaponsUsed: encounter.orders.targetWeapons?.used === true,
    retryBeat: (encounter.kind === 'normal' || (encounter.kind === 'guided' && encounter.version === 2
      && encounter.orders.targetWeapons?.used === true)) && !encounter.result
      && ui.guidedBeatSaveFailed?.acceptanceId === encounter.acceptanceId
      && ui.guidedBeatSaveFailed?.revision === encounter.revision,
    result: encounter.result,
    settled,
    downed: encounter.phase === 'downed' ? { enemyHull: encounter.enemy.hull, free: player.flags?.rallyFreeUsed !== true,
      rallyCost: player.flags?.rallyFreeUsed ? RALLY.gems : 0, canAfford: (player.wallet?.gems || 0) >= (player.flags?.rallyFreeUsed ? RALLY.gems : 0) } : null,
    lossReason: encounter.lossReason,
    hull: encounter.hull,
    shield: encounter.shield,
    systems: encounter.systems,
    enemyHull: encounter.enemy.hull,
    ...(encounter.kind === 'normal' ? (() => {
      const catalog = encounterById(encounter.encounterId);
      return { enemyName: catalog.name, tell: catalog.tell ? { label: catalog.tell.label, text: catalog.tell.text } : null, threat: encounter.enemy.threat ?? null, threatLabel: threatLabel(encounter.enemy.threat ?? null) };
    })() : {}),
    target: encounter.orderWindow?.target || encounter.enemy.target,
    weaponDisabled: encounter.version === 2 && encounter.enemy.weaponDisabledThroughBeat > 0
      && encounter.enemy.weaponDisabledThroughBeat >= encounter.beat,
    beatsToImpact: encounter.orderWindow?.beatsToImpact
      || (encounter.beat > 0 && encounter.enemy.pattern === 'charging_volley' ? 3 - (encounter.beat % 3) : null),
    outputs: encounter.outputs,
    orders: Object.entries(options).map(([id, option]) => ({ id, cost: option.cost.shield,
      available: option.available, reason: option.reason, cooldownBeats: option.cooldownBeats,
      effectLabel: id === 'brace' ? 'Blocks the next hit' : id === 'target_weapons' ? 'Disrupt the pirate weapons' : 'Restore up to 8 hull',
      cooldownLabel: id === 'brace' && encounter.kind === 'guided' ? 'Once this fight'
        : `${id === 'brace' ? 3 : 4}-beat cooldown` })),
    boarders: encounter.boarders && encounter.boarders.phase !== 'none' ? (() => {
      const b = encounter.boarders;
      const defender = b.defenderId ? player.crew.find(member => member.instanceId === b.defenderId) : null;
      const candidate = repelStatus(encounter).available ? pickDefender(player, now) : null;
      return { phase: b.phase, target: STATIONS[b.target]?.label || b.target, strength: b.strength,
        system: encounter.systems?.[b.target] ?? null, defenderName: defender?.name || null,
        canRepel: Boolean(candidate), repelName: candidate?.name || null,
        repelCost: candidate?.station ? `${candidate.name} leaves ${STATIONS[candidate.station].label}` : candidate ? `${candidate.name} goes` : null };
    })() : null,
    tactics: Object.keys(encounter.tactics || {}).map(id => {
      const status = tacticStatus(encounter, id);
      const noFuel = id === 'burn' && (player.wallet?.fuel ?? 0) < BURN.fuel;
      return { id, available: status.available && !noFuel, reason: noFuel && status.available ? 'not_enough_fuel' : status.reason,
        chance: status.chance ?? null, used: encounter.tactics[id].uses > 0,
        success: id === 'board' ? encounter.tactics.board.success : null,
        burning: id === 'burn' && encounter.tactics.burn.throughBeat >= encounter.beat && encounter.tactics.burn.uses > 0 };
    }),
  };
}

// Reward bands simulate whole fights per offer, so they are cached: the key is the
// save minus what changes every fight beat, plus the minute (injury and day timers).
let bandCache = { key: null, bands: null };
function boardRewardBands(player, now) {
  const { activeEncounter, activeContract, fuelClaimAt, ...rest } = player;
  const key = JSON.stringify([rest, activeContract ? { ...activeContract, revision: 0 } : null, Math.floor(now / 60000)]);
  if (bandCache.key !== key) {
    bandCache = { key, bands: Object.fromEntries(player.contractBoard.offers.map(offer => [offer.id, contractRewardBand(player, offer, { now })])) };
  }
  return bandCache.bands;
}

/** Contract route event card: authored situation, two choices bound to secure/push with their real stakes. */
function routeEventModel(player, contract, previews, now) {
  const routeEvent = routeEventFor(contract);
  if (!routeEvent) return null;
  return { id: routeEvent.id, title: routeEvent.title, text: routeEvent.text, revision: contract.revision, acceptanceId: contract.acceptanceId,
    choices: routeEvent.choices.map(choice => {
      const preview = previews[choice.route] || previewContractAction(player, { id: choice.route }, now);
      const consequence = preview.consequence || {};
      let stakes;
      if (consequence.encounterId) {
        const threat = threatLabel(contractThreat(player, { encounterId: consequence.encounterId, destinationId: contract.destinationId }, now));
        stakes = `Fight: ${consequence.encounterName} · ${threat} · win ${formatReward(consequence.encounterRewards)}`;
      } else {
        const outcome = choice.route === 'secure' ? contract.secureOutcome : contract.routeOutcome;
        const payout = resolveRoutePayout(player, contract, outcome, now);
        stakes = outcome?.kind === 'story' ? `Story lead · ${formatReward(payout.rewards)}` : `Pays ${formatReward(payout.rewards) || 'nothing'}`;
      }
      return { id: choice.id, route: choice.route, label: choice.label, stakes, fuel: preview.cost?.fuel ?? 0,
        enabled: Boolean(preview.ok), reason: preview.ok ? null : preview.reason, fight: Boolean(consequence.encounterId) };
    }) };
}

/**
 * Screen models. `fightOdds`: the contract board and review carry win odds played from the real fight
 * (fightOdds.js). The game's render asks for them; the economy simulator and most tests do not, so a
 * session action never pays for eight fights per offer.
 */
export function sessionModels(player, ui = {}, now = trustedNow(), { fightOdds: withOdds = false } = {}) {
  const contract = player.activeContract;
  const stations = stationOutputs(player, now);
  // Odds only while the board can be read: no contract, fight or event under way.
  const odds = withOdds && !contract && !player.activeEncounter && !player.activeEvent;
  const models = { missionView: ui.missionView || 'contracts', dailyPlan: dailyPlan(player, now),
    contractBoard: player.contractBoard ? { ...player.contractBoard, offers: player.contractBoard.offers.map((offer, _, __, bands = boardRewardBands(player, now)) => {
      const rewardBand = bands[offer.id];
      const enabled = rewardBand.available && !player.contractBoard.completedOfferIds.includes(offer.id);
      return { ...offer, rewardBand, primaryReward: rewardBand.label, enabled, fightOdds: odds && enabled ? fightOdds(player, offer, now) : null };
    }) } : null, activeContractView: null, activeTravelView: null, combatOrders: null, contractReview: null, awayPicker: null, contractPreviews: {},
    activeEventView: eventView(player, now), eventResult: ui.eventResult || null, sectorMap: sectorMapModel(player, ui, now) };
  if (ui.reviewedOfferId) {
    const review = reviewContractOffer(player, ui.reviewedOfferId);
    if (review.ok) {
      const rewardBand = contractRewardBand(player, review.offer, { now });
      // The toughest fight any route can lead to: its threat, and the odds with the crew actually aboard now.
      const fight = offerFightContract(review.offer);
      const awayCount = (player.crew || []).filter(member => member.status === 'expedition').length;
      const fightThreat = fight ? { label: threatLabel(contractFightArgs(player, fight, now).threat), awayCount,
        odds: withOdds && !contract ? fightOdds(player, review.offer, now) : null } : null;
      models.contractReview = { ...review, rewardBand, fightThreat, destinationName: NODES[review.offer.destinationId]?.name,
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
    if (contract.stage === 'choice') models.routeEvent = routeEventModel(player, contract, models.contractPreviews, now);
    models.activeContractView = { ...contract, actions, routeEvent: models.routeEvent || null,
      crewLabel: readyCrew(player, now).map(c => c.name).join(', ') || 'No ready crew',
      result: contract.result ? { ...contract.result, rewardLabel: formatReward(contract.result.rewards) } : null,
      abandon: contract.profile === 'distress' || player.activeEncounter ? null : { enabled: true, label: contract.stage === 'briefing' ? 'Abandon' : 'Break contract', consequence: 'No pending reward. Spent fuel is not refunded.' },
    };
    if (player.activeEncounter) {
      models.activeContractView.encounter = encounterView(player, player.activeEncounter, { settled: contract.stage === 'return', ui, now });
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
  const travelFight = !contract ? player.activeTravelFight : null;
  if (travelFight && player.activeEncounter) {
    models.activeTravelView = {
      acceptanceId: travelFight.fightId, revision: travelFight.revision, stage: travelFight.stage,
      claimAct: 'travel-claim', destinationName: NODES[travelFight.nodeId]?.name || travelFight.nodeId,
      result: travelFight.result ? { ...travelFight.result, rewardLabel: formatReward(travelFight.result.rewards) } : null,
      encounter: encounterView(player, player.activeEncounter, { settled: travelFight.stage === 'return', ui, now }),
    };
  }
  // Legacy Explore order menu: only an in-memory pending jump from before the crew-fight conversion reaches this.
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
        readiness: shipReadiness(player, selectedIds, now),
        enabled: validation.ok && !player.activeExpedition && isFeatureUnlocked(player, 'expeditions'), reason: validation.reason };
    }
  }
  return models;
}

export function sessionAction(player, ui, act, data = {}, { now = trustedNow(), rng = Math.random } = {}) {
  const before = player;
  const events = [];
  const nextUi = {};
  let effect = null;
  const fail = reason => ({ ok: false, reason, player: before });
  const v4 = player.tutorial?.script === 4 && !player.tutorial.completed;
  const v5 = player.tutorial?.script === 5 && !player.tutorial.completed;
  const phase = player.tutorial?.phase;
  if ((v4 || v5) && phase === 'register' && act === 'tutorial-register-start') return null;
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
      fight: player.activeEncounter ? ['encounter-order', 'encounter-advance', 'encounter-command'] : ['tutorial-fight-start'],
      claim: ['contract-claim'], name_ship: ['tutorial-name'], pull: ['tutorial-welcome-pull'],
      register: ['tutorial-register-skip', 'tutorial-register-complete'],
    };
    if (!permitted[phase]?.includes(act)) return fail('tutorial_action_locked');
    if (phase === 'assign') {
      const firstHire = v5FirstHire(player);
      if (!firstHire || data.id !== firstHire.hired.instanceId || data.station !== firstHire.station) return fail('tutorial_station_required');
    }
    const ftlGuidedFight = player.activeEncounter?.version === FTL_VERSION && player.activeEncounter.guided === true;
    if (phase === 'fight' && ftlGuidedFight) {
      // First, tap their Weapons room; nothing else (and no clock) until then.
      if (player.activeEncounter.intent.target !== 'weapons'
        && !(act === 'encounter-command' && data.command?.type === 'target' && data.command.room === 'weapons')) return fail('target_weapons_required');
      if (act === 'encounter-order') return fail('target_weapons_required');
    } else {
      if (phase === 'fight' && act === 'encounter-command') return fail('tutorial_action_locked');
      if (phase === 'fight' && player.activeEncounter?.kind === 'guided' && player.activeEncounter.orderWindow
        && !player.activeEncounter.orders.targetWeapons?.used && act !== 'encounter-order') return fail('target_weapons_required');
      if (phase === 'fight' && act === 'encounter-order' && data.order !== 'target_weapons') return fail('target_weapons_required');
    }
    if (phase === 'claim' && (!player.tutorial.firstWin || player.activeContract?.offerId !== 'offer_tutorial_distress'
      || player.activeContract?.profile !== 'distress' || player.activeContract?.stage !== 'return'
      || player.activeEncounter?.acceptanceId !== player.activeContract?.acceptanceId
      || !guidedTargetDone(player.activeEncounter))) return fail('guided_claim_required');
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
  } else if (act === 'captain-choose') {
    if (!v5 || phase !== 'captain') return fail('captain_unavailable');
    const selected = chooseCaptain(player, { templateId: data.templateId, name: data.name, rng });
    if (!selected.ok) return fail(selected.reason);
    player = advanceTutorialV5(selected.player, 'captain_chosen');
    if (player.tutorial.phase !== 'hire') return fail('captain_unavailable');
    Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
  } else if (act === 'tutorial-first-hire') {
    if (!v5 || phase !== 'hire') return fail('first_hire_unavailable');
    const hired = hireFirstCrew(player, { rng });
    if (!hired.ok) return fail(hired.reason);
    player = hired.player;
    events.push(event('crew_arrived', { crewInstanceId: hired.instance.instanceId, templateId: hired.instance.templateId, source: 'first_hire' }));
    effect = { kind: 'crew-arrival', crewInstanceId: hired.instance.instanceId };
    Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
  } else if (act === 'tutorial-fight-start') {
    const firstHire = v5 ? v5FirstHire(player) : null;
    if (!(v4 || v5) || phase !== 'fight' || player.activeContract || player.activeEncounter
      || (v5 && (!firstHire || player.stationAssignments?.[firstHire.hired.instanceId] !== firstHire.station))) return fail('guided_encounter_unavailable');
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
    if (!(v4 && phase === 'name') && !(v5 && phase === 'name_ship')) return fail('ship_name_unavailable');
    try { player = v4 ? nameShip(player, data.name ?? '') : nameShipV5(player, data.name ?? ''); }
    catch (error) { return fail(error instanceof RangeError ? 'invalid_ship_name' : 'ship_name_unavailable'); }
    if (player === before) return fail('ship_name_unavailable');
  } else if (act === 'tutorial-welcome-pull') {
    if (!(v4 || v5) || phase !== 'pull') return fail('welcome_unavailable');
    const result = v4 ? grantWelcomePull(player, { rng }) : grantWelcomePullV5(player, { rng });
    if (!result.ok) return fail(result.reason);
    player = result.player;
    effect = { kind: 'crew-arrival', crewInstanceId: result.instance.instanceId };
    events.push(event('gacha_pull', { rarity: 'uncommon', free: true, gems: false, kind: result.kind, source: 'welcome' }));
  } else if (act === 'tutorial-register-skip' || act === 'tutorial-register-complete') {
    if (!(v4 || v5) || phase !== 'register') return fail('registration_unavailable');
    if (act === 'tutorial-register-complete' && data.registered !== true) return fail('registration_unconfirmed');
    player = v4 ? advanceTutorialV4(player, act === 'tutorial-register-skip' ? 'registration_skipped' : 'registration_completed')
      : advanceTutorialV5(player, act === 'tutorial-register-skip' ? 'registration_skipped' : 'registration_completed');
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
    // Opening Explore retires its one-time coach mark.
    if (view === 'explore') player = markExploreNudge(player, 'coach');
  } else if (act === 'explore-nudge-dismiss') {
    if (!['coach', 'mapIntro'].includes(data.nudge)) return fail('unknown_nudge');
    player = markExploreNudge(player, data.nudge);
  } else if (act === 'daily-improve') {
    Object.assign(nextUi, improvementFocus(player));
  } else if (act === 'contract-review') {
    if (player.activeTravelFight) return fail('travel_fight_active');
    if (player.activeEvent) return fail('event_active');
    const review = reviewContractOffer(player, data.offer);
    if (!review.ok || player.activeContract || player.contractBoard.completedOfferIds.includes(data.offer)) return fail(review.reason || 'offer_unavailable');
    nextUi.reviewedOfferId = data.offer;
    events.push(event('contract_reviewed', { offerId: data.offer, profile: review.offer.profile, destination: review.offer.destinationId, fuel: review.cost.fuel, traitMatch: traitMatch(player, review.favoredTrait) }));
    tutorial('contract_reviewed', { offerId: data.offer });
  } else if (act === 'contract-review-close') nextUi.reviewedOfferId = null;
  else if (act === 'contract-accept') {
    if (player.activeTravelFight) return fail('travel_fight_active');
    if (player.activeEvent) return fail('event_active');
    const review = reviewContractOffer(player, data.offer);
    if (review.ok && !contractRewardBand(player, review.offer, { now }).available) return fail('reward_unavailable');
    const res = acceptContract(player, data.offer, now);
    if (!res.ok) return res;
    player = res.player;
    events.push(fromAnalytics({ ...res.analytics, traitMatch: traitMatch(player, player.activeContract.favoredTrait) }));
    tutorial('contract_accepted');
    Object.assign(nextUi, { reviewedOfferId: null, tab: 'missions', selectedRoom: null, missionView: player.tutorial.phase === 'away' ? 'away' : 'contracts' });
  } else if (act === 'encounter-command') {
    // Retarget, hold, or move crew: no time passes, so nothing else in the session changes.
    const travel = Boolean(player.activeTravelFight && !player.activeContract);
    const input = { acceptanceId: data.acceptanceId, revision: data.revision, command: data.command };
    const result = travel ? applyTravelFightCommand(player, input) : applyEncounterCommand(player, input);
    if (!result.ok) return result;
    player = result.player;
    // Auto is the captain's standing order: later fights start the same way.
    if (data.command?.type === 'auto') player = { ...player, flags: { ...(player.flags || {}), manualAbilities: data.command.auto !== true } };
    effect = { kind: 'encounter-command', command: data.command };
  } else if (['encounter-advance', 'encounter-order', 'encounter-recover'].includes(act)) {
    const travel = Boolean(player.activeTravelFight && !player.activeContract);
    const beatInput = { acceptanceId: data.acceptanceId, revision: data.revision, order: act === 'encounter-order' ? data.order : null };
    const result = act === 'encounter-recover'
      ? travel ? fail('invalid_encounter_state') : recoverEncounter(player, data)
      : travel ? applyTravelFightAction(player, beatInput, now) : applyEncounterAction(player, beatInput, now);
    if (!result.ok) return result;
    player = result.player;
    events.push(fromAnalytics(result.analytics));
    if (act === 'encounter-recover') {
      Object.assign(nextUi, { tab: 'ship', selectedRoom: 'engineering' });
    } else if (travel) {
      for (const beatEvent of result.events) events.push(event('encounter_event', { acceptanceId: data.acceptanceId, beat: player.activeEncounter.beat, source: 'travel', ...beatEvent }));
      if (player.activeTravelFight.stage === 'return') {
        const settled = player.activeTravelFight.result;
        events.push(event('combat', { success: settled.success, encounter: player.activeTravelFight.encounterId, crewFight: true, beats: player.activeEncounter.beat }));
        Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
      }
      effect = { kind: 'encounter-beat', events: result.events, outcome: player.activeEncounter.result };
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
      if ((v4 && player.tutorial.phase === 'name') || (v5 && player.tutorial.phase === 'name_ship')) {
        player = { ...player, crewSlots: Math.max(3, player.crewSlots || 2),
          flags: { ...player.flags, berth3Opened: true } };
      }
      Object.assign(nextUi, improvementFocus(player));
    } else {
      // Route events: a choice id must belong to this contract's event and match its action.
      if (data.choice != null && (contract.stage !== 'choice' || !routeChoiceMatches(contract, data.choice, data.action))) return fail('stale_contract_action');
      const action = act === 'contract-order' ? { id: 'order', orderId: data.order } : { id: data.action };
      const key = action.id === 'order' ? `order:${action.orderId}` : action.id;
      const preview = ui.contractPreviews?.[key] || previewContractAction(player, action, now);
      const res = commitContractAction(player, preview, { rng, now });
      if (!res.ok) return res;
      player = res.player;
      events.push(fromAnalytics(data.choice != null ? { ...res.analytics, routeEvent: routeEventFor(contract)?.id || null, choice: data.choice } : res.analytics));
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
  } else if (['ship-upgrade', 'level-crew', 'rank-up', 'crew-ascend'].includes(act)) {
    if (isTutorialActive(player)) return fail('improvements_locked');
    const res = act === 'ship-upgrade' ? upgradeSystem(player, data.system, now) : act === 'level-crew' ? levelCrew(player, data.id)
      : act === 'crew-ascend' ? ascendCrew(player, data.id) : rankUpCrew(player, data.id);
    if (!res.ok) return res;
    player = res.player;
    milestone('improve');
    if (act === 'ship-upgrade') events.push(event(res.build ? 'ship_build_started' : 'ship_upgrade', { system: data.system, level: res.nextLevel, ...(res.build ? { minutes: Math.round((res.build.endAt - res.build.startedAt) / 60000) } : {}) }));
  } else if (act === 'weapon-buy' || act === 'weapon-equip') {
    if (isTutorialActive(player)) return fail('improvements_locked');
    const res = act === 'weapon-buy' ? buyWeapon(player, data.weapon) : equipWeapon(player, data.slot, data.weapon);
    if (!res.ok) return fail(res.reason);
    player = res.player;
    if (act === 'weapon-buy') { milestone('improve'); events.push(event('weapon_bought', { weapon: data.weapon, credits: res.cost.credits })); }
  } else if (act === 'refuel-gems') {
    const res = refuelWithGems(player);
    if (!res.ok) return fail(res.reason);
    player = res.player;
    events.push(event('gem_spend', { sink: 'fuel_refill', gems: res.gems }));
  } else if (act === 'ship-build-skip') {
    const res = skipShipBuild(player, now);
    if (!res.ok) return fail(res.reason);
    player = res.player;
    events.push(event('ship_build_skipped', { system: res.completed?.system, gems: res.gems, token: Boolean(res.token) }));
  } else if (act === 'travel-to') {
    if (player.activeContract) return fail('active_contract');
    if (isTutorialActive(player)) return fail('tutorial_contract_required');
    if (ui.pendingCombat || player.activeTravelFight || player.activeEncounter) return fail('combat_pending');
    if (player.activeEvent) return fail('event_active');
    // Sector map: only beacons joined to your location by a lane (Spur Anchor if crippled or stranded).
    const lane = laneCheck(player, data.node, now);
    if (!lane.ok) return fail(lane.reason);
    const preview = previewTravel(player, data.node, { rng });
    if (!preview.ok) return fail(preview.reason);
    const mapFound = paid => noteMapJump(paid, before);
    if (preview.needsAssists) {
      // Explore fights are real-time crew fights on the ship, like contract confrontations.
      const res = beginTravelFight(player, preview, now);
      if (!res.ok) return fail(res.reason);
      player = mapFound(res.player);
      events.push(event('travel', { node: data.node, kind: 'combat' }), fromAnalytics(res.analytics));
      Object.assign(nextUi, { tab: 'ship', selectedRoom: null, pendingCombat: null });
      effect = { kind: 'encounter-beat', events: [], outcome: null };
    } else if (arrivalOpensEvent(player, preview.node, preview.outcome)) {
      // Non-combat arrivals open an event card; arrival waits for the choice.
      const res = openTravelEvent(player, preview, now);
      if (!res.ok) return fail(res.reason);
      player = mapFound(res.player);
      events.push(event('travel', { node: data.node, kind: 'event' }), fromAnalytics(res.analytics));
      Object.assign(nextUi, { selectedMapNode: null, eventResult: null });
      effect = { kind: 'event-open' };
    } else {
      const res = commitTravel(player, preview, { rng });
      if (!res.ok) return res;
      player = mapFound(res.player);
      tutorial('travel_success');
      events.push(event('travel', { node: data.node, kind: res.result.kind }));
      effect = { kind: 'travel', result: res.result };
    }
  } else if (act === 'event-choose') {
    const res = resolveTravelEvent(player, { eventId: data.eventId, choice: data.choice }, now);
    if (!res.ok) return fail(res.reason);
    player = markExploreNudge(res.player, 'eventHint');
    events.push(fromAnalytics(res.analytics));
    if (res.result.fight) {
      events.push(fromAnalytics(res.fightAnalytics));
      Object.assign(nextUi, { tab: 'ship', selectedRoom: null, eventResult: null });
      effect = { kind: 'encounter-beat', events: [], outcome: null };
    } else {
      tutorial('travel_success');
      nextUi.eventResult = { title: res.result.event.title, choiceLabel: res.result.event.choiceLabel, text: res.result.flavor,
        nodeName: res.result.node.name, rewardLabel: res.result.rewards ? formatReward(res.result.rewards) : '',
        hullLoss: res.result.hullLoss, injured: res.result.injured, hired: res.result.hired?.name || null,
        beat: res.result.beat ? { title: res.result.beat.title, text: res.result.beat.text } : null };
      effect = { kind: 'travel', result: res.result };
    }
  } else if (act === 'event-dismiss') {
    nextUi.eventResult = null;
  } else if (act === 'map-select') {
    nextUi.selectedMapNode = data.node && NODES[data.node] ? data.node : null;
  } else if (act === 'map-sector') {
    Object.assign(nextUi, { mapSector: data.sector || null, selectedMapNode: null });
  } else if (act === 'travel-claim') {
    const res = claimTravelFight(player, data);
    if (!res.ok) return fail(res.reason);
    player = res.player;
    tutorial('travel_success');
    events.push(fromAnalytics(res.analytics));
    Object.assign(nextUi, { tab: 'ship', selectedRoom: null });
    effect = { kind: 'travel', result: res.result };
  } else if (act === 'combat-order') {
    // Legacy dice resolution, kept only for a pending jump opened before crew-fight conversion.
    if (!ui.pendingCombat || player.activeContract || player.activeTravelFight) return fail('no_pending_combat');
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

/** What the ship can still fight with after an away team leaves. */
export function shipReadiness(player, awayIds = [], now = trustedNow()) {
  const ready = readyContractCrew(player, now);
  const staying = ready.filter(member => !awayIds.includes(member.instanceId));
  const assignments = player.stationAssignments || {};
  const unstaffed = Object.entries(STATIONS)
    .filter(([id]) => ready.some(member => assignments[member.instanceId] === id) && !staying.some(member => assignments[member.instanceId] === id))
    .map(([, station]) => station.label);
  return { before: crewPower(ready), after: crewPower(staying), aboard: staying.length, unstaffed };
}
