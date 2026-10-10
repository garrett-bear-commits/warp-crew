import { renderFtlControls } from './ftlView.js';
import { SPACE_ART, NODE_ART } from '../data/portraits.js';
import { speakerFor } from '../data/speakers.js';
import { CHAPTERS } from '../data/campaign.js';

/** Pure presentation. Callers supply costs, availability, previews and selected crew.
 * No player mutations, reward calculations, party recommendations or route decisions.
 * Action data is consumed by the bridge's existing delegated action handler.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const e = escapeHtml;

const PROFILE_ART = { reliable: SPACE_ART.trader, risky: SPACE_ART.pirate, strange: NODE_ART.b, distress: SPACE_ART.trader };
const dangerKey = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
const profileLabel = (offer) => offer.profileLabel || ({ reliable: 'Reliable', risky: 'Risky', strange: 'Strange', distress: 'Distress' }[offer.profile] || offer.profile || 'Contract');
const profileIcon = (offer) => ({ reliable: '◆', risky: '⚔', strange: '✦', distress: '!' }[offer.profile] || '◇');
/** The set-piece rule on a card (the fight engine owns the numbers; this is the one line the card shows). */
const TWIST_COPY = {
  escort: { label: 'Escort', rule: 'A freighter flies beside you. Keep it alive for more pay.' },
  rush: { label: 'Rush', rule: 'Win before the clock runs out for more pay.' },
  bounty: { label: 'Bounty', rule: 'A named elite. Harder, and it pays more.' },
  holdout: { label: 'Holdout', rule: 'Survive until the clock runs out, or destroy them.' },
  waves: { label: 'Two waves', rule: 'When the first ship falls, a second one arrives.' },
};
const twistLine = (offer) => {
  const twist = offer.twistView || (offer.twist && TWIST_COPY[offer.twist.id]);
  if (!twist) return '';
  const elite = offer.twist?.elite?.name ? ` Target: ${offer.twist.elite.name}.` : '';
  return `<p class="contract-twist" data-twist="${e(offer.twist?.id)}"><b>${e(twist.label)}</b> · ${e(twist.rule)}${e(elite)}</p>`;
};
const PAY_LABEL = { credits: 'credits', medals: 'medals', gems: 'gems', reputation: 'rep', fuel: 'fuel' };
const storyPay = (offer) => {
  const bits = Object.entries(offer.storyRewards || {}).filter(([, n]) => n > 0).map(([key, n]) => `+${n} ${PAY_LABEL[key] || key}`);
  return bits.length ? `<p class="contract-story-pay">Story pay on a win: <b>${e(bits.join(' · '))}</b></p>` : '';
};
/** A story card's client, or a chapter boss's finale label. */
const clientBanner = (offer) => {
  if (!offer.client) return '';
  const who = speakerFor(offer.client);
  return `<div class="contract-client"><img src="${e(who.portrait)}" alt="" /><span><b>${e(who.name)}</b><small>${e(who.from || '')}</small></span></div>`;
};
const bossOf = (offer) => (offer.wall ? CHAPTERS.find(ch => ch.wall === offer.wall.id) : null);
const cardLabel = (offer) => offer.story ? `Story · Chapter ${offer.story.chapter}` : bossOf(offer) ? `Chapter ${bossOf(offer).n} finale` : profileLabel(offer);
const cardIcon = (offer) => (offer.story ? '★' : profileIcon(offer));
const rewardLabel = (offer) => offer.rewardBand?.label || offer.primaryReward || offer.rewardLabel || 'Reward unavailable';
const trait = (value) => value ? `<p class="contract-consequence contract-favored"><b>Favored: ${e(value.label)}</b>${value.why ? `<span> · ${e(value.why)}</span>` : ''}</p>` : '';
const reason = (value) => value ? `<p class="contract-consequence">${e(value)}</p>` : '';

