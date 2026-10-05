/** Production-preview mobile-viewport QA via Chrome DevTools Protocol. Node 22+. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const pageUrl = process.env.QA_URL || 'http://127.0.0.1:4173/?fresh=1';
const cdpUrl = process.env.QA_CDP || 'http://127.0.0.1:9341';
const artifact = new URL('../docs/qa/artifacts/', import.meta.url);
const browser = await (await fetch(`${cdpUrl}/json/version`)).json();
const report = { browser: browser.Browser, pageUrl, deviceScaleFactor: 1, scenarios: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openPage(width, height, reduced) {
  const target = await (await fetch(`${cdpUrl}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    message.error ? promise.reject(new Error(JSON.stringify(message.error))) : promise.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  };
  const until = async expression => {
    for (let tries = 0; tries < 120; tries++) {
      try { if (await evaluate(expression)) return; } catch { /* Rendering in progress. */ }
      await wait(100);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await send('Page.navigate', { url: pageUrl });
  await until('Boolean(document.querySelector(".bottom-nav"))');
  const click = async selector => {
    try { await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); }
    catch (error) {
      console.error('Missing selector', selector, await evaluate(`({text:document.body.innerText.slice(0,1200),buttons:[...document.querySelectorAll('button')].map(x=>({text:x.innerText,act:x.dataset.act,tab:x.dataset.tab}))})`));
      throw error;
    }
    const point = await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (button.disabled) throw Error('disabled '+button.outerHTML);
      button.scrollIntoView({block:'center'});
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x,y);
      if (hit !== button && !button.contains(hit)) throw Error('occluded '+button.outerHTML+' by '+hit?.outerHTML);
      return { x, y };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await wait(250);
  };
  const capture = async filename => {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(filename, artifact), Buffer.from(screenshot.data, 'base64'));
    return filename;
  };
  const measure = async (label, scopeSelector) => {
    const data = await evaluate(`(() => {
      const scope = document.querySelector(${JSON.stringify(scopeSelector)});
      if (!scope) throw Error('scope missing: '+${JSON.stringify(scopeSelector)});
      const box = element => { const r=element.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
      const actions = [...scope.querySelectorAll('button:not([disabled])')].map(element => ({
        label: element.getAttribute('aria-label') || element.innerText,
        ...box(element), fontSize: parseFloat(getComputedStyle(element).fontSize),
      }));
      const text = [...scope.querySelectorAll('.contract-consequence,.contract-facts dd,.order-card p')]
        .map(element => ({ text: element.innerText, fontSize: parseFloat(getComputedStyle(element).fontSize) }));
      const bounds=box(scope);
      const navTop=document.querySelector('.bottom-nav')?.getBoundingClientRect().top ?? innerHeight;
      const payout=[...scope.querySelectorAll('dt')].find(element=>element.innerText==='Possible payout now')?.nextElementSibling?.innerText || null;
      return { label:${JSON.stringify(label)}, viewport:{width:innerWidth,height:innerHeight},
        documentScrollWidth:document.documentElement.scrollWidth,scope:bounds,scopeScrollHeight:scope.scrollHeight,
        scopeClientHeight:scope.clientHeight,navTop,payout,actions,text,
        reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches };
    })()`);
    assert.ok(data.documentScrollWidth <= width, `${label}: horizontal overflow`);
    assert.ok(data.actions.every(action => action.width >= 44 && action.height >= 44), `${label}: undersized action`);
    assert.ok(data.text.every(item => item.fontSize >= 16), `${label}: undersized consequence/fact text`);
    assert.ok(data.scope.x >= 0 && data.scope.right <= width, `${label}: horizontal scope clip`);
    if (scopeSelector === '.contract-sheet') {
      assert.ok(data.scope.y >= 0 && data.scope.bottom <= data.navTop, `${label}: dialog clips behind nav`);
    }
    return data;
  };
  const focusByTab = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, modifiers:8 });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, modifiers:8 });
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
    return evaluate(`(() => { const el=document.activeElement; return { matches:el.matches(${JSON.stringify(selector)}),
      label:el.getAttribute('aria-label') || el.innerText,outline:getComputedStyle(el).outlineStyle,
      focusVisible:el.matches(':focus-visible') }; })()`);
  };
  const close = async () => { ws.close(); await fetch(`${cdpUrl}/json/close/${target.id}`); };
  return { click, capture, measure, evaluate, until, focusByTab, close };
}

