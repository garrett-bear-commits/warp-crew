// @ts-nocheck
/** Event cards (FTL-lite phase 3): travel events, their results, and contract route events. */

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { trade: 'Market', delivery: 'Delivery', salvage: 'Salvage', story: 'Signal' };
const ROUTE_REASON = { not_enough_fuel: 'Not enough fuel', no_ready_crew: 'No ready crew', hull_critical: 'Hull critical: repair first' };

function odds(list) {
  if (list.length === 1) return `<p class="event-stakes${list[0].risky ? ' is-risky' : ''}"><b>Sure</b> ${e(list[0].summary)}</p>`;
  return `<ul class="event-odds">${list.map(item => `<li class="${item.risky ? 'is-risky' : ''}"><b>${e(item.pct)}%</b> ${e(item.summary)}</li>`).join('')}</ul>`;
}

function choiceBlock(choice, eventId) {
  const who = choice.tag ? `<span class="event-tag">${e(choice.tag)}${choice.doer ? ` · ${e(choice.doer)}` : ''}</span>` : '';
  return `<div class="event-choice${choice.available ? '' : ' is-unavailable'}">
    <button type="button" class="${choice.available ? 'primary' : ''}" data-act="event-choose" data-event-id="${e(eventId)}" data-choice="${e(choice.id)}" ${choice.available ? '' : 'disabled'}>
      ${who}<span class="event-label">${e(choice.label)}</span>${choice.cost ? `<span class="event-cost">${e(choice.cost)}</span>` : ''}
    </button>
    ${odds(choice.odds)}
    ${choice.reason ? `<p class="event-reason">${e(choice.reason)}</p>` : ''}
  </div>`;
}

/** Saved, unresolved travel event. */
export function renderEventCard(view, { hint = false } = {}) {
  if (!view) return '';
  return `<div class="modal-backdrop contract-backdrop event-backdrop"><section class="contract-sheet event-card" role="dialog" aria-modal="true" aria-labelledby="event-title">
    <p class="event-kicker">${e(KIND[view.kind] || 'Event')} · ${e(view.nodeName)} · ${e(view.sectorName)}</p>
    <h2 id="event-title">${e(view.title)}</h2>
    <p class="event-text">${e(view.text)}</p>
    ${hint ? '<p class="event-hint">Tip: a choice tagged with a role uses that crew member\'s skill, and the odds already count it.</p>' : ''}
    <div class="event-choices">${view.choices.map(choice => choiceBlock(choice, view.eventId)).join('')}</div>
  </section></div>`;
}

/** What just happened (UI only: the payout is already saved). */
export function renderEventResult(result) {
  if (!result) return '';
  const bits = [result.rewardLabel ? `+ ${result.rewardLabel}` : '', result.hullLoss ? `−${result.hullLoss} hull` : '',
    result.injured ? `${result.injured} injured` : '', result.hired ? `${result.hired} joins the crew` : ''].filter(Boolean);
  return `<div class="modal-backdrop contract-backdrop event-backdrop"><section class="contract-sheet event-card event-result" role="dialog" aria-modal="true" aria-labelledby="event-result-title">
    <p class="event-kicker">${e(result.nodeName)} · ${e(result.choiceLabel)}</p>
    <h2 id="event-result-title">${e(result.title)}</h2>
    <p class="event-text">${e(result.text)}</p>
    ${result.beat ? `<p class="event-beat"><b>${e(result.beat.title)}</b> ${e(result.beat.text)}</p>` : ''}
    ${bits.length ? `<p class="event-payout">${bits.map(e).join(' · ')}</p>` : '<p class="event-payout">Nothing gained.</p>'}
    <button type="button" class="primary" data-act="event-dismiss">Continue</button>
  </section></div>`;
}

/** Contract route event, replacing "Signal ahead": two choices bound to secure and push. */
export function renderRouteEvent(view, { revision, acceptanceId, actions = [] } = {}) {
  const fallback = { title: 'Signal ahead', text: 'Something on the route. What should the crew do?',
    choices: actions.filter(action => action.id === 'secure' || action.id === 'push').map(action => ({ id: null, route: action.id, label: action.label, enabled: action.enabled })) };
  const model = view || fallback;
  return `<aside class="first-session-cue route-choice route-event" aria-label="Route choice">
    <p class="event-kicker">Route event</p>
    <b class="route-event-title">${e(model.title)}</b>
    <p>${e(model.text)}</p>
    ${model.choices.map(choice => `<div class="route-event-choice">
      <button type="button" class="${choice.route === 'push' ? 'primary' : ''}" data-act="contract-action" data-action="${e(choice.route)}"${choice.id ? ` data-choice="${e(choice.id)}"` : ''} data-revision="${e(revision)}" data-acceptance-id="${e(acceptanceId)}" ${choice.enabled ? '' : 'disabled'}>${e(choice.label)}${choice.fuel != null ? ` · ${e(choice.fuel)}F` : ''}</button>
      ${choice.stakes ? `<small class="${choice.fight ? 'is-risky' : ''}">${e(choice.stakes)}</small>` : ''}
      ${choice.reason ? `<small class="event-reason">${e(ROUTE_REASON[choice.reason] || 'Not available right now')}</small>` : ''}
    </div>`).join('')}
  </aside>`;
}