export function renderMissionSwitcher(view = 'contracts', views = ['contracts', 'away', 'explore'], { fresh = [] } = {}) {
  return `<nav class="mission-switcher" style="--views:${views.length}" aria-label="Mission views">${[['contracts', 'Contracts'], ['away', 'Away'], ['explore', 'Explore']].filter(([id]) => views.includes(id)).map(([id, label]) => `<button type="button" data-act="mission-view" data-view="${id}" aria-pressed="${id === view}"${fresh.includes(id) ? ' class="is-new"' : ''}>${label}${fresh.includes(id) ? '<i class="nav-badge" aria-label="new"></i>' : ''}</button>`).join('')}</nav>`;
}

function renderSiegeMeter(wall) {
  const pct = Math.max(0, Math.min(100, Math.round((wall.remaining / wall.pool) * 100)));
  const hours = Math.floor((wall.resetsInMs || 0) / 3600000);
  const minutes = Math.floor(((wall.resetsInMs || 0) % 3600000) / 60000);
  return `<div class="siege-meter" role="meter" aria-label="Flagship hull" aria-valuemin="0" aria-valuemax="${e(wall.pool)}" aria-valuenow="${e(wall.remaining)}">
    <div class="siege-bar"><span style="width:${pct}%"></span></div>
    <p>Flagship hull <b>${e(wall.remaining)}/${e(wall.pool)}</b>${wall.remaining < wall.pool ? ` · damage holds ${hours}h ${minutes}m more` : ' · each attempt fights up to 42'}</p>
  </div>`;
}

/** The fight a contract can lead to: its threat and the win odds played from the real fight. */
const fightOddsLine = (odds) => odds ? `<p class="fight-threat contract-odds" data-threat="${e(odds.label.toLowerCase())}">Fight: <b>${e(odds.label)}</b> · ${e(odds.text)}</p>` : '';

export function renderContractBoard(model = {}) {
  return `<section class="contract-board" aria-label="Contract Board"><header class="board-head"><h2>Contracts</h2><span>Pick one job for the crew</span></header>${(model.offers || []).map((offer) => {
    const odds = offer.completed ? null : offer.fightOdds;
    const label = `${offer.completed ? 'Completed · Review' : 'Review'} ${cardLabel(offer)}, ${offer.title}, ${offer.normalFuel}F, ${offer.danger} danger, Possible payout now: ${rewardLabel(offer)}${odds ? `, Fight ${odds.label}, ${odds.text}` : ''}`;
    const art = offer.client ? null : PROFILE_ART[offer.profile];
    const siege = offer.wall ? renderSiegeMeter(offer.wall) : '';
    return `<article class="contract-card${offer.completed ? ' is-completed' : ''}${offer.wall ? ' is-wall' : ''}${offer.story ? ' is-story' : ''}" data-profile="${e(offer.story ? 'story' : offer.wall ? 'wall' : offer.profile)}">
      <div class="contract-banner">
        <p class="contract-profile"><span aria-hidden="true">${cardIcon(offer)}</span> ${e(cardLabel(offer))}${offer.completed ? ' · ✓ Completed' : ''}</p>
        ${art ? `<img class="contract-art" src="${e(art)}" alt="" />` : ''}${clientBanner(offer)}
      </div>
      <h3>${e(offer.title)}</h3><p class="contract-brief">${e(offer.brief)}</p>${twistLine(offer)}${storyPay(offer)}${siege}
      <dl class="contract-facts"><div class="fact-fuel"><dt>Normal fuel</dt><dd>${e(offer.normalFuel)}F</dd></div><div class="fact-length"><dt>Length</dt><dd>${e(offer.beatLabel || `${offer.beats} beats`)}</dd></div><div class="fact-danger" data-danger="${e(dangerKey(offer.danger))}"><dt>Danger</dt><dd>${e(offer.danger)}</dd></div><div class="fact-pay"><dt>Possible payout now</dt><dd>${e(rewardLabel(offer))}</dd></div></dl>
      ${fightOddsLine(odds)}${trait(offer.favoredTrait)}<button type="button" class="contract-review-btn" data-act="contract-review" data-offer="${e(offer.id)}" aria-label="${e(label)}" ${offer.completed || offer.enabled === false ? 'disabled' : ''}>${offer.completed ? 'Completed' : 'Review'}</button>
    </article>`;
  }).join('') || '<p>No contracts available.</p>'}</section>`;
}

