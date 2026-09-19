import { fuelStatus } from '../systems/fuel.js';
import { formatDuration } from '../shared/timer.js';
import { visibleNodes } from '../data/sectors.js';
import { PLANETS_V1, EXPEDITION_SKIP_GEMS, visiblePlanets } from '../systems/expedition.js';
import { ASSISTS, listAssists } from '../systems/combat.js';
import { storyProgress } from '../systems/story.js';
import { SHIPS } from '../data/ships.js';
import { listOwnedHulls } from '../systems/hangar.js';
import { currentTutorialStep, weekGoals } from '../systems/tutorial.js';
import { readyCrew } from '../systems/player.js';
import { portraitFor, shipArtFor, CUTAWAY_ART, SWARM_ART, ICONS, NODE_ART } from '../data/portraits.js';

const PLANET_CLASS = {
  derelict_freighter: 'a',
  crystal_asteroid: 'b',
  ice_outpost: 'c',
  dustfall: 'd',
  tidefall_ruins: 'b',
  ledger_vault: 'c',
  swarm_husk: 'a',
  echo_shoal: 'b',
  amber_mine: 'c',
  signal_wreck: 'a',
  pirate_cache: 'd',
  aurora_ice: 'b',
};

export function renderApp(root, ctx) {
  const {
    player,
    log,
    tab,
    handlers,
    now = Date.now(),
    pendingCombat = null,
    selectedAssists = [],
    platformStatus = null,
    shopProducts = null,
  } = ctx;
  const fuel = fuelStatus(player, now);
  const locNode = visibleNodes(player, now).find((n) => n.id === player.location);
  const locName = locNode?.name || player.location;
  const hullPct = 100;
  const shieldPct = Math.min(100, 60 + (player.ship.systems?.shields || 1) * 10);
  const step = currentTutorialStep(player);
  const goals = weekGoals(player);

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
          <div class="stat">DAY <b>${goals.careerDay}</b></div>
          <div class="stat">STREAK <b>${player.loginStreak || 0}</b></div>
          <div class="stat"><img class="stat-ico" src="${ICONS.credits}" alt="" />CR <b>${player.wallet.credits}</b></div>
        </div>
      </div>
    </div>

    ${step ? renderTutorialBanner(step) : ''}

    <div class="stat-row" style="margin-bottom:10px">
      <div class="stat"><img class="stat-ico" src="${ICONS.fuel}" alt="" />Fuel <b>${fuel.current}/${fuel.max}</b></div>
      <div class="stat"><img class="stat-ico" src="${ICONS.gems}" alt="" />Gems <b>${player.wallet.gems}</b></div>
      <div class="stat"><img class="stat-ico" src="${ICONS.medals}" alt="" />Medals <b>${player.wallet.medals}</b></div>
      <div class="stat">Rep <b>${player.wallet.reputation}</b></div>
      <div class="stat">${escapeHtml(locName)}</div>
    </div>
    <div class="muted" style="margin:-4px 0 10px">
      Regen ${fuel.ratePerHour}/hr
      ${fuel.isFull ? ' · FULL' : ` · +1 in ${formatDuration(Math.max(0, fuel.nextUnitAt - now))}`}
      ${fuel.pendingWhole ? ` · claim +${fuel.pendingWhole}` : ''}
      · Free pull: ${player.dailyPullAvailable ? 'READY' : 'used'}
      · Expeditions: 15m test
      ${platformStatus ? ` · SDK: ${platformStatus}` : ''}
    </div>

    ${emptyHints(player, fuel, tab)}

    ${pendingCombat ? renderCombatModal(pendingCombat, selectedAssists) : ''}
    ${tab === 'ship' ? renderShip(player, goals) : ''}
    ${tab === 'missions' ? renderMissions(player, now) : ''}
    ${tab === 'crew' ? renderCrew(player) : ''}
    ${tab === 'shop' ? renderShop(player, shopProducts) : ''}
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
    btn.addEventListener('click', () => handlers.onAction(btn.getAttribute('data-act'), { ...btn.dataset }));
  });
  root.querySelectorAll('[data-assist]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.toggleAssist(btn.getAttribute('data-assist')));
  });
}

