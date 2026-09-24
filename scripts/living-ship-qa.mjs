/** Isolated Chrome DevTools Protocol QA of the fresh script-4 first session. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const cdpUrl = process.env.QA_CDP || 'http://127.0.0.1:9342';
const pageUrl = process.env.QA_URL || 'http://127.0.0.1:4173/?fresh=1';
const captureDir = new URL('../.superpowers/sdd/2026-09-23-living-ship-vertical-slice/captures/', import.meta.url);
await mkdir(captureDir, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await (await fetch(`${cdpUrl}/json/version`)).json();
const report = { browser: browser.Browser, pageUrl, screens: [] };

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
    const filename = `slice-${width}x${height}${reduced ? '-reduced' : ''}-${label}.png`;
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(filename, captureDir), Buffer.from(screenshot.data, 'base64'));
    const metrics = await evaluate(`(() => ({ width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      tutorial: document.querySelector('.wc-shell')?.dataset.phase,
      cameraScale: document.querySelector('#app')?._wcCamera?.scale || null,
      splash: document.querySelector('.splash-scene img')?.getAttribute('src') || null,
      artLoaded: document.querySelector('.splash-scene img')?.naturalWidth || null,
      text: document.body.innerText.slice(0, 420) }))()`);
    assert.ok(metrics.scrollWidth <= width, `${label}: horizontal overflow ${metrics.scrollWidth}>${width}`);
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
  try {
    await page.until('Boolean(document.querySelector(\'[data-act="splash-dismiss"]:not([disabled])\'))');
    const splash = await page.capture('splash');
    assert.match(splash.splash, /splash-five-crew-v3\.png$/);
    assert.equal(splash.artLoaded, 941);
    await page.click('[data-act="splash-dismiss"]');
    await page.until('Boolean(document.querySelector(\'[data-act="station-assign"][data-station="shields"]\'))');
    await page.capture('station');
    await page.click('[data-act="station-assign"][data-station="shields"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-fight-start"]\'))');
    await page.capture('distress');
    await page.click('[data-act="tutorial-fight-start"]');
    await page.until('Boolean(document.querySelector(\'[data-act="encounter-order"][data-order="brace"]:not([disabled])\'))');
    await page.capture('threat');
    await page.click('[data-act="encounter-order"][data-order="brace"]');
    await page.until('Boolean(document.querySelector(\'[data-act="contract-claim"]\'))', 30000);
    await page.capture('win');
    await page.click('[data-act="contract-claim"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-name"]\'))');
    await page.capture('name');
    await page.click('[data-act="tutorial-name"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-welcome-pull"]\'))');
    await page.capture('pull');
    await page.click('[data-act="tutorial-welcome-pull"]');
    await page.until('Boolean(document.querySelector(\'[data-act="tutorial-register-skip"]\'))');
    await page.capture('register');
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
    const saved = await page.evaluate(`(() => { const values = Object.values(localStorage).map(value => {
      try { return JSON.parse(value); } catch { return null; }
    }); const p = values.map(value => value?.player).find(value => value?.tutorial?.script === 4);
    return p ? { phase: p.tutorial.phase, completed: p.tutorial.completed,
      crew: p.crew.length, name: p.ship.name, pulls: p.gacha.pulls, credits: p.wallet.credits } : null; })()`);
    assert.ok(saved, 'script-4 save survives reload');
    assert.equal(saved.completed, true);
    assert.equal(saved.crew, 3);
    assert.equal(saved.pulls, 1);
    report[`save-${width}x${height}${reduced ? '-reduced' : ''}`] = saved;
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
      await page.capture('normal-fight');
      let usedBrace = false;
      let terminal = null;
      for (let beat = 0; beat < 20; beat++) {
        terminal = await page.evaluate(`(() => {
          const p = JSON.parse(localStorage.getItem('warpcrew.save.v2')).player;
          return p.activeEncounter?.result || null;
        })()`);
        if (terminal) break;
        const brace = await page.evaluate(`Boolean(document.querySelector('[data-act="encounter-order"][data-order="brace"]:not([disabled])'))`);
        if (brace && !usedBrace) {
          await page.click('[data-act="encounter-order"][data-order="brace"]');
          usedBrace = true;
        } else await page.click('[data-act="encounter-advance"]');
      }
      assert.ok(['win', 'loss'].includes(terminal), 'normal job reaches a terminal result');
      await page.capture('normal-result');
      report.normalJob = { result: terminal, usedBrace };
      if (terminal === 'win') await page.click('[data-act="contract-claim"]');
      else await page.click('[data-act="encounter-recover"]');
    }
  } finally { await page.close(); }
}

await play(390, 844);
await play(360, 800);
await play(390, 844, true);
await writeFile(new URL('living-ship-qa.json', captureDir), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ browser: report.browser, screens: report.screens.length,
  saves: Object.fromEntries(Object.entries(report).filter(([key]) => key.startsWith('save-'))) }, null, 2));