export function renderContractReview(model = {}) {
  const offer = model.offer || {};
  return `<div class="modal-backdrop contract-backdrop"><section class="contract-sheet" role="dialog" aria-modal="true" aria-labelledby="contract-review-title">
    <button type="button" class="icon-close" data-act="contract-review-close" aria-label="Close contract review">×</button>
    <div class="contract-banner" data-profile="${e(offer.story ? 'story' : offer.profile)}"><p class="contract-profile">${e(cardLabel(offer))}</p>${!offer.client && PROFILE_ART[offer.profile] ? `<img class="contract-art" src="${e(PROFILE_ART[offer.profile])}" alt="" />` : ''}${clientBanner(offer)}</div>
    <h2 id="contract-review-title">${e(offer.title)}</h2>
    <p class="contract-brief">${e(offer.brief)}</p>${twistLine(offer)}${storyPay(offer)}${model.briefingId ? `<button type="button" class="ghost tx-replay" data-act="tx-replay" data-id="${e(model.briefingId)}">Replay the briefing</button>` : ''}<p class="contract-destination">Destination: ${e(model.destinationName || offer.destinationName)}</p>
    <dl class="contract-facts"><div class="fact-fuel"><dt>Payable route fuel</dt><dd>${e(model.cost?.fuel)}F</dd></div><div class="fact-danger" data-danger="${e(dangerKey(offer.danger))}"><dt>Danger</dt><dd>${e(offer.danger)}</dd></div><div class="fact-pay"><dt>Possible payout now</dt><dd>${e(rewardLabel(model))}</dd></div></dl>
    ${model.fightThreat ? `<p class="fight-threat" data-threat="${e(model.fightThreat.label.toLowerCase())}">Fight: <b>${e(model.fightThreat.label)}</b>${model.fightThreat.odds ? ` · ${e(model.fightThreat.odds.text)} with the crew aboard` : ''}${model.fightThreat.awayCount ? ` · ${e(model.fightThreat.awayCount)} crew away` : ''}</p>` : ''}
    ${reason(model.consequence)}${trait(model.favoredTrait || offer.favoredTrait)}${reason(model.reason)}
    <p class="contract-note">Accepting spends no fuel. Fuel is spent by route actions.</p>
    <button type="button" class="primary" data-act="contract-accept" data-offer="${e(offer.id)}" aria-label="${e(`Accept contract, Possible payout now: ${rewardLabel(model)}`)}" ${model.enabled === false || model.ok === false ? 'disabled' : ''}>Accept contract</button>
  </section></div>`;
}

export function renderActiveContract(model = {}) {
  return `<section class="route-stage" data-stage="${e(model.stage)}" aria-label="Active contract">
    <p>${e(model.title)}</p><h2>${e(model.encounter ? model.encounter.result === 'win' ? 'Victory' : model.encounter.result === 'loss' ? 'Ship damaged' : 'Pirate attack' : model.stageLabel || model.stage)}</h2>${reason(model.description)}
    ${model.crewLabel ? `<p>Crew: ${e(model.crewLabel)}</p>` : ''}${trait(model.favoredTrait)}
    ${model.result ? `<p class="contract-consequence">${e(model.result.summary)}</p><p>${e(model.result.rewardLabel)}</p>` : ''}
    ${model.encounter?.ftl ? `<p class="ftl-elsewhere" role="status">${model.encounter.result ? '' : `Fighting ${e(model.encounter.enemyName)} · hull ${e(model.encounter.hull)}. `}The fight plays out on the ship.</p><button type="button" class="primary" data-act="goto-ship">Go to the ship</button>`
      : model.encounter ? renderEncounter(model.encounter) : ''}
    ${model.combat ? renderCombatOrders(model.combat) : ''}
    ${(model.actions || []).map((action) => `<div class="route-action">${reason(action.consequence)}${reason(action.reason)}<button type="button" class="${action.primary ? 'primary' : ''}" data-act="contract-action" data-action="${e(action.id)}" data-revision="${e(model.revision)}" data-acceptance-id="${e(model.acceptanceId)}" ${action.enabled ? '' : 'disabled'}>${e(action.label)}</button></div>`).join('')}
    ${model.abandon ? `<button type="button" class="ghost" data-act="contract-abandon" data-revision="${e(model.revision)}" data-acceptance-id="${e(model.acceptanceId)}" ${model.abandon.enabled ? '' : 'disabled'}>${e(model.abandon.label)}</button>${reason(model.abandon.consequence)}` : ''}
  </section>`;
}

