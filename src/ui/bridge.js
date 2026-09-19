import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { NODES } from '../data/sectors.js';
import { PLANETS_V1 } from '../systems/expedition.js';
import { ASSISTS } from '../systems/combat.js';

const PLANET_CLASS = {
  derelict_freighter: 'a',
  crystal_asteroid: 'b',
  ice_outpost: 'c',
  dustfall: 'd',
};

export function renderApp(root, ctx) {
  const { player, log, tab, handlers, now = Date.now() } = ctx;
  const fuel = fuelStatus(player, now);
  const loc = NODES[player.location] || { name: player.location };
  const hullPct = 100; // v1 full; combat injury later
  const shieldPct = Math.min(100, 60 + (player.ship.systems?.shields || 1) * 10);

  root.innerHTML = `
    <div class="topbar">
      <div class="bar-card">
        <div class="meter-label"><span>HULL</span><span>${hullPct}%</span></div>
        <div class="meter hull"><span style="width:${hullPct}%"></span></div>
        <div class="meter-label" style="margin-top:8px"><span>SHIELD</span><span>${shieldPct}%</span></div>
        <div class="meter shield"><span style="width:${shieldPct}%"></span></div>
      </div>
      <div class="bar-card">
        <div class="muted">OBJECTIVE</div>
        <div style="font-size:0.8rem;margin-top:4px;line-height:1.3">
          ${player.story?.eclipseIntro
            ? 'Push back Eclipse Swarm pressure on Hope’s Rest.'
            : 'Investigate Spur traffic and grow your reputation.'}
        </div>
        <div class="stat-row">
          <div class="stat">DAY <b>${dayNumber(player)}</b></div>
          <div class="stat">CR <b>${player.wallet.credits}</b></div>
        </div>
      </div>
    </div>

    <div class="stat-row" style="margin-bottom:10px">
      <div class="stat">Fuel <b>${fuel.current}/${fuel.max}</b></div>
      <div class="stat">Gems <b style="color:var(--gem)">${player.wallet.gems}</b></div>
      <div class="stat">Medals <b>${player.wallet.medals}</b></div>
      <div class="stat">Rep <b>${player.wallet.reputation}</b></div>
      <div class="stat">${loc.name}</div>
    </div>
    <div class="muted" style="margin:-4px 0 10px">
      Regen ${fuel.ratePerHour}/hr
      ${fuel.isFull ? ' · FULL' : ` · +1 in ${formatDuration(Math.max(0, fuel.nextUnitAt - now))}`}
      ${fuel.pendingWhole ? ` · claim +${fuel.pendingWhole}` : ''}
      · Expeditions: 15m test cadence
    </div>

    ${tab === 'ship' ? renderShip(player) : ''}
    ${tab === 'missions' ? renderMissions(player, now) : ''}
    ${tab === 'crew' ? renderCrew(player) : ''}
    ${tab === 'shop' ? renderShop(player) : ''}
    ${tab === 'log' ? renderLog(log) : ''}

    <nav class="bottom-nav">
      <button data-tab="ship" class="${tab==='ship'?'active':''}">SHIP</button>
      <button data-tab="crew" class="${tab==='crew'?'active':''}">CREW</button>
      <button data-tab="missions" class="${tab==='missions'?'active':''}">MISSIONS</button>
      <button data-tab="shop" class="${tab==='shop'?'active':''}">SHOP</button>
      <button data-tab="log" class="${tab==='log'?'active':''}">LOG</button>
    </nav>
  `;

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.setTab(btn.getAttribute('data-tab')));
  });
  root.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onAction(btn.getAttribute('data-act'), btn.dataset));
  });
}

function dayNumber(player) {
  const ms = Date.now() - (player.createdAt || Date.now());
  return 1 + Math.floor(ms / 86400000);
}

function renderShip(player) {
  return `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h1>Warp Crew</h1>
        <button class="primary" data-act="claim">Claim</button>
      </div>
      <div class="muted">${player.captainName} · ${player.ship.shipId.toUpperCase()}</div>
      <div class="ship-frame">
        <div class="ship-silhouette" title="Sparrow schematic"></div>
        <div class="room-grid">
          <div class="room"><b>BRIDGE</b>${crewInRole(player,'pilot')}</div>
          <div class="room"><b>WEAPONS</b>${crewInRole(player,'gunner')}</div>
          <div class="room"><b>ENGINEERING</b>${crewInRole(player,'engineer')}</div>
          <div class="room"><b>MEDBAY</b>${crewInRole(player,'medic')}</div>
          <div class="room"><b>CARGO</b>Lv ${player.ship.systems?.cargo || 1}</div>
          <div class="room"><b>QUARTERS</b>${player.crew.length}/${player.crewSlots}</div>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <button data-act="travel">Travel (fuel)</button>
        <button data-act="ship-upgrade">Expand quarters</button>
        <button data-act="qa-fuel">QA +5 Fuel</button>
      </div>
    </div>
  `;
}

