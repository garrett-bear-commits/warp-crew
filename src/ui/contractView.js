/** Pure presentation. Callers supply costs, availability, previews and selected crew.
 * No player mutations, reward calculations, party recommendations or route decisions.
 * Action data is consumed by the bridge's existing delegated action handler.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const e = escapeHtml;
const profileLabel = (offer) => offer.profileLabel || ({ reliable: 'Reliable', risky: 'Risky', strange: 'Strange', distress: 'Distress' }[offer.profile] || offer.profile || 'Contract');
const profileIcon = (offer) => ({ reliable: '◆', risky: '⚔', strange: '✦', distress: '!' }[offer.profile] || '◇');
const rewardLabel = (offer) => offer.primaryReward || offer.rewardFamily || '';
const trait = (value) => value ? `<p class="contract-consequence">Favored: ${e(value.label)}${value.why ? ` · ${e(value.why)}` : ''}</p>` : '';
const reason = (value) => value ? `<p class="contract-consequence">${e(value)}</p>` : '';

export function renderMissionSwitcher(view = 'contracts') {
  return `<nav class="mission-switcher" aria-label="Mission views">${[['contracts', 'Contracts'], ['away', 'Away'], ['explore', 'Explore']].map(([id, label]) => `<button type="button" data-act="mission-view" data-view="${id}" aria-pressed="${id === view}">${label}</button>`).join('')}</nav>`;
}

export function renderContractBoard(model = {}) {
  return `<section class="contract-board" aria-label="Contract Board"><h2>Contracts</h2>${(model.offers || []).map((offer) => {
    const label = `${profileLabel(offer)}, ${offer.title}, ${offer.normalFuel}F, ${offer.danger} danger, ${rewardLabel(offer)}`;
    return `<article class="contract-card" data-profile="${e(offer.profile)}">
      <p class="contract-profile"><span aria-hidden="true">${profileIcon(offer)}</span> ${e(profileLabel(offer))}${offer.completed ? ' · ✓ Completed' : ''}</p>
      <h3>${e(offer.title)}</h3><p>${e(offer.brief)}</p>
      <dl class="contract-facts"><div><dt>Normal fuel</dt><dd>${e(offer.normalFuel)}F</dd></div><div><dt>Length</dt><dd>${e(offer.beatLabel || `${offer.beats} beats`)}</dd></div><div><dt>Reward</dt><dd>${e(rewardLabel(offer))}</dd></div><div><dt>Danger</dt><dd>${e(offer.danger)}</dd></div></dl>
      ${trait(offer.favoredTrait)}<button type="button" data-act="contract-review" data-offer="${e(offer.id)}" aria-label="${e(label)}" ${offer.completed || offer.enabled === false ? 'disabled' : ''}>${offer.completed ? 'Completed' : 'Review'}</button>
    </article>`;
  }).join('') || '<p>No contracts available.</p>'}</section>`;
}

export function renderContractReview(model = {}) {
  const offer = model.offer || {};
  return `<div class="modal-backdrop contract-backdrop"><section class="contract-sheet" role="dialog" aria-modal="true" aria-labelledby="contract-review-title">
    <button type="button" class="icon-close" data-act="contract-review-close" aria-label="Close contract review">×</button>
    <p>${e(profileLabel(offer))}</p><h2 id="contract-review-title">${e(offer.title)}</h2>
    <p>${e(offer.brief)}</p><p>Destination: ${e(model.destinationName || offer.destinationName)}</p>
    <dl class="contract-facts"><div><dt>Payable route fuel</dt><dd>${e(model.cost?.fuel)}F</dd></div><div><dt>Expected reward</dt><dd>${e(model.rewardLabel || model.rewardBand?.label)}</dd></div><div><dt>Danger</dt><dd>${e(offer.danger)}</dd></div></dl>
    ${reason(model.consequence)}${trait(model.favoredTrait || offer.favoredTrait)}${reason(model.reason)}
    <p>Accepting spends no fuel. Fuel is spent by route actions.</p>
    <button type="button" class="primary" data-act="contract-accept" data-offer="${e(offer.id)}" ${model.enabled === false || model.ok === false ? 'disabled' : ''}>Accept contract</button>
  </section></div>`;
}

export function renderActiveContract(model = {}) {
  return `<section class="route-stage" data-stage="${e(model.stage)}" aria-label="Active contract">
    <p>${e(model.title)}</p><h2>${e(model.stageLabel || model.stage)}</h2>${reason(model.description)}
    ${model.crewLabel ? `<p>Crew: ${e(model.crewLabel)}</p>` : ''}${trait(model.favoredTrait)}
    ${model.result ? `<p class="contract-consequence">${e(model.result.summary)}</p><p>${e(model.result.rewardLabel)}</p>` : ''}
    ${model.combat ? renderCombatOrders(model.combat) : ''}
    ${(model.actions || []).map((action) => `<div class="route-action">${reason(action.consequence)}${reason(action.reason)}<button type="button" class="${action.primary ? 'primary' : ''}" data-act="contract-action" data-action="${e(action.id)}" data-revision="${e(model.revision)}" ${action.enabled ? '' : 'disabled'}>${e(action.label)}</button></div>`).join('')}
    ${model.abandon ? `<button type="button" class="ghost" data-act="contract-abandon" data-revision="${e(model.revision)}" ${model.abandon.enabled ? '' : 'disabled'}>${e(model.abandon.label)}</button>${reason(model.abandon.consequence)}` : ''}
  </section>`;
}

export function renderCombatOrders(model = {}) {
  return `<section class="combat-orders" aria-label="Combat orders"><h2>${e(model.title || 'Choose an order')}</h2>
    ${model.tell ? `<h3>${e(model.tell.label)}</h3><p class="contract-consequence">${e(model.tell.text || model.tell.sentence)}</p>${reason(model.tell.reason)}` : ''}
    ${(model.orders || []).map((order) => `<article class="order-card">
      <h3>${e(order.name)}${order.recommended ? ' · Recommended' : ''}</h3>
      <p>${e(model.guaranteed ? 'Guaranteed' : order.chanceLabel)} · ${e(order.costLabel)}</p>
      ${reason(order.rewardLabel)}${reason(order.consequence)}${reason(order.reason)}
      <button type="button" data-act="combat-order" data-order="${e(order.id)}" ${order.enabled ? '' : 'disabled'} aria-label="${e(`${order.name}, ${model.guaranteed ? 'Guaranteed' : order.chanceLabel}, ${order.costLabel}, ${order.consequence}`)}">Choose ${e(order.name)}</button>
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
    <div class="party-preview" aria-live="polite"><p>Success chance: ${e(model.chanceLabel)}</p><p>Success: ${e(model.successReward)}</p><p>Failure: ${e(model.failureReward)}</p>${reason(model.injuryRisk)}<p>Returns: ${e(model.returnLabel)}</p>${reason(model.opportunityCost)}${reason(model.reason)}</div>
    <button type="button" class="primary" data-act="exp-launch" data-planet="${e(model.destination?.id)}" ${model.enabled === true ? '' : 'disabled'}>Confirm expedition</button>
  </section></div>`;
}

export function renderDailyPlan(model = {}) {
  if (model.complete || !model.next) return '';
  return `<button type="button" class="daily-plan-chip" data-act="${e(model.next.act)}" aria-label="${e(`${model.completed || 0} of 3 daily milestones, next: ${model.next.label}`)}">${e(model.completed || 0)}/3 · ${e(model.next.label)}</button>`;
}