/** Compact fight controls that sit over the visible, pannable ship. */
export function renderShipEncounter(model = {}, ui = {}) {
  if (!model.encounter) return '';
  // FTL-lite fights render as the controls strip under the ship view.
  if (model.encounter.ftl) return renderFtlControls(model.encounter, { ...ui, claimAct: model.claimAct || 'contract-claim',
    claimRevision: model.revision, claimAcceptanceId: model.acceptanceId });
  const salvage = model.encounter.result === 'loss' && model.encounter.settled;
  const claim = model.encounter.result === 'win' || salvage
    ? `<button type="button" class="primary" data-act="${e(model.claimAct || 'contract-claim')}" data-revision="${e(model.revision)}" data-acceptance-id="${e(model.acceptanceId)}">${salvage ? 'Collect salvage' : 'Bring cargo aboard'}</button>`
    : '';
  return `<aside class="ship-encounter" aria-label="Crew combat controls">${renderEncounter(model.encounter, { compact: true })}${claim}</aside>`;
}

const orderReason = { insufficient_resource: 'Needs more shield charge', cooldown: 'Cooling down', used: 'Already used', hull_full: 'Hull is full' };
const tacticReason = { not_enough_fuel: 'Needs 1 fuel', used: 'Used this fight', enemy_too_strong: 'Enemy above half hull', finished: 'Fight over' };

function renderBoarders(model, identity) {
  const b = model.boarders;
  if (!b || model.result) return '';
  const line = b.phase === 'incoming' ? `Clamps on the airlock. Boarders land next beat, heading for ${e(b.target)}.`
    : b.phase === 'aboard' ? `${e(b.strength)} raider${b.strength === 1 ? '' : 's'} sabotaging ${e(b.target)} · systems ${e(b.system)}%${b.defenderName ? ` · ${e(b.defenderName)} fighting them` : ''}`
      : `${b.defenderName ? `${e(b.defenderName)} threw the boarders` : 'Boarders thrown'} out of ${e(b.target)}.`;
  const repel = b.canRepel ? `<button type="button" class="tactic tactic-repel" data-act="encounter-order" data-order="repel" ${identity}>Repel boarders<span>${e(b.repelCost)}</span></button>` : '';
  return `<div class="boarder-alert" data-phase="${e(b.phase)}" role="status"><p>${line}</p>${repel}</div>`;
}

function renderTactics(model, identity) {
  if (!model.tactics?.length || model.result) return '';
  return `<div class="tactic-row" role="group" aria-label="Initiative orders">${model.tactics.map(tactic => {
    const burn = tactic.id === 'burn';
    const title = burn ? 'Burn · 1F' : `Board · ${tactic.chance != null ? Math.round(tactic.chance * 100) + '%' : '—'}`;
    const detail = burn ? (tactic.burning ? 'Guns overcharged' : '+3 damage for 3 beats')
      : tactic.used ? (tactic.success ? 'Boarded' : 'Repelled') : '+25% payout · failure injures crew';
    const why = tactic.available ? '' : ` · ${tacticReason[tactic.reason] || 'Unavailable'}`;
    return `<button type="button" class="tactic tactic-${e(tactic.id)}${tactic.burning ? ' is-live' : ''}" data-act="encounter-order" data-order="${e(tactic.id)}" ${identity} ${tactic.available ? '' : 'disabled'}>${e(title)}<span>${e(detail)}${e(why)}</span></button>`;
  }).join('')}</div>`;
}