function renderTutorialBanner(step) {
  return `
    <div class="tutorial-banner panel">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <h2 style="margin:0;color:var(--warn)">Tutorial · ${escapeHtml(step.title)}</h2>
          <div style="font-size:0.85rem;margin-top:6px;line-height:1.35">${escapeHtml(step.body)}</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="primary" data-act="tutorial-jump">Go</button>
        <button data-act="tutorial-next">Next tip</button>
        <button data-act="tutorial-dismiss">Dismiss</button>
      </div>
    </div>
  `;
}

function emptyHints(player, fuel, tab) {
  const bits = [];
  if (fuel.current <= 0 && tab === 'missions') {
    bits.push('No fuel — wait for regen, Claim pending, or buy fuel in SHOP.');
  }
  if (readyCrew(player).length === 0 && tab === 'missions') {
    bits.push('No ready crew — wait for expedition return or hire on CREW.');
  }
  if (player.crew.length < player.crewSlots && player.dailyPullAvailable && tab === 'crew') {
    bits.push(`Free hire ready — fill ${player.crewSlots - player.crew.length} open slot(s).`);
  }
  if (!bits.length) return '';
  return `<div class="empty-hint">${bits.map(escapeHtml).join('<br/>')}</div>`;
}

function renderCombatModal(pending, selectedAssists) {
  const assists = listAssists();
  const assistPower = selectedAssists.reduce((s, id) => s + (ASSISTS[id]?.power || 0), 0);
  return `
    <div class="modal-backdrop">
      <div class="modal panel">
        <div class="combat-head">
          <img class="swarm-art" src="${SWARM_ART}" alt="" />
          <div>
            <h2>Combat · ${escapeHtml(pending.encounter.name)}</h2>
            <div class="muted">${escapeHtml(pending.node.name)} · fuel −${pending.fuelCost}</div>
          </div>
        </div>
        <div class="stat-row" style="margin:10px 0">
          <div class="stat">Your power <b>${pending.playerPower}</b></div>
          <div class="stat">Enemy <b>${pending.encounter.power}</b></div>
          <div class="stat">Assists <b>+${assistPower}</b></div>
        </div>
        <div class="muted" style="margin-bottom:8px">Pick assists (free in v1 — skill expression)</div>
        <div class="row">
          ${assists.map((a) => `
            <button data-assist="${a.id}" class="${selectedAssists.includes(a.id)?'primary':''}">
              ${escapeHtml(a.name)} (+${a.power})
            </button>
          `).join('')}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="primary" data-act="combat-confirm">Engage</button>
          <button data-act="combat-cancel">Abort jump</button>
        </div>
      </div>
    </div>
  `;
}

