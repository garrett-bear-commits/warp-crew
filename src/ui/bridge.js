import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { NODES } from '../data/sectors.js';
import { PLANETS_V1 } from '../systems/expedition.js';
import { ASSISTS } from '../systems/combat.js';

export function renderBridge(root, { player, log, handlers, now = Date.now() }) {
  const fuel = fuelStatus(player, now);
  const loc = NODES[player.location] || { name: player.location };
  const exp = player.activeExpedition;

  root.innerHTML = `
    <div class="panel">
      <h1>Warp Crew</h1>
      <div class="muted">${player.captainName} · ${loc.name}</div>
      <div class="row" style="margin-top:10px">
        <div class="stat">Credits <b>${player.wallet.credits}</b></div>
        <div class="stat">Fuel <b>${fuel.current}/${fuel.max}</b></div>
        <div class="stat">Gems <b style="color:var(--gem)">${player.wallet.gems}</b></div>
        <div class="stat">Medals <b>${player.wallet.medals}</b></div>
        <div class="stat">Rep <b>${player.wallet.reputation}</b></div>
      </div>
      <div class="muted" style="margin-top:8px">
        Fuel regen: ${fuel.ratePerHour}/hr
        ${fuel.isFull ? ' · TANK FULL' : ` · next +1 in ~${formatDuration(Math.max(0, fuel.nextUnitAt - now))}`}
        ${fuel.pendingWhole ? ` · claimable +${fuel.pendingWhole}` : ''}
      </div>
    </div>

    <div class="panel">
      <h2>Bridge Actions</h2>
      <div class="row">
        <button class="primary" data-act="claim">Claim fuel / returns</button>
        <button data-act="travel">Travel</button>
        <button data-act="expedition">Expeditions</button>
        <button data-act="crew">Crew Bay</button>
        <button data-act="gacha">Hire Mercs</button>
        <button data-act="ship">Shipyard</button>
      </div>
    </div>

    <div class="panel">
      <h2>Crew (${player.crew.length}/${player.crewSlots})</h2>
      ${player.crew.map((c) => `
        <div class="crew-card">
          <b>${c.name}</b>
          <span class="tag">${c.role}</span>
          <span class="tag">${c.rarity}</span>
          <span class="tag">Lv ${c.level}</span>
          <span class="tag">${c.status}</span>
          <div class="muted">Power ${c.power}</div>
        </div>
      `).join('') || '<div class="muted">No crew</div>'}
    </div>

    <div class="panel">
      <h2>Ship · ${player.ship.shipId}</h2>
      <div class="muted">Systems: ${Object.entries(player.ship.systems).map(([k,v]) => `${k} ${v}`).join(' · ')}</div>
    </div>

    ${exp ? `
    <div class="panel">
      <h2>Active Expedition</h2>
      <div class="muted">${exp.payload.planetId} · success ${(exp.payload.successChance*100)|0}%</div>
      <div class="muted">Ends in ${formatDuration(Math.max(0, exp.endAt - now))}</div>
      <div class="row" style="margin-top:8px">
        <button data-act="exp-skip">Skip (gems) NYI</button>
        <button class="danger" data-act="exp-abort">Extract early (fail)</button>
      </div>
    </div>` : ''}

    <div class="panel">
      <h2>Captain's Log</h2>
      <div class="log" id="log">${(log || []).slice(-12).map(escapeHtml).join('\n')}</div>
    </div>

    <div class="panel">
      <h2>Debug / QA</h2>
      <div class="row">
        <button data-act="qa-fuel">+5 Fuel</button>
        <button data-act="qa-gems">+100 Gems</button>
        <button data-act="qa-reset">Reset save</button>
      </div>
      <div class="muted" style="margin-top:6px">Assists available: ${Object.values(ASSISTS).map(a=>a.name).join(', ')}</div>
      <div class="muted">Planets: ${PLANETS_V1.map(p=>p.name).join(' · ')}</div>
    </div>
  `;

  root.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onAction(btn.getAttribute('data-act')));
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>');
}