export function renderEncounter(model = {}, { compact = false } = {}) {
  const identity = `data-revision="${e(model.revision)}" data-acceptance-id="${e(model.acceptanceId)}"`;
  const target = { hull: 'hull', weapons: 'weapons', shields: 'shields', engineering: 'engineering' }[model.target] || 'ship';
  const v2 = model.version === 2 || (model.orders || []).some(order => order.id === 'target_weapons');
  const guidedBrace = !v2 && model.kind === 'guided' && !model.braceUsed && model.beat > 0;
  const guidedAfterBrace = !v2 && model.kind === 'guided' && model.braceUsed;
  const targetOrder = (model.orders || []).find(order => order.id === 'target_weapons' && order.available);
  const guidedTarget = v2 && model.kind === 'guided' && targetOrder;
  const guidedV2 = v2 && model.kind === 'guided';
  const guidedCrew = guidedV2 && model.targetWeaponsUsed === true;
  const autoPaced = model.kind === 'normal';
  const beatTimer = !model.result && (autoPaced || guidedCrew) && model.beatMs
    ? `<div class="beat-timer" aria-hidden="true"><span data-rev="${e(model.revision)}" style="animation-duration:${e(model.beatMs)}ms"></span></div>` : '';
  const eta = model.beatsToImpact && model.beatMs ? ` · ~${Math.round((model.beatsToImpact * model.beatMs) / 1000)}s` : '';
  const orders = (model.orders || []).filter(order => !(order.id === 'target_weapons' && !order.available) && !(v2 && model.kind === 'guided' && order.id !== 'target_weapons'));
  const downed = model.downed;
  const status = downed ? `<div class="downed-alert" role="alert"><p><b>Hull failing.</b> ${e(model.enemyName || 'The enemy')} has only ${e(downed.enemyHull)} hull left.</p>
      <button type="button" class="primary rally-btn" data-act="encounter-order" data-order="rally" ${identity} ${downed.canAfford ? '' : 'disabled'}>Rally<span>${downed.free ? 'Free this time · ' : `${e(downed.rallyCost)} gems · `}restore 12 hull and fight on</span></button>
      <button type="button" class="ghost" data-act="encounter-order" data-order="concede" ${identity}>Take the salvage</button></div>`
    : model.result === 'loss' && model.settled ? `<p role="status">${e(model.lossReason || 'The ship needs repairs.')} The crew pulls salvage from the wreckage.</p>`
    : model.result === 'loss' ? `<p role="status">${e(model.lossReason || 'The ship needs repairs.')}</p><button type="button" class="primary" data-act="encounter-recover" ${identity}>Recover ship</button>`
    : model.result === 'win' ? '<p role="status">The pirate breaks off. Bring the cargo aboard.</p>'
      : `<p class="encounter-threat" role="status">${model.weaponDisabled ? 'Next pirate volley canceled. Crew firing.' : model.beatsToImpact ? `Incoming fire at ${e(target)} · ${e(model.beatsToImpact)} ${model.beatsToImpact === 1 ? 'beat' : 'beats'}${eta}` : 'Pirate weapons charging'}</p>${beatTimer}
        <div class="encounter-actions">${(guidedCrew || autoPaced) && model.retryBeat
          ? `<p role="alert">Fight progress was not saved. Try the next beat again.</p><button type="button" class="primary" data-primary-pulse data-act="encounter-advance" ${identity}>Retry fight progress</button>`
          : guidedAfterBrace || guidedCrew ? '<span>Crew engaging…</span>' : `${autoPaced ? '<span class="crew-engaging">Crew engaging · orders are optional</span>' : ''}${renderBoarders(model, identity)}${renderTactics(model, identity)}${orders.map(order => `<button type="button" class="${(guidedBrace || guidedTarget) && order.available ? 'primary' : ''}" ${(guidedTarget && order.id === 'target_weapons') ? 'data-primary-pulse data-spotlight-target' : ''} data-act="encounter-order" data-order="${e(order.id)}" ${identity} ${order.available ? '' : 'disabled'}>
          ${order.id === 'target_weapons' ? `Target their weapons<span>Stop the next volley · free · once this fight</span>` : guidedBrace && order.id === 'brace' ? `Brace<span>Spend ${e(order.cost)} shield to block the hit.</span>` : `${e(order.id === 'brace' ? 'Brace' : 'Repair')} · ${e(order.cost)} shield <span>${e(order.effectLabel)} · ${e(order.cooldownLabel || '')}</span>`}${order.available ? '' : ` · ${e(orderReason[order.reason] || order.reason || 'Unavailable')}${order.cooldownBeats ? ` (${e(order.cooldownBeats)} beats)` : ''}`}
        </button>`).join('')}`}${guidedBrace || guidedV2 || autoPaced ? '' : `<button type="button" class="${guidedAfterBrace ? '' : 'primary'}" data-act="encounter-advance" ${identity}>${guidedAfterBrace ? 'Continue fight' : model.beatsToImpact ? 'No order · conserve shield' : 'Advance combat'}</button>`}</div>`;
  const threatLabel = model.threatLabel || '';
  const enemyHead = model.enemyName ? `<header class="enemy-head"><b>${e(model.enemyName)}</b>${threatLabel ? `<span data-threat="${e(threatLabel.toLowerCase())}">${e(threatLabel)}</span>` : ''}${model.tell && !model.result ? `<p>${e(model.tell.label)} ${e(model.tell.text)}</p>` : ''}</header>` : '';
  return `<section class="encounter-panel${compact ? ' compact' : ''}${guidedTarget ? ' target-window' : ''}" aria-label="Crew combat">
    ${enemyHead}<div class="encounter-bars"><span>Hull ${e(model.hull)}/30</span><meter min="0" max="30" value="${e(model.hull)}" aria-label="Ship hull"></meter>
      <span>Shield ${e(model.shield)}/12</span><meter min="0" max="12" value="${e(model.shield)}" aria-label="Shield charge"></meter>
      <span>${e(model.enemyName ? 'Enemy' : 'Pirate')} ${e(model.enemyHull)}</span><meter min="0" max="${model.kind === 'guided' ? 25 : 42}" value="${e(model.enemyHull)}" aria-label="Pirate hull"></meter></div>
    ${guidedTarget ? '<p class="target-caption">◎ Pirate weapons charging</p>' : ''}
    ${model.weaponDisabled && !model.result ? '<p class="target-caption" role="status">✕ Pirate weapons disabled · next volley canceled</p>' : ''}
    ${compact ? '<details class="encounter-stations"><summary>Station status</summary>' : '<div class="encounter-stations">'}${Object.entries({ helm: 'Helm · evade', shields: 'Shields · block', weapons: 'Weapons · fire', engineering: 'Engineering · repair' }).map(([id, label]) => `<span>${e(label)} ${e(model.outputs?.[id])} · ${e(model.systems?.[id])}%</span>`).join('')}${compact ? '</details>' : '</div>'}
    ${status}
  </section>`;
}

