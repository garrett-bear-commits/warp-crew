/** Isolated Chrome DevTools Protocol QA of script-5 first play and saved script 4. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createNewPlayer } from '../src/systems/player.js';
import { prepareSession, sessionAction } from '../src/systems/sessionLoop.js';
import { routeToWorkAnchor } from '../src/data/shipRoutes.js';
import { SPARROW_LAYOUT } from '../src/data/starterShip.js';

const cdpUrl = process.env.QA_CDP || 'http://127.0.0.1:9342';
const pageUrl = process.env.QA_URL || 'http://127.0.0.1:4173/?fresh=1';
const sourceCommit = process.env.QA_SOURCE_COMMIT;
const captureDir = new URL('../.superpowers/sdd/2026-09-24-captain-first-play-combat/captures/', import.meta.url);
await mkdir(captureDir, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function verifyBuild() {
  assert.match(sourceCommit || '', /^[0-9a-f]{40}$/, 'QA_SOURCE_COMMIT must be an exact 40-character source commit');
  assert.equal(git('rev-parse', '--verify', `${sourceCommit}^{commit}`), sourceCommit, 'source commit does not resolve');
  const builtPaths = ['src', 'public', 'index.html', 'package.json', 'vite.config.js'];
  assert.equal(git('diff', '--name-only', sourceCommit, '--', ...builtPaths), '', 'production source differs from QA_SOURCE_COMMIT');
  const buildOutput = execFileSync('npm', ['run', 'build:pages'], { encoding: 'utf8' });
  assert.match(buildOutput, /built in /, 'Pages build did not complete');
  const localIndex = await readFile(new URL('../dist/index.html', import.meta.url));
  const indexText = localIndex.toString('utf8');
  const jsPath = indexText.match(/<script type="module"[^>]+src="([^"]+\.js)"/)?.[1];
  const cssPath = indexText.match(/<link rel="stylesheet"[^>]+href="([^"]+\.css)"/)?.[1];
  assert.ok(jsPath && cssPath, 'Pages index must identify its JS and CSS assets');
  const assets = [{ path: 'index.html', local: new URL('../dist/index.html', import.meta.url), served: new URL(pageUrl) },
    ...[jsPath, cssPath].map(path => ({ path, local: new URL(path, new URL('../dist/', import.meta.url)), served: new URL(path, pageUrl) }))];
  const hashes = [];
  for (const asset of assets) {
    const localBytes = await readFile(asset.local);
    const response = await fetch(asset.served);
    assert.equal(response.status, 200, `served ${asset.path} missing`);
    const servedBytes = Buffer.from(await response.arrayBuffer());
    const localHash = sha256(localBytes);
    const servedHash = sha256(servedBytes);
    assert.equal(servedHash, localHash, `served ${asset.path} differs from freshly built dist`);
    hashes.push({ path: asset.path, servedUrl: asset.served.href, sha256: localHash, bytes: localBytes.length });
  }
  return { sourceCommit, buildCommand: 'npm run build:pages', assets: hashes };
}

const provenance = await verifyBuild();
const browser = await (await fetch(`${cdpUrl}/json/version`)).json();
const report = { browser: browser.Browser, pageUrl, provenance, screens: [], checks: {} };
const arrivalRoute = routeToWorkAnchor(SPARROW_LAYOUT.anchors.airlock, 'workshop');
assert.equal(arrivalRoute.ok, true, 'first hire must have a walkable airlock-to-workshop route');
assert.ok(arrivalRoute.points.some(point => point.via === 'door-enter' && point.room === 'workshop'), 'first hire route must enter the workshop through its door');
report.checks.crewRoute = { start: SPARROW_LAYOUT.anchors.airlock, end: arrivalRoute.points.at(-1),
  waypoints: arrivalRoute.points.length, doors: arrivalRoute.points.filter(point => point.via),
  points: arrivalRoute.points.map(point => ({ x: point.x, y: point.y, room: point.room || 'hall', via: point.via || null })) };

async function openPage(width, height, reduced = false) {
  const target = await (await fetch(`${cdpUrl}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  let serial = 0;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, timeoutMs = 15000) => {
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += 100) {
      try { if (await evaluate(expression)) return; } catch { /* Hydration may still be running. */ }
      await wait(100);
    }
    const diagnosis = await evaluate(`(() => ({ text: document.body.innerText.slice(0, 700),
      actions: [...document.querySelectorAll('[data-act]')].map(el => [el.dataset.act, el.dataset.action]),
      contract: JSON.parse(localStorage.getItem('warpcrew.save.v2') || '{}').player?.activeContract?.stage,
      encounter: JSON.parse(localStorage.getItem('warpcrew.save.v2') || '{}').player?.activeEncounter?.result }))()`);
    throw new Error(`Timed out waiting for ${expression}; screen: ${JSON.stringify(diagnosis)}`);
  };
  const click = async selector => {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el.disabled) throw Error('disabled: ' + el.outerHTML);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw Error('occluded: ' + el.outerHTML + ' by ' + hit?.outerHTML);
      return { x, y, width: r.width, height: r.height };
    })()`);
    assert.ok(point.width >= 44 && point.height >= 44, `${selector}: touch target below 44px`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await wait(150);
  };
  const capture = async label => {
    const filename = `captain-${width}x${height}${reduced ? '-reduced' : ''}-${label}.png`;
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(filename, captureDir), Buffer.from(screenshot.data, 'base64'));
    const metrics = await evaluate(`(() => ({ width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      tutorial: document.querySelector('.wc-shell')?.dataset.phase,
      cameraScale: document.querySelector('#app')?._wcCamera?.scale || null,
      splash: document.querySelector('.splash-scene img')?.getAttribute('src') || null,
      artLoaded: document.querySelector('.splash-scene img')?.naturalWidth || null,
      images: [...document.querySelectorAll('img')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height; }).map(el => ({ src: el.getAttribute('src'), naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, displayWidth: Math.round(el.getBoundingClientRect().width) })),
      visualViewport: { width: Math.round(window.visualViewport?.width || innerWidth), height: Math.round(window.visualViewport?.height || innerHeight) },
      safeAreaInsets: (() => { const el = document.createElement('div'); el.style.cssText = 'position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.append(el); const s = getComputedStyle(el); const insets = { top: parseFloat(s.paddingTop), right: parseFloat(s.paddingRight), bottom: parseFloat(s.paddingBottom), left: parseFloat(s.paddingLeft) }; el.remove(); return insets; })(),
      primaryRect: (() => { const r = document.querySelector('[data-primary-pulse]')?.getBoundingClientRect(); return r && { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; })(),
      spotlight: (() => { const el = document.querySelector('.first-session-spotlight'); const target = el?.querySelector('[data-spotlight-target]'); if (!el || !target) return null; const r = target.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const scrim = getComputedStyle(el, '::before'); return { targetHit: hit === target || target.contains(hit), targetZ: getComputedStyle(target).zIndex, scrimZ: scrim.zIndex, scrimPointerEvents: scrim.pointerEvents, scrimPosition: scrim.position, scrimInset: [scrim.top, scrim.right, scrim.bottom, scrim.left] }; })(),
      bottomNav: (() => { const r = document.querySelector('.bottom-nav')?.getBoundingClientRect(); return r && { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })(),
      activeDialog: (() => { const r = document.querySelector('[role="dialog"]')?.getBoundingClientRect(); return r && { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; })(),
      visibleButtons: [...document.querySelectorAll('button')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height && getComputedStyle(el).visibility !== 'hidden'; }).map(el => ({ label: (el.innerText || el.ariaLabel || '').trim().slice(0, 40), action: el.dataset.act || null, disabled: el.disabled, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) })),
      requiredText: [...document.querySelectorAll('.v5-modal p, .v5-modal label, .first-session-cue p, .encounter-threat, .target-caption, .contract-consequence')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height; }).map(el => ({ text: el.innerText.trim().slice(0, 80), fontSize: parseFloat(getComputedStyle(el).fontSize), instruction: el.matches('.first-session-cue p, .encounter-threat') })),
      primaryPulses: document.querySelectorAll('[data-primary-pulse]').length,
      pulseAnimations: [...document.querySelectorAll('[data-primary-pulse]')].map(el => getComputedStyle(el).animationName),
      badges: [...document.querySelectorAll('.attention-dot, .nav-badge, [data-attention]')].map(el => el.outerHTML.slice(0, 160)),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      save: (() => { const p = JSON.parse(localStorage.getItem('warpcrew.save.v2') || '{}').player; return p && { script: p.tutorial?.script, phase: p.tutorial?.phase, crew: p.crew?.map(c => ({ id: c.templateId, name: c.name, captain: c.isCaptain, rarity: c.rarity })), credits: p.wallet?.credits, fuel: p.wallet?.fuel, pulls: p.gacha?.pulls, contract: p.activeContract?.stage, encounterVersion: p.activeEncounter?.version, encounterResult: p.activeEncounter?.result, hull: p.activeEncounter?.hull, shield: p.activeEncounter?.shield, enemyHull: p.activeEncounter?.enemy?.hull, targetUsed: p.activeEncounter?.orders?.targetWeapons?.used, braceUsed: p.activeEncounter?.orders?.brace?.used }; })(),
      text: document.body.innerText.slice(0, 500) }))()`);
    assert.ok(metrics.scrollWidth <= width, `${label}: horizontal overflow ${metrics.scrollWidth}>${width}`);
    assert.equal(metrics.reducedMotion, reduced, `${label}: media emulation mismatch`);
    assert.ok(metrics.primaryPulses <= 1, `${label}: more than one pulsing primary action`);
    if (reduced) assert.ok(metrics.pulseAnimations.every(name => name === 'none'), `${label}: animated primary cue under reduced motion`);
    assert.ok(metrics.visibleButtons.every(button => button.disabled || (button.width >= 44 && button.height >= 44)), `${label}: enabled button below 44px`);
    assert.ok(metrics.requiredText.every(item => item.fontSize >= 16), `${label}: required text below 16px`);
    assert.ok(metrics.requiredText.filter(item => item.instruction).every(item => item.fontSize >= 18), `${label}: instruction text below 18px`);
    if (metrics.spotlight) {
      assert.equal(metrics.spotlight.targetHit, true, `${label}: spotlight action is occluded`);
      assert.equal(metrics.spotlight.scrimPointerEvents, 'auto', `${label}: spotlight background is not intercepted`);
      assert.equal(metrics.spotlight.scrimPosition, 'fixed', `${label}: spotlight scrim is not viewport-bound`);
    }
    report.screens.push({ label, filename, reduced, ...metrics });
    return metrics;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await send('Page.navigate', { url: pageUrl });
  const close = async () => { ws.close(); await fetch(`${cdpUrl}/json/close/${target.id}`); };
  return { evaluate, until, click, capture, send, close };
}

async function play(width, height, reduced = false) {
  const page = await openPage(width, height, reduced);
  const key = `${width}x${height}${reduced ? '-reduced' : ''}`;
  const sessionStarted = Date.now();
  try {
    await page.until('Boolean(document.querySelector(\'[data-act="splash-dismiss"]:not([disabled])\'))');
    const splash = await page.capture('splash');
    assert.match(splash.splash, /splash-five-crew-v3\.png$/);
    assert.equal(splash.artLoaded, 941);
    if (splash.save) {
      assert.equal(splash.save.script, 5);
      assert.equal(splash.save.crew.length, 0);
    }
    const freshUrl = await page.evaluate('location.href');
    assert.equal(new URL(freshUrl).searchParams.has('fresh'), false, 'fresh=1 must be removed after its one clear');
    await page.click('[data-act="splash-dismiss"]');
    await page.until('Boolean(document.querySelector(\'[data-act="captain-choose"]\'))');
    const captain = await page.capture('captain');
    assert.equal(captain.save.script, 5);
    assert.equal(captain.save.crew.length, 0);
    assert.equal(captain.save.phase, 'captain');
    assert.equal(await page.evaluate('document.querySelectorAll("[data-captain-option]").length'), 4);
    await page.click('[data-captain-option="captain_alien"]');
    await page.evaluate('document.querySelector("[data-captain-name]").value = "QA Aster"');
    await page.click('[data-act="captain-choose"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-first-hire"]\'))');
    const hire = await page.capture('hire');
    assert.equal(hire.save.crew.length, 1);
    assert.equal(hire.save.crew[0].id, 'captain_alien');
    assert.equal(hire.save.crew[0].name, 'QA Aster');
    await page.click('[data-act="tutorial-first-hire"]');
    await page.until('Boolean(document.querySelector(\'.first-session-cue [data-act="station-assign"][data-station="weapons"]\'))');
    const assign = await page.capture('assign');
    assert.equal(assign.save.crew.length, 2);
    assert.equal(assign.save.crew[1].id, 'merc_jen');
    if (width === 390 && !reduced) {
      await wait(800);
      await page.capture('arrival-mid');
      await wait(1400);
      await page.capture('arrival-door');
      await wait(1800);
      await page.capture('arrival-workstation');
    }
    const introReloadUrl = await page.evaluate('location.href');
    assert.equal(new URL(introReloadUrl).searchParams.has('fresh'), false, 'intro refresh must not repeat fresh clear');
    await page.send('Page.navigate', { url: introReloadUrl });
    await page.until('Boolean(document.querySelector(\'.first-session-cue [data-act="station-assign"][data-station="weapons"]\'))');
    const introReload = await page.capture('assign-reload');
    assert.equal(introReload.save.phase, 'assign');
    assert.equal(introReload.save.crew.length, 2);
    assert.equal(introReload.save.crew.filter(c => c.captain).length, 1);
    assert.equal(introReload.save.crew[0].name, 'QA Aster');
    await page.click('.first-session-cue [data-act="station-assign"][data-station="weapons"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-fight-start"]\'))');
    const distress = await page.capture('distress');
    assert.equal(distress.spotlight?.targetHit, true);
    if (width === 390 && !reduced) {
      const before = await page.evaluate(`(() => { const x = 24, y = Math.round(innerHeight * 0.35); const hit = document.elementFromPoint(x, y); return { x, y, hit: hit?.tagName || null, hitClass: typeof hit?.className === 'string' ? hit.className : null, intercepted: Boolean(hit?.closest('.first-session-spotlight')), expanded: document.querySelector('[data-camera="toggle"]')?.getAttribute('aria-expanded') }; })()`);
      assert.equal(before.intercepted, true, 'viewport background click must hit spotlight scrim');
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x, y: before.y, button: 'left', clickCount: 1 });
      const after = await page.evaluate(`(() => ({ expanded: document.querySelector('[data-camera="toggle"]').getAttribute('aria-expanded'), phase: JSON.parse(localStorage.getItem('warpcrew.save.v2')).player.tutorial.phase }))()`);
      assert.equal(after.expanded, before.expanded, 'spotlight background click must not open camera controls');
      assert.equal(after.phase, 'fight', 'spotlight background click must not advance tutorial');
      report.checks.spotlightBackground = { x: before.x, y: before.y, hit: before.hit, hitClass: before.hitClass, intercepted: before.intercepted,
        cameraBefore: before.expanded, cameraAfter: after.expanded, phaseAfter: after.phase };
    }
    const fightStarted = Date.now();
    await page.click('[data-act="tutorial-fight-start"]');
    await page.until('Boolean(document.querySelector(\'[data-act="encounter-order"][data-order="target_weapons"]:not([disabled])\'))');
    const target = await page.capture('target-window');
    assert.equal(target.save.encounterVersion, 2);
    await page.click('[data-act="encounter-order"][data-order="target_weapons"]');
    const ordered = await page.capture('target-ordered');
    assert.equal(ordered.save.targetUsed, true);
    assert.match(ordered.text, /Pirate weapons disabled|Next pirate volley canceled/);
    assert.ok(ordered.save.enemyHull < target.save.enemyHull, 'crew shot must lower pirate hull after order');
    if (width === 390 && !reduced) report.checks.guidedFeedback = {
      pirateBefore: target.save.enemyHull, pirateAfter: ordered.save.enemyHull,
      disableVisible: true, shotVisibleInHud: true };
    await page.until('Boolean(document.querySelector(\'[data-act="contract-claim"]\'))', 30000);
    const firstWinSeconds = (Date.now() - sessionStarted) / 1000;
    const fightSeconds = (Date.now() - fightStarted) / 1000;
    const win = await page.capture('win');
    assert.equal(win.save.encounterResult, 'win');
    await page.click('[data-act="contract-claim"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-name"]\'))');
    await page.capture('name');
    await page.click('[data-act="tutorial-name"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-welcome-pull"]\'))');
    await page.capture('pull');
    await page.click('[data-act="tutorial-welcome-pull"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-register-skip"]\'))');
    const register = await page.capture('register');
    assert.equal(register.save.crew.length, 3);
    assert.equal(register.save.pulls, 1);
    assert.match(register.text, /Uncommon/i);
    await page.click('[data-act="tutorial-register-skip"]');
    await page.until('Boolean(document.querySelector(\'[aria-label="Next job"]\'))');
    const nextJob = await page.capture('next-job');
    assert.ok(nextJob.cameraScale > 0.45, 'first post-tutorial ship view is close enough to inspect stations');
    const reloadUrl = await page.evaluate('location.href');
    assert.equal(new URL(reloadUrl).searchParams.has('fresh'), false, 'fresh-save URL is one-shot');
    await page.send('Page.navigate', { url: reloadUrl });
    await page.until('Boolean(document.querySelector(\'[aria-label="Next job"]\'))');
    const reloaded = await page.capture('reload');
    assert.ok(reloaded.cameraScale > 0.45, 'freshly completed tutorial reload keeps an inspectable ship view');
    const saved = await page.evaluate(`(() => { const p = JSON.parse(localStorage.getItem('warpcrew.save.v2')).player;
      return { script: p.tutorial.script, phase: p.tutorial.phase, completed: p.tutorial.completed,
      crew: p.crew.map(c => ({ id: c.templateId, name: c.name, captain: c.isCaptain })),
      name: p.ship.name, pulls: p.gacha.pulls, pullRarity: p.gacha.history[0]?.rarity,
      credits: p.wallet.credits, claims: p.contractBoard.completedOfferIds.filter(id => id === 'offer_tutorial_distress').length }; })()`);
    assert.equal(saved.script, 5);
    assert.equal(saved.completed, true);
    assert.equal(saved.crew.length, 3);
    assert.equal(saved.crew.filter(c => c.captain).length, 1);
    assert.equal(saved.crew[0].name, 'QA Aster');
    assert.equal(saved.pulls, 1);
    assert.equal(saved.pullRarity, 'uncommon');
    assert.equal(saved.claims, 1);
    report[`save-${key}`] = { ...saved, firstWinSeconds, fightSeconds, overTwoMinutes: firstWinSeconds > 120 };
    if (width === 390 && !reduced) {
      const crewBadgeBefore = await page.evaluate('Boolean(document.querySelector(\'[data-tab="crew"] .nav-badge\'))');
      await page.click('[data-tab="crew"]');
      await page.capture('crew-badge-cleared');
      const crewBadgeAfter = await page.evaluate('Boolean(document.querySelector(\'[data-tab="crew"] .nav-badge\'))');
      assert.equal(crewBadgeBefore, true, 'crew attention dot is actionable before Crew opens');
      assert.equal(crewBadgeAfter, false, 'crew attention dot clears when Crew opens');
      report.checks.crewBadge = { before: crewBadgeBefore, after: crewBadgeAfter };
      await page.click('[data-tab="ship"]');
      await page.until('Boolean(document.querySelector(\'[aria-label="Next job"]\'))');
    }
    if (width === 390 && !reduced) {
      await page.click('[aria-label="Next job"] [data-act="goto-contracts"]');
      await page.until('Boolean(document.querySelector(\'.contract-card[data-profile="reliable"] [data-act="contract-review"]:not([disabled])\'))');
      await page.capture('normal-board');
      await page.click('.contract-card[data-profile="reliable"] [data-act="contract-review"]');
      await page.click('[data-act="contract-accept"]');
      await page.until('Boolean(document.querySelector(\'[data-act="contract-action"][data-action="launch"]\'))');
      await page.click('[data-act="contract-action"][data-action="launch"]');
      await page.until('Boolean(document.querySelector(\'[data-act="contract-action"][data-action="push"]\'))');
      await page.click('[data-act="contract-action"][data-action="push"]');
      await page.until('Boolean(document.querySelector(\'[data-act="encounter-advance"], [data-act="encounter-order"]\'))');
      const normalFight = await page.capture('normal-fight');
      let usedOrder = null;
      let terminal = null;
      let impact = null;
      for (let beat = 0; beat < 20; beat++) {
        terminal = await page.evaluate(`(() => {
          const p = JSON.parse(localStorage.getItem('warpcrew.save.v2')).player;
          return p.activeEncounter?.result || null;
        })()`);
        if (terminal) break;
        const targetOrder = await page.evaluate(`Boolean(document.querySelector('[data-act="encounter-order"][data-order="target_weapons"]:not([disabled])'))`);
        if (targetOrder && !usedOrder) {
          await page.click('[data-act="encounter-order"][data-order="target_weapons"]');
          usedOrder = 'target_weapons';
        } else await page.click('[data-act="encounter-advance"]');
        if (!impact) {
          const damage = await page.evaluate(`(() => { const e = JSON.parse(localStorage.getItem('warpcrew.save.v2')).player.activeEncounter; return e && { hull: e.hull, shield: e.shield }; })()`);
          if (damage && (damage.hull < normalFight.save.hull || damage.shield < normalFight.save.shield)) {
            const frame = await page.capture('normal-impact');
            impact = { hullBefore: normalFight.save.hull, hullAfter: frame.save.hull,
              shieldBefore: normalFight.save.shield, shieldAfter: frame.save.shield };
          }
        }
      }
      assert.ok(['win', 'loss'].includes(terminal), 'normal job reaches a terminal result');
      await page.capture('normal-result');
      assert.ok(impact, 'normal fight must show a measured ship impact');
      report.normalJob = { result: terminal, usedOrder, impact };
      if (terminal === 'win') await page.click('[data-act="contract-claim"]');
      else await page.click('[data-act="encounter-recover"]');
    }
  } finally { await page.close(); }
}

function v4BraceFixture() {
  const now = Date.UTC(2030, 8, 23, 12);
  let player = prepareSession(createNewPlayer({ tutorialScript: 4, now, rng: () => 0.1 }), now);
  for (const [action, data] of [
    ['splash-dismiss', {}],
    ['station-assign', { id: player.crew.find(c => c.templateId === 'merc_bolt').instanceId, station: 'shields' }],
    ['tutorial-fight-start', {}],
  ]) {
    const result = sessionAction(player, {}, action, data, { now, rng: () => 0.1 });
    assert.equal(result.ok, true, `script-4 fixture ${action}`);
    player = result.player;
  }
  assert.equal(player.activeEncounter.version, 1);
  assert.equal(player.activeEncounter.orders.brace.used, false);
  return player;
}

async function legacyV4() {
  const page = await openPage(390, 844);
  try {
    const fixture = v4BraceFixture();
    await page.until('Boolean(document.querySelector(\'.wc-shell\'))');
    await page.evaluate(`localStorage.setItem('warpcrew.save.v2', ${JSON.stringify(JSON.stringify({ player: fixture, savedAt: Date.now() }))})`);
    await page.send('Page.navigate', { url: await page.evaluate('location.href') });
    await page.until('Boolean(document.querySelector(\'[data-act="encounter-order"][data-order="brace"]:not([disabled])\'))');
    const brace = await page.capture('legacy-v4-brace');
    assert.equal(brace.save.script, 4);
    assert.equal(brace.save.encounterVersion, 1);
    assert.equal(brace.save.targetUsed, undefined);
    await page.click('[data-act="encounter-order"][data-order="brace"]');
    await page.until('Boolean(document.querySelector(\'[data-act="contract-claim"]\'))', 30000);
    const won = await page.capture('legacy-v4-win');
    assert.equal(won.save.braceUsed, true);
    assert.equal(won.save.encounterResult, 'win');
    await page.click('[data-act="contract-claim"]');
    const claimed = await page.capture('legacy-v4-claimed');
    assert.equal(claimed.save.phase, 'name');
    const claimedCredits = claimed.save.credits;
    await page.send('Page.navigate', { url: await page.evaluate('location.href') });
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-name"]\'))');
    const reloaded = await page.capture('legacy-v4-claimed-reload');
    assert.equal(reloaded.save.credits, claimedCredits);
    assert.equal(reloaded.save.phase, 'name');
    assert.equal(await page.evaluate('Boolean(document.querySelector(\'[data-act="contract-claim"]\'))'), false);
    report.checks.legacyV4 = { braceUsed: true, version: 1, claimedOnce: true,
      creditsAfterClaim: claimedCredits, creditsAfterReload: reloaded.save.credits, claimActionAfterReload: false };
  } finally { await page.close(); }
}

async function corruptV5() {
  const page = await openPage(390, 844);
  try {
    const now = Date.UTC(2030, 8, 23, 12);
    let player = prepareSession(createNewPlayer({ now, rng: () => 0.1 }), now);
    for (const [action, data] of [
      ['splash-dismiss', {}],
      ['captain-choose', { templateId: 'captain_droid', name: 'QA Unit' }],
      ['tutorial-first-hire', {}],
      ['station-assign', { id: null, station: 'weapons' }],
      ['tutorial-fight-start', {}],
    ]) {
      if (action === 'station-assign') data.id = player.tutorial.firstHireInstanceId;
      const result = sessionAction(player, {}, action, data, { now, rng: () => 0.1 });
      assert.equal(result.ok, true, `script-5 corrupt fixture ${action}: ${result.reason}`);
      player = result.player;
    }
    const spentFuel = player.wallet.fuel;
    const originalCredits = player.wallet.credits;
    player = { ...player, activeEncounter: { ...player.activeEncounter, seed: player.activeEncounter.seed + 1 } };
    await page.until('Boolean(document.querySelector(\'.wc-shell\'))');
    await page.evaluate(`localStorage.setItem('warpcrew.save.v2', ${JSON.stringify(JSON.stringify({ player, savedAt: Date.now() }))})`);
    await page.send('Page.navigate', { url: await page.evaluate('location.href') });
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-fight-start"]\'))');
    const recovered = await page.capture('corrupt-recovery');
    assert.equal(recovered.save.script, 5);
    assert.equal(recovered.save.phase, 'fight');
    assert.equal(await page.evaluate('Boolean(document.querySelector(\'[data-act="contract-claim"]\'))'), false);
    assert.equal(recovered.save.credits, originalCredits);
    assert.equal(recovered.save.fuel, spentFuel);
    await page.click('[data-act="tutorial-fight-start"]');
    await page.until('Boolean(document.querySelector(\'[data-act="encounter-order"][data-order="target_weapons"]\'))');
    const retry = await page.capture('corrupt-retry');
    assert.equal(retry.save.fuel, spentFuel, 'guided retry cannot charge launch fuel twice');
    assert.equal(retry.save.encounterVersion, 2);
    report.checks.corruptV5 = { recoveredToFight: true, fuelBeforeRetry: spentFuel, fuelAfterRetry: retry.save.fuel,
      creditsBeforeRetry: originalCredits, creditsAfterRetry: retry.save.credits,
      fuelChargedOnce: true, creditsUnchanged: true,
      rawCorruptSaveRemainsUntilRetry: recovered.save.contract === 'confrontation' };
  } finally { await page.close(); }
}

await play(390, 844);
await play(360, 800);
await play(390, 844, true);
await legacyV4();
await corruptV5();
await writeFile(new URL('captain-first-play-qa.json', captureDir), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ browser: report.browser, screens: report.screens.length,
  saves: Object.fromEntries(Object.entries(report).filter(([key]) => key.startsWith('save-'))) }, null, 2));