function crewInRole(player, role) {
  const c = player.crew.find((x) => x.role === role && x.status !== 'expedition');
  return c ? c.name : '— empty —';
}

function renderMissions(player, now) {
  const exp = player.activeExpedition;
  return `
    <div class="panel">
      <h2>Missions</h2>
      <div class="muted">Planetary expeditions · 15 min test timers · success % shown</div>
      ${exp ? `
        <div class="mission-card" style="margin-top:10px;border-color:var(--cyan)">
          <div class="planet ${PLANET_CLASS[exp.payload.planetId] || 'a'}"></div>
          <div>
            <b>ACTIVE · ${planetName(exp.payload.planetId)}</b>
            <div class="muted">${(exp.payload.successChance*100)|0}% · ${formatDuration(Math.max(0, exp.endAt - now))} left</div>
          </div>
          <div class="row">
            <button data-act="exp-claim">Claim</button>
            <button class="danger" data-act="exp-abort">Extract</button>
          </div>
        </div>
      ` : PLANETS_V1.map((p, i) => `
        <div class="mission-card">
          <div class="planet ${PLANET_CLASS[p.id] || 'a'}"></div>
          <div>
            <b>${p.name}</b>
            <div class="muted">${p.blurb}</div>
            <div class="muted">Diff ${p.difficulty} · ${p.minutes}m</div>
          </div>
          <button class="primary" data-act="exp-start" data-planet="${p.id}">Launch</button>
        </div>
      `).join('')}
    </div>
    <div class="panel">
      <h2>Travel lanes</h2>
      <div class="muted">Spend fuel to jump. Outcomes: trade, combat, story, salvage.</div>
      <div class="row" style="margin-top:8px">
        ${Object.values(NODES).filter(n=>n.id!==player.location).map(n => `
          <button data-act="travel-to" data-node="${n.id}">${n.name} (${n.fuelCost}F)</button>
        `).join('')}
      </div>
    </div>
  `;
}

function planetName(id) {
  return PLANETS_V1.find((p) => p.id === id)?.name || id;
}

function renderCrew(player) {
  return `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2>Crew Bay · ${player.crew.length}/${player.crewSlots}</h2>
        <button class="primary" data-act="gacha">Hire (gacha)</button>
      </div>
      ${player.crew.map((c) => `
        <div class="crew-card">
          <b>${c.name}</b>
          <span class="tag">${c.role}</span>
          <span class="tag">${c.rarity}</span>
          <span class="tag">Lv ${c.level}</span>
          <span class="tag">${c.status}</span>
          <div class="muted">Power ${c.power} · ${c.species}</div>
          <button data-act="level-crew" data-id="${c.instanceId}" style="margin-top:6px">Level up (medals)</button>
        </div>
      `).join('') || '<div class="muted">No crew</div>'}
      <div class="muted" style="margin-top:8px">Assists: ${Object.values(ASSISTS).map(a=>a.name).join(' · ')}</div>
    </div>
  `;
}

function renderShop(player) {
  return `
    <div class="panel">
      <h2>Shop · Jest IAP (stub)</h2>
      <div class="mission-card">
        <div class="planet b"></div>
        <div>
          <b>Starter Pack</b>
          <div class="muted">Fuel + gems + rare merc teaser</div>
        </div>
        <button data-act="qa-gems">QA +100 gems</button>
      </div>
      <div class="mission-card">
        <div class="planet c"></div>
        <div>
          <b>Fuel Cell ×5</b>
          <div class="muted">Instant fuel for testing</div>
        </div>
        <button data-act="qa-fuel">+5 Fuel</button>
      </div>
      <div class="mission-card">
        <div class="planet a"></div>
        <div>
          <b>Corvette (soon)</b>
          <div class="muted">6 crew slots · gems or long credit grind</div>
        </div>
        <button disabled>Locked</button>
      </div>
      <button class="danger" data-act="qa-reset">Reset save</button>
    </div>
  `;
}

function renderLog(log) {
  return `
    <div class="panel">
      <h2>Captain's Log</h2>
      <div class="log">${(log || []).slice(-20).map(escapeHtml).join('\n') || 'No entries.'}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replaceAll('&','&').replaceAll('<','<').replaceAll('>','>');
}