export function renderCombatOrders(model = {}) {
  return `<section class="combat-orders" aria-label="Combat orders"><h2>${e(model.title || 'Choose an order')}</h2>
    ${model.legacy ? '<p>Legacy encounter</p>' : ''}
    ${model.tell ? `<h3>${e(model.tell.label)}</h3><p class="contract-consequence">${e(model.tell.text || model.tell.sentence)}</p>${reason(model.tell.reason)}` : ''}
    ${(model.orders || []).map((order) => `<article class="order-card">
      <h3>${e(order.name)}${order.recommended ? ' · Recommended' : ''}</h3>
      <p>${e(model.guaranteed ? 'Guaranteed' : order.chanceLabel)} · ${e(order.costLabel)}</p>
      ${reason(order.rewardLabel)}${reason(order.consequence)}${reason(order.reason)}
      <button type="button" data-act="${e(model.action || 'combat-order')}" data-order="${e(order.id)}" ${model.acceptanceId ? `data-revision="${e(model.revision)}" data-acceptance-id="${e(model.acceptanceId)}"` : ''} ${order.enabled ? '' : 'disabled'} aria-label="${e(`Choose ${order.name}, ${model.guaranteed ? 'Guaranteed' : order.chanceLabel}, ${order.costLabel}, ${order.consequence}`)}">Choose ${e(order.name)}</button>
    </article>`).join('')}</section>`;
}