async function run(width, height, reduced = false) {
  const page = await openPage(width, height, reduced);
  const name = `${width}x${height}`;
  const scenario = { viewport: name, reduced, measurements: [], screenshots: [] };
  report.scenarios.push(scenario);
  try {
    await page.click('button[data-act="splash-dismiss"]');
    await page.click('[data-act="tutorial-go"]');
    await page.click('[data-act="contract-accept"]');
    await page.click('[data-action="launch"]');
    await page.click('[data-act="tutorial-go"]');
    await page.click('[data-order="brace"]');
    await page.until('Boolean(document.querySelector("[data-act=contract-claim]"))');
    await wait(2200);
    await page.click('[data-act="contract-claim"]');
    if (await page.evaluate('Boolean(document.querySelector("[data-act=close-toast]"))')) await page.click('[data-act="close-toast"]');
    await page.click('[data-act="close-room"]');
    await page.click('[data-act="tutorial-go"]');
    await page.click('[data-tab="missions"]');
    await page.until('Boolean(document.querySelector(".contract-card[data-profile=risky]"))');
    scenario.contractFocus = await page.focusByTab('.contract-card[data-profile="risky"] [data-act="contract-review"]');
    assert.ok(scenario.contractFocus.matches && scenario.contractFocus.focusVisible, 'contract action keyboard focus');
    await page.evaluate(`document.querySelector('.contract-card[data-profile="risky"]').scrollIntoView({block:'center'})`);
    scenario.measurements.push(await page.measure('board-risky', '.contract-card[data-profile="risky"]'));
    assert.ok(scenario.measurements.at(-1).scope.y >= 58 && scenario.measurements.at(-1).scope.bottom <= scenario.measurements.at(-1).navTop, 'risky card clipped in overview');
    scenario.screenshots.push(await page.capture(`encounter-intelligence-board-${reduced ? 'reduced-' : ''}${name}.png`));
    await page.click('.contract-card[data-profile="risky"] [data-act="contract-review"]');
    scenario.measurements.push(await page.measure('review', '.contract-sheet'));
    scenario.reviewAccessibleLabel = await page.evaluate(`document.querySelector('.contract-sheet [data-act="contract-accept"]').getAttribute('aria-label')`);
    assert.ok(scenario.reviewAccessibleLabel.includes(scenario.measurements.at(-1).payout), 'review accessible payout mismatch');
    assert.equal(scenario.measurements.at(-2).payout, scenario.measurements.at(-1).payout, 'board/review payout mismatch');
    scenario.screenshots.push(await page.capture(`encounter-intelligence-review-${reduced ? 'reduced-' : ''}${name}.png`));
    await page.click('[data-act="contract-accept"]');
    await page.click('[data-view="contracts"]');
    await page.click('[data-action="launch"]');
    await wait(2200);
    await page.click('[data-tab="missions"]');
    await page.click('[data-view="contracts"]');
    await page.click('[data-action="push"]');
    await page.until('Boolean(document.querySelector(".combat-orders .order-card"))');
    scenario.measurements.push(await page.measure('encounter-orders', '.combat-orders'));
    scenario.orderFocus = await page.focusByTab('[data-order="brace"]');
    assert.ok(scenario.orderFocus.matches && scenario.orderFocus.focusVisible, 'order keyboard focus');
    scenario.orderFacts = await page.evaluate(`({ tell:document.querySelector('.combat-orders > h3')?.innerText,
      reason:document.querySelector('.combat-orders > h3 + p + p')?.innerText,
      orders:[...document.querySelectorAll('.order-card')].map(el=>({text:el.innerText,enabled:!el.querySelector('button').disabled})),
      recommendations:[...document.querySelectorAll('.order-card h3')].filter(el=>el.innerText.includes('Recommended')).length })`);
    assert.ok(scenario.orderFacts.tell && scenario.orderFacts.reason, 'tell and reason visible');
    assert.equal(scenario.orderFacts.recommendations, 1, 'exactly one recommended order');
    assert.equal(scenario.orderFacts.orders.filter(order=>order.enabled).length, 3, 'all three orders enabled');
    scenario.screenshots.push(await page.capture(reduced ? 'encounter-intelligence-reduced-motion.png' : `encounter-intelligence-${name}.png`));
    for (const order of ['burn', 'board']) {
      await page.evaluate(`document.querySelector('[data-order=${JSON.stringify(order)}]').closest('.order-card').scrollIntoView({block:'center'})`);
      scenario.screenshots.push(await page.capture(`encounter-intelligence-order-${order}-${reduced ? 'reduced-' : ''}${name}.png`));
    }
  } finally { await page.close(); }
}

await run(390, 844);
await run(360, 800);
await run(390, 844, true);
await writeFile(new URL('encounter-intelligence-measurements.json', artifact), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.scenarios.map(({viewport,reduced,measurements,orderFacts})=>({viewport,reduced,
  payouts:measurements.map(({label,payout})=>({label,payout})),recommendations:orderFacts?.recommendations})),null,2));