function renderShip(player, goals) {
  const prog = storyProgress(player);
  const owned = listOwnedHulls(player);
  const shipId = player.ship?.shipId || 'sparrow';
  const def = SHIPS[shipId] || SHIPS.sparrow;
  const goalsDone = goals.goals.filter((g) => g.done).length;
  return `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h1>Warp Crew</h1>
        <button class="primary" data-act="claim">Claim</button>
      </div>
      <div class="muted">${escapeHtml(player.captainName)} · ${escapeHtml(def.name)} · Ch.${prog.chapter} · Story ${prog.done}/${prog.total}</div>
      <div class="ship-frame">
        <img class="ship-cutaway" src="${CUTAWAY_ART}" alt="" />
        <img class="ship-hull" src="${shipArtFor(shipId)}" alt="${escapeHtml(def.name)}" />
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
        <button data-act="goto-missions">Missions / Travel</button>
        <button data-act="ship-upgrade" data-system="quarters">Expand quarters</button>
        <button data-act="ship-upgrade" data-system="shields">Upgrade shields</button>
        <button data-act="ship-upgrade" data-system="weapons">Upgrade weapons</button>
      </div>
    </div>

    <div class="panel">
      <h2>Week goals · Day ${goals.careerDay}</h2>
      <div class="muted">${goalsDone}/${goals.goals.length} complete — soft targets for the test week</div>
      ${goals.goals.map((g) => `
        <div class="crew-card ${g.done ? 'goal-done' : ''}">
          <b>${g.done ? '✓' : '○'} ${escapeHtml(g.label)}</b>
          <span class="tag">${escapeHtml(g.progress)}</span>
        </div>
      `).join('')}
    </div>

    <div class="panel">
      <h2>Hangar</h2>
      <div class="muted">Buy larger hulls with credits (grind) or gems (fast). Owned: ${owned.join(', ')}</div>
      ${Object.values(SHIPS).map((s) => {
        const isOwned = owned.includes(s.id);
        const isActive = shipId === s.id;
        return `
        <div class="mission-card">
          <img class="ship-thumb" src="${shipArtFor(s.id)}" alt="" />
          <div>
            <b>${escapeHtml(s.name)}${isActive ? ' · ACTIVE' : isOwned ? ' · OWNED' : ''}</b>
            <div class="muted">${escapeHtml(s.blurb)}</div>
            <div class="muted">Crew ${s.crewSlots}–${s.maxCrewSlots}
              ${s.gemPrice ? ` · ${s.gemPrice}g` : ''}
              ${s.creditPrice ? ` · ${s.creditPrice}cr` : ''}
              ${s.lockedUntilChapter ? ` · Ch.${s.lockedUntilChapter}+` : ''}
            </div>
          </div>
          <div class="row" style="flex-direction:column;gap:4px">
            ${isActive ? '<button disabled>Active</button>' : isOwned
              ? `<button data-act="hull-switch" data-ship="${s.id}">Switch</button>`
              : s.id === 'sparrow' ? '<button disabled>Starter</button>' : `
                <button class="primary" data-act="hull-buy" data-ship="${s.id}" data-currency="gems">Gems</button>
                <button data-act="hull-buy" data-ship="${s.id}" data-currency="credits">Credits</button>
              `}
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="panel">
      <h2>Story · Eclipse Swarm</h2>
      <div class="muted">Travel story nodes to unlock beats. Chapter ${prog.chapter}.</div>
      ${prog.beats.map((b) => `
        <div class="crew-card">
          <b>${b.unlocked ? '✓' : '○'} ${escapeHtml(b.title)}</b>
          <span class="tag">Ch.${b.chapter}</span>
          <div class="muted">${b.unlocked ? escapeHtml(b.text) : '???'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function crewInRole(player, role) {
  const c = player.crew.find((x) => x.role === role && x.status !== 'expedition');
  return c ? escapeHtml(c.name) : '— empty —';
}

function renderMissions(player, now) {
  const exp = player.activeExpedition;
  const here = player.location;
  const nodes = visibleNodes(player, now);
  const planets = visiblePlanets(player, now);

  return `
    <div class="panel">
      <h2>Star map</h2>
      <div class="muted">Unlocked routes for your career day. Combat jumps open the assist picker. Veil Edge unlocks after Veil Gate.</div>
      ${nodes.length === 0 ? '<div class="empty-hint">No routes — something is wrong with map data.</div>' : ''}
      <div class="map-grid">
        ${nodes.map((n) => {
          const hereCls = n.id === here ? 'here' : '';
          const cost = n.fuelCost ?? 0;
          return `
            <button class="map-node ${hereCls}" data-act="travel-to" data-node="${n.id}"
              ${n.id === here ? 'disabled' : ''}>
              <span class="map-title">${escapeHtml(n.name)}</span>
              <span class="map-meta">${n.type} · ${cost}F${n.sector === 'veil' ? ' · Veil' : ''}</span>
              <span class="map-blurb">${escapeHtml(n.blurb || '')}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>

    <div class="panel">
      <h2>Expeditions</h2>
      <div class="muted">15 min test timers · gem skip ${EXPEDITION_SKIP_GEMS}g · more sites unlock by career day</div>
      ${exp ? `
        <div class="mission-card" style="margin-top:10px;border-color:var(--cyan)">
          <img class="planet-art" src="${NODE_ART[PLANET_CLASS[exp.payload.planetId] || 'a']}" alt="" />
          <div>
            <b>ACTIVE · ${escapeHtml(planetName(exp.payload.planetId))}</b>
            <div class="muted">${(exp.payload.successChance*100)|0}% · ${formatDuration(Math.max(0, exp.endAt - now))} left</div>
          </div>
          <div class="row" style="flex-direction:column;gap:6px">
            <button data-act="exp-claim">Claim</button>
            <button class="primary" data-act="exp-skip">Skip ${EXPEDITION_SKIP_GEMS}g</button>
            <button class="danger" data-act="exp-abort">Extract</button>
          </div>
        </div>
      ` : planets.map((p) => `
        <div class="mission-card">
          <img class="planet-art" src="${NODE_ART[PLANET_CLASS[p.id] || 'a']}" alt="" />
          <div>
            <b>${escapeHtml(p.name)}</b>
            <div class="muted">${escapeHtml(p.blurb)}</div>
            <div class="muted">Diff ${p.difficulty} · ${p.minutes}m</div>
          </div>
          <button class="primary" data-act="exp-start" data-planet="${p.id}">Launch</button>
        </div>
      `).join('')}
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
        <button class="primary" data-act="gacha">
          ${player.dailyPullAvailable ? 'Free hire' : 'Hire 500cr'}
        </button>
      </div>
      ${player.tutorial?.slot3Unlocked && player.crewSlots >= 3 && player.crew.length < 3
        ? '<div class="empty-hint">Slot 3 open — Free hire a third merc.</div>'
        : ''}
      ${player.crew.map((c) => `
        <div class="crew-card">
          <img class="portrait" src="${portraitFor(c.templateId, c.role)}" alt="" width="64" height="64" />
          <div class="crew-body">
            <b>${escapeHtml(c.name)}</b>
            <span class="tag">${escapeHtml(c.role)}</span>
            <span class="tag">${escapeHtml(c.rarity)}</span>
            <span class="tag">Lv ${c.level}</span>
            <span class="tag">${escapeHtml(c.status)}</span>
            <div class="muted">Power ${c.power} · ${escapeHtml(c.species)}</div>
            <div class="muted">${escapeHtml(c.blurb || '')}</div>
            <button data-act="level-crew" data-id="${c.instanceId}">Level up (medals)</button>
          </div>
        </div>
      `).join('') || '<div class="empty-hint">No crew — hire from the gacha.</div>'}
    </div>
  `;
}

function renderShop(player, shopProducts) {
  const products = shopProducts || [
    { sku: 'wc_fuel_5', name: 'Fuel Cell ×5', blurb: '+5 fuel' },
    { sku: 'wc_gems_100', name: 'Gem Pack 100', blurb: '+100 gems' },
    { sku: 'wc_starter', name: 'Starter Pack', blurb: 'Fuel + gems + medals' },
  ];
  const planets = ['b', 'c', 'a', 'd'];
  return `
    <div class="panel">
      <h2>Shop</h2>
      <div class="muted">Mock IAP for QA (not on Jest yet). Real Jest payments later.</div>
      ${products.map((p, i) => `
        <div class="mission-card">
          <img class="planet-art" src="${NODE_ART[planets[i % planets.length]]}" alt="" />
          <div>
            <b>${escapeHtml(p.name)}</b>
            <div class="muted">${escapeHtml(p.blurb || p.remoteName || p.sku)}</div>
            <div class="muted">${p.price != null ? `${p.price} ${p.currency || 'USD'}` : 'sandbox'}</div>
          </div>
          <button class="primary" data-act="iap-buy" data-sku="${p.sku}">Buy</button>
        </div>
      `).join('')}
      <div class="row" style="margin-top:8px">
        <button data-act="prompt-login">Register / Login</button>
        <button data-act="qa-gems">QA +100 gems</button>
        <button data-act="qa-fuel">QA +5 Fuel</button>
      </div>
      <button class="danger" data-act="qa-reset" style="margin-top:8px">Reset save</button>
    </div>
  `;
}

function renderLog(log) {
  return `
    <div class="panel">
      <h2>Captain's Log</h2>
      <div class="log">${(log || []).slice(-24).map(escapeHtml).join('\n') || 'No entries.'}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"');
}