export function renderAwayPicker(model = {}) {
  const selected = model.selectedIds || [];
  return `<div class="modal-backdrop contract-backdrop"><section class="contract-sheet party-picker" role="dialog" aria-modal="true" aria-labelledby="away-picker-title">
    <button type="button" class="icon-close" data-act="exp-picker-close" aria-label="Close crew selection">×</button>
    <h2 id="away-picker-title">Choose crew · ${e(model.destination?.name)}</h2><p>${selected.length}/${e(model.cap)} selected</p>
    ${(model.options || []).map((crew) => `<button type="button" class="party-row" data-act="exp-crew-toggle" data-id="${e(crew.id)}" aria-pressed="${selected.includes(crew.id)}" ${crew.enabled === false ? 'disabled' : ''}>
      ${crew.portrait ? `<img src="${e(crew.portrait)}" alt="" width="64" height="64" />` : '<span class="party-portrait" aria-hidden="true">◇</span>'}
      <span><strong>${e(crew.name)}</strong><span>${e(crew.role)} · ${selected.includes(crew.id) ? '✓ Selected' : 'Not selected'}</span><span>${(crew.reasons || []).map(e).join(' · ')}</span>${crew.reason ? `<span>${e(crew.reason)}</span>` : ''}</span>
    </button>`).join('')}
    <div class="party-preview" aria-live="polite"><p>Success chance: ${e(model.chanceLabel)}</p><p>Success: ${e(model.successReward)}</p><p>Failure: ${e(model.failureReward)}</p>${reason(model.injuryRisk)}<p>Returns: ${e(model.returnLabel)}</p>${reason(model.opportunityCost)}${model.readiness ? `<p class="ship-readiness">Ship combat power ${e(model.readiness.before)} → <b>${e(model.readiness.after)}</b> · ${e(model.readiness.aboard)} aboard${model.readiness.unstaffed.length ? ` · ${e(model.readiness.unstaffed.join(', '))} unstaffed` : ''}</p>` : ''}${reason(model.reason)}</div>
    <button type="button" class="primary" data-act="exp-launch" data-planet="${e(model.destination?.id)}" ${model.enabled === true ? '' : 'disabled'}>Confirm expedition</button>
  </section></div>`;
}

/** The hub's orders chip: points toward the daily chest and the next order, or the chest itself once it is ready. */
export function renderDailyPlan(model = {}) {
  if (model.chestReady) return '<button type="button" class="daily-plan-chip is-chest" data-act="chest-open" data-kind="daily" aria-label="Daily orders done. Open the daily chest">Daily chest ready · Open</button>';
  // Once the chest is open (or its points are in) the rest of the day's orders pay nothing more: no chip.
  if (model.complete || !model.next || model.chestOpened || (model.points || 0) >= (model.goal || 100)) return '';
  const points = model.points || 0;
  const goal = model.goal || 100;
  return `<button type="button" class="daily-plan-chip" data-act="${e(model.next.act)}"${model.next.view ? ` data-view="${e(model.next.view)}"` : ''} aria-label="${e(`Daily orders ${points} of ${goal} points, next: ${model.next.label}`)}">${e(points)}/${e(goal)} · ${e(model.next.label)}</button>`;
}
