/** Real-runtime Chrome DevTools Protocol QA; Node 22+, no added dependencies.
 * Start the Vite runtime on 5199 and dedicated Chrome on 9339 (see QA report), then run:
 * node scripts/contract-route-qa.mjs
 * --record reports measured failures without discarding the remaining evidence.
 * Default mode exits nonzero on any failed requirement.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createNewPlayer } from '../src/systems/player.js';

const url = process.env.QA_URL || 'http://127.0.0.1:5199/';
const endpoint = process.env.QA_CDP || 'http://127.0.0.1:9339';
const finalReviewOnly = process.argv.includes('--final-review-only');
const reportName = finalReviewOnly ? 'final-review-measurements.json' : 'contract-route-measurements.json';
const artifactRoot = new URL('../docs/qa/artifacts/', import.meta.url);
const evidenceRoot = new URL('contracts-runtime/', artifactRoot);
await mkdir(evidenceRoot, { recursive: true });
const now = Date.parse('2026-09-21T19:00:00Z');
const seed = createNewPlayer();
Object.assign(seed, { captainName: 'Captain', createdAt: now, fuelClaimAt: now, lastLoginDay: '2026-09-21', loginStreak: 1 });
seed.flags.splashSeen = true;
seed.crew.forEach((c, i) => { c.instanceId = `qa-crew-${i}`; });
const report = process.argv.includes('--reduced-only')
  ? JSON.parse(await readFile(new URL('contract-route-measurements.json',evidenceRoot),'utf8'))
  : { url, browser: await (await fetch(`${endpoint}/json/version`)).json(), seed, fixedNow: now, timezone: 'America/Los_Angeles', deviceScaleFactor: 1, scenarios: [], failures: [] };
report.failures=report.failures.filter(x=>x.label!=='reduced-motion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const openPages = [];

async function openPage(width, height, reduced = false) {
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (!message.id) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    message.error ? promise.reject(new Error(JSON.stringify(message.error))) : promise.resolve(message.result);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTimezoneOverride', { timezoneId: report.timezone });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [${now}])); } static now() { return ${now}; } };
    Math.random = () => 0.01;
  }` });
  async function until(expression) {
    for (let i = 0; i < 150; i++) { try { if (await evaluate(expression)) return; } catch {} await wait(100); }
    throw new Error(`Timed out: ${expression}`);
  }
  await send('Page.navigate', { url });
  await until('Boolean(document.querySelector("[data-tab]"))');
  await evaluate(`localStorage.setItem('warpcrew.save.v2', ${JSON.stringify(JSON.stringify({ player: seed, savedAt: now }))})`);
  await send('Page.reload');
  await until('Boolean(document.querySelector("[data-tab]"))');
  await wait(900);
  const state = () => evaluate(`JSON.parse(localStorage.getItem('warpcrew.save.v2')).player`);
  async function click(selector) {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(el.disabled) throw Error('disabled: '+el.outerHTML); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); if(hit!==el&&!el.contains(hit))throw Error('click blocked '+${JSON.stringify(selector)}+' by '+hit?.outerHTML); return {x,y}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await wait(220);
  }
  async function reload(label) {
    const before = await state();
    await send('Page.reload');
    await until('Boolean(document.querySelector("[data-tab]"))');
    await wait(800);
    const after = await state();
    const snapshot = p => ({ version: p.version, phase: p.tutorial.phase, wallet: p.wallet, contract: p.activeContract, completed: p.contractBoard.completedOfferIds, daily: p.dailyLoop });
    assert.deepEqual(snapshot(after), snapshot(before), `reload ${label}`);
    return { label, before: snapshot(before), after: snapshot(after), equal: true };
  }
  async function capture(name) {
    await wait(150);
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(name, artifactRoot), Buffer.from(png.data, 'base64'));
    return name;
  }
  async function measure(label, root) {
    const measurement = await evaluate(`(() => {
      const scope = document.querySelector(${JSON.stringify(root)});
      if(!scope) throw Error('missing scope '+${JSON.stringify(root)});
      const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
      const nav = document.querySelector('.bottom-nav');
      const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
      const actionSelector = 'button, [role="button"], a[href], input, select';
      const buttons = [...(scope.matches(actionSelector) ? [scope] : []),...scope.querySelectorAll(actionSelector)].filter(el=>getComputedStyle(el).display!=='none' && el.getBoundingClientRect().width);
      const targets = buttons.map(el=>{
        el.scrollIntoView({block:'center',inline:'nearest'});
        const box=rect(el), cx=box.x+box.width/2, cy=box.y+box.height/2;
        const hit=document.elementFromPoint(cx,cy);
        const reachable=cx>=0 && cx<innerWidth && cy>=0 && cy<navTop && (el===hit||el.contains(hit));
        let clip={left:0,top:0,right:innerWidth,bottom:navTop};
        for(let parent=el.parentElement;parent;parent=parent.parentElement) {
          const style=getComputedStyle(parent),r=parent.getBoundingClientRect();
          if(/hidden|clip|scroll|auto/.test(style.overflowX)) { clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right); }
          if(/hidden|clip|scroll|auto/.test(style.overflowY)) { clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom); }
        }
        const fullyVisible=box.x>=clip.left-1 && box.right<=clip.right+1 && box.y>=clip.top-1 && box.bottom<=clip.bottom+1;
        return {label:el.getAttribute('aria-label')||el.innerText, action:el.dataset.act||el.dataset.tab, disabled:el.disabled, ...box, clip, fullyVisible, reachable, targetPass:box.width>=44 && box.height>=44};
      });
      const text = [...new Set([...buttons,...scope.querySelectorAll('p, h2, h3, dt, dd, .party-row strong, .party-row span span, .sheet-actions p, .mission-card b, .mission-card .muted')])].filter(el=>el.getBoundingClientRect().width).map(el=>({text:el.innerText||el.value||el.getAttribute('aria-label'),fontSize:parseFloat(getComputedStyle(el).fontSize),source:buttons.includes(el)?'control':'content',action:el.dataset.act||el.dataset.tab||null}));
      const sheets=[...document.querySelectorAll('.contract-sheet,.room-sheet')].map(el=>({ ...rect(el), scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,withinViewport:el.getBoundingClientRect().y>=0 && el.getBoundingClientRect().bottom<=navTop && el.getBoundingClientRect().x>=0 && el.getBoundingClientRect().right<=innerWidth }));
      for(const el of document.querySelectorAll('*')) { if(el.scrollTop) el.scrollTop=0; if(el.scrollLeft) el.scrollLeft=0; }
      const ship=document.querySelector('.ship-fit');
      return {viewport:{width:innerWidth,height:innerHeight},navTop,targets,text,sheets,ship:ship?rect(ship):null,scrollWidth:document.documentElement.scrollWidth,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`);
    const checks = [
      ...measurement.targets.filter(x=>!x.targetPass).map(x=>`target ${x.label}: ${x.width}×${x.height}`),
      ...measurement.targets.filter(x=>!x.reachable).map(x=>`unreachable ${x.label}`),
      ...measurement.targets.filter(x=>!x.fullyVisible).map(x=>`clipped ${x.label}`),
      ...measurement.text.filter(x=>x.fontSize<16).map(x=>`text ${x.text}: ${x.fontSize}px`),
      ...measurement.sheets.filter(x=>!x.withinViewport).map(x=>`sheet outside safe navigation region: ${JSON.stringify(x)}`),
    ];
    assert.equal(measurement.text.filter(x=>x.source==='control').length,measurement.targets.length,`${label}: every measured control has a font sample`);
    report.failures.push(...checks.map(message=>({viewport:`${width}x${height}`,label,message})));
    return {label,...measurement,pass:checks.length===0};
  }
  const page = { width,height,reduced,send,evaluate,until,click,state,reload,capture,measure,errors,close:async()=>{ws.close(); await fetch(`${endpoint}/json/close/${target.id}`);} };
  openPages.push(page);
  return page;
}

async function run(width,height) {
  const page = await openPage(width,height);
  const scenario={viewport:`${width}x${height}`,measurements:[],reloads:[],captures:[],phases:[]};
  report.scenarios.push(scenario);
  const observe=async(label,root,name)=>{scenario.measurements.push(await page.measure(label,root)); if(name) scenario.captures.push(await page.capture(name));};
  const supplementary=name=>`contracts-runtime/${name}-${width}x${height}.png`;
  async function checkRoomLabels(label) {
    const labels=await page.evaluate(`(()=>[...document.querySelectorAll('.room-tag')].filter(el=>Number(getComputedStyle(el).opacity)>0).map(el=>{
      const b=el.getBoundingClientRect();
      const box={x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};
      const clip={left:0,top:0,right:innerWidth,bottom:document.querySelector('.bottom-nav').getBoundingClientRect().top};
      for(let p=el.parentElement;p;p=p.parentElement){
        const s=getComputedStyle(p),r=p.getBoundingClientRect();
        if(/hidden|clip|scroll|auto/.test(s.overflowX)){clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);}
        if(/hidden|clip|scroll|auto/.test(s.overflowY)){clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);}
        if(s.clipPath.startsWith('polygon(')){
          const points=s.clipPath.match(/-?[\\d.]+/g).map(Number),xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1);
          clip.left=Math.max(clip.left,r.left+Math.min(...xs)/100*r.width);clip.right=Math.min(clip.right,r.left+Math.max(...xs)/100*r.width);
          clip.top=Math.max(clip.top,r.top+Math.min(...ys)/100*r.height);clip.bottom=Math.min(clip.bottom,r.top+Math.max(...ys)/100*r.height);
        }
      }
      return {text:el.innerText,...box,clip,pointerEvents:getComputedStyle(el).pointerEvents,fullyVisible:b.x>=clip.left-1&&b.right<=clip.right+1&&b.y>=clip.top-1&&b.bottom<=clip.bottom+1};
    }))()`);
    (scenario.roomLabels??=[]).push({label,labels});
    assert.ok(labels.length>0,'expected a visible room label');
    assert.ok(labels.every(value=>value.pointerEvents==='none'),'room labels cannot steal hotspot input');
    for(const value of labels) if(!value.fullyVisible) report.failures.push({viewport:scenario.viewport,label:'room-label',state:label,message:`clipped ${value.text}`,evidence:value});
  }
  const phase=async()=>scenario.phases.push((await page.state()).tutorial.phase);
  await phase();
  await page.click('[data-tab="missions"]');
  await observe('distress','.contract-board',supplementary('distress'));
  await page.click('[data-act="contract-review"]');
  await phase();
  await observe('distress-review','.contract-sheet',supplementary('review'));
  await page.click('[data-act="contract-accept"]');
  await observe('tutorial-briefing','.route-stage');
  await page.click('[data-action="launch"]');
  await phase();
  scenario.reloads.push(await page.reload('tutorial-confrontation'));
  await page.click('[data-tab="missions"]');
  await observe('tutorial-order','.route-stage',supplementary('tutorial-order'));
  await page.click('[data-order="brace"]');
  await page.until('Boolean(document.querySelector("[data-act=contract-claim]"))');
  await wait(2200);
  await phase();
  scenario.reloads.push(await page.reload('tutorial-return'));
  await observe('tutorial-cargo-claim','.room-sheet',width===390?'contract-return-390x844.png':supplementary('return'));
  await page.click('[data-act="contract-claim"]');
  await phase();
  scenario.improvementFocus = await page.evaluate(`document.querySelector('.room-sheet h2')?.innerText`);
  scenario.captures.push(await page.capture(supplementary('improvement')));
  await page.click('[data-act="close-room"]');
  await page.click('[data-act="tutorial-go"]');
  await phase();
  await page.click('[data-tab="missions"]');
  await observe('three-card-board','.contract-board',`contracts-board-${width}x${height}.png`);
  for(const profile of ['risky','strange']) {
    await page.evaluate(`document.querySelector('.contract-card[data-profile="${profile}"]').scrollIntoView({block:'center'})`);
    scenario.captures.push(await page.capture(supplementary(`board-${profile}`)));
  }
  // Include mission navigation controls independently of card text.
  await observe('mission-switcher','.mission-switcher');
  await page.click('.contract-card[data-profile="risky"] [data-act="contract-review"]');
  await observe('normal-review','.contract-sheet',supplementary('normal-review'));
  scenario.reviewFocusBefore=await page.evaluate(`({active:document.activeElement.outerHTML,return:document.querySelector('#app')._wcDialogReturn})`);
  await page.click('[data-act="contract-review-close"]');
  scenario.reviewFocus=await page.evaluate(`({action:document.activeElement.dataset.act,offer:document.activeElement.closest('.contract-card')?.dataset.profile})`);
  if(scenario.reviewFocus.action!=='contract-review'||scenario.reviewFocus.offer!=='risky') report.failures.push({viewport:scenario.viewport,label:'review-focus',message:'focus did not return to Risky Review',before:scenario.reviewFocusBefore,after:scenario.reviewFocus});
  await page.click('.contract-card[data-profile="risky"] [data-act="contract-review"]');
  await page.click('[data-act="contract-accept"]');
  await phase();
  await page.click('[data-view="contracts"]');
  await observe('normal-briefing','.route-stage');
  await page.click('[data-action="launch"]');
  scenario.reloads.push(await page.reload('normal-choice'));
  await page.click('[data-view="contracts"]');
  await observe('normal-choice','.route-stage',supplementary('choice'));
  await page.click('[data-action="push"]');
  scenario.reloads.push(await page.reload('normal-confrontation'));
  await page.click('[data-view="contracts"]');
  await observe('normal-orders','.route-stage',width===390?'contract-order-390x844.png':supplementary('orders'));
  scenario.confrontationSeed = await page.state();
  scenario.orderFacts = await page.evaluate(`[...document.querySelectorAll('.order-card')].map(e=>e.innerText)`);
  for(const order of ['brace','burn','board']) {
    await page.evaluate(`document.querySelector('[data-order="${order}"]').closest('.order-card').scrollIntoView({block:'center'})`);
    scenario.captures.push(await page.capture(supplementary(`order-${order}`)));
  }
  await page.click('[data-order="brace"]');
  await page.until('Boolean(document.querySelector("[data-act=contract-claim]"))');
  await wait(2200);
  scenario.reloads.push(await page.reload('normal-return'));
  await observe('normal-cargo-claim','.room-sheet',supplementary('normal-return'));
  scenario.normalResult = (await page.state()).activeContract.result;
  const beforeClaim = await page.state();
  await page.click('[data-act="contract-claim"]');
  const afterClaim = await page.state();
  scenario.claim = {before:beforeClaim.wallet, reward:beforeClaim.activeContract.result.rewards, after:afterClaim.wallet, completed:afterClaim.stats.contractsCompleted};
  assert.equal(afterClaim.stats.contractsCompleted,2);
  assert.equal(afterClaim.wallet.credits,beforeClaim.wallet.credits+scenario.claim.reward.credits);
  scenario.reloads.push(await page.reload('normal-claimed'));
  await page.click('[data-tab="missions"]');
  await page.click('[data-view="away"]');
  await observe('away-destinations','.away-view');
  await page.click('[data-act="exp-choose"][data-planet="dustfall"]');
  await page.click('[data-act="exp-picker-close"]');
  scenario.partyFocus=await page.evaluate(`({action:document.activeElement.dataset.act,planet:document.activeElement.dataset.planet})`);
  assert.deepEqual(scenario.partyFocus,{action:'exp-choose',planet:'dustfall'});
  await page.click('[data-act="exp-choose"][data-planet="dustfall"]');
  const selected=await page.evaluate(`[...document.querySelectorAll('.party-row[aria-pressed="true"]')].map(e=>e.dataset.id)`);
  for(const id of selected) await page.click(`[data-act="exp-crew-toggle"][data-id="${id}"]`);
  const jen=(await page.state()).crew.find(x=>x.templateId==='merc_jen').instanceId;
  await page.click(`[data-act="exp-crew-toggle"][data-id="${jen}"]`);
  await observe('selected-party','.party-picker',width===390?'expedition-party-390x844.png':supplementary('party'));
  scenario.partyPreview=await page.evaluate(`document.querySelector('.party-preview').innerText`);
  await page.click('[data-act="exp-launch"]');
  await phase();
  await page.until('!document.querySelector("[aria-busy=true]")');
  const away=await page.state();
  assert.deepEqual(away.activeExpedition.payload.crewInstanceIds,[jen]);
  assert.equal(away.tutorial.phase,'done');
  scenario.away={job:away.activeExpedition,crew:away.crew.map(x=>({id:x.instanceId,status:x.status})),wallet:away.wallet,daily:away.dailyLoop};
  await page.click('[data-tab="ship"]');
  await observe('daily-plan','.daily-plan-chip',width===390?'daily-plan-390x844.png':supplementary('daily-plan'));
  await checkRoomLabels('daily-plan');
  const ship=scenario.measurements.at(-1).ship;
  assert.ok(ship.x>=0 && ship.right<=width, 'daily chip preserves full ship horizontal bounds');
  await page.click('[data-act="daily-improve"]');
  await checkRoomLabels('improvement-ready');
  scenario.captures.push(await page.capture(supplementary('improvement-ready')));
  const improveBefore=await page.state();
  await page.click('.room-sheet [data-act="ship-upgrade"]');
  const improveAfter=await page.state();
  assert.equal(improveAfter.dailyLoop.improve,true);
  await page.click('[data-act="close-room"]');
  assert.equal(await page.evaluate(`Boolean(document.querySelector('.daily-plan-chip'))`),false);
  scenario.improvement={before:improveBefore.wallet,after:improveAfter.wallet,systems:improveAfter.ship.systems,daily:improveAfter.dailyLoop,chipHidden:true};
  await page.click('[data-tab="missions"]');
  await page.click('[data-view="away"]');
  await observe('active-away','.away-view',supplementary('active-away'));
  await page.click('[data-view="contracts"]');
  await page.click('.contract-card[data-profile="reliable"] [data-act="contract-review"]');
  await page.click('[data-act="contract-accept"]');
  await page.click('[data-view="explore"]');
  scenario.exploreBlocked = await page.evaluate(`({copy:document.body.innerText.includes('Finish or abandon the active contract first'), buttons:[...document.querySelectorAll('[data-act="travel-to"]')].map(e=>({disabled:e.disabled,label:e.innerText}))})`);
  assert.equal(scenario.exploreBlocked.copy,true);
  assert.ok(scenario.exploreBlocked.buttons.length > 0 && scenario.exploreBlocked.buttons.every(x=>x.disabled));
  scenario.captures.push(await page.capture(supplementary('explore-blocked')));
  await page.click('[data-view="contracts"]');
  await page.click('[data-act="contract-abandon"]');
  scenario.exceptions=page.errors;
  assert.equal(page.errors.length,0,'runtime has no uncaught exceptions');
  await page.close();
  return scenario;
}

async function runFinalReview(width, height, reduced) {
  const page = await openPage(width, height, reduced);
  const scenario = { viewport: `${width}x${height}`, reduced, captures: [], measurements: [] };
  report.scenarios.push(scenario);
  const capture = async name => scenario.captures.push(await page.capture(`contracts-runtime/final-${name}-${reduced ? 'reduced-' : ''}${width}x${height}.png`));
  await page.click('[data-tab="missions"]');
  await page.click('[data-act="contract-review"]');
  await page.click('[data-act="contract-accept"]');
  const beforeLaunch = await page.state();
  await page.click('[data-action="launch"]');
  scenario.launch = await page.evaluate(`({ shipVisible:document.querySelector('.wc-shell').classList.contains('tab-home'), flight:document.querySelector('.space-canvas').dataset.flight, message:document.querySelector('[data-slot="ship-sequence"]').innerText, saved:JSON.parse(localStorage.getItem('warpcrew.save.v2')).player.activeContract.stage })`);
  assert.equal(scenario.launch.shipVisible, true);
  assert.equal(scenario.launch.flight, reduced ? 'static' : 'departing');
  assert.equal(scenario.launch.saved, 'confrontation');
  assert.match(scenario.launch.message, /Sparrow launched/);
  assert.equal((await page.state()).wallet.fuel, beforeLaunch.wallet.fuel - 1);
  await capture('launch');
  if (reduced) {
    scenario.staticLaunch = await page.evaluate(`(async()=>{const el=document.querySelector('.space-canvas');const before=el.toDataURL();await new Promise(r=>setTimeout(r,200));return before===el.toDataURL()})()`);
    assert.equal(scenario.staticLaunch, true);
  }
  await page.click('[data-tab="missions"]');
  await page.click('[data-order="brace"]');
  await page.until('!document.querySelector(".combat-canvas.is-live") && Boolean(document.querySelector("[data-act=contract-claim]"))');
  await page.click('[data-act="contract-claim"]');
  await page.click('[data-act="close-room"]');
  await page.evaluate(`{
    window.__arrivalFeet={};
    const original=CanvasRenderingContext2D.prototype.ellipse;
    CanvasRenderingContext2D.prototype.ellipse=function(x,y,...args){
      const id=this.__wcActorInstanceId;
      if(id&&this.canvas.classList.contains('crew-canvas')){
        const r=this.canvas.getBoundingClientRect();
        const feet=window.__arrivalFeet[id]??=[];
        if(feet.length<5000)feet.push({x:x/r.width*100,y:(y-1)/r.height*100});
      }
      return original.call(this,x,y,...args);
    };
  }`);
  await page.click('[data-act="tutorial-go"]');
  const afterRecruit = await page.state();
  const jen = afterRecruit.crew.find(c => c.templateId === 'merc_jen');
  assert.equal(afterRecruit.tutorial.phase, 'choose');
  assert.ok(jen);
  assert.equal(await page.evaluate(`document.querySelector('.wc-shell').classList.contains('tab-home')`), true);
  await capture('jen-arrival');
  await page.until(`(window.__arrivalFeet[${JSON.stringify(jen.instanceId)}]||[]).some(p=>Math.abs(p.x-64)<0.01&&Math.abs(p.y-51)<0.01)`);
  scenario.jen = { id: jen.instanceId, positions: await page.evaluate(`window.__arrivalFeet[${JSON.stringify(jen.instanceId)}]`) };
  if (!reduced) assert.ok(scenario.jen.positions.some(p => Math.abs(p.x-47)<1 && Math.abs(p.y-64)<1), 'Jen begins at Airlock');
  assert.ok(scenario.jen.positions.some(p => Math.abs(p.x-64)<0.01 && Math.abs(p.y-51)<0.01), 'Jen reaches Workshop');
  await capture('jen-workshop');
  // Force the existing Broken Belt destination to exercise both authored fights.
  const branchSeed = await page.state();
  const risky = branchSeed.contractBoard.offers.find(o => o.profile === 'risky');
  risky.destinationId = 'danger_belt';
  risky.destinationName = 'Broken Belt';
  delete risky.routeContent;
  await page.evaluate(`localStorage.setItem('warpcrew.save.v2',${JSON.stringify(JSON.stringify({ player: branchSeed, savedAt: now }))})`);
  await page.send('Page.reload');
  await page.until('Boolean(document.querySelector("[data-tab]"))');
  await page.click('[data-tab="missions"]');
  await page.click('.contract-card[data-profile="risky"] [data-act="contract-review"]');
  await page.click('[data-act="contract-accept"]');
  await page.click('[data-view="contracts"]');
  await page.click('[data-action="launch"]');
  await page.click('[data-tab="missions"]');
  await page.click('[data-view="contracts"]');
  scenario.measurements.push(await page.measure('risky-branches', '.route-stage'));
  scenario.branchCopy = await page.evaluate(`document.querySelector('.route-stage').innerText`);
  assert.match(scenario.branchCopy, /Eclipse Probe/);
  assert.match(scenario.branchCopy, /Pirate Wing/);
  await capture('risky-branches');
  scenario.exceptions = page.errors;
  assert.equal(page.errors.length, 0);
  await page.close();
}

try {
  if (finalReviewOnly) {
    for (const [width, height] of [[390,844],[360,800]]) for (const reduced of [false,true]) {
      console.log(`Final review ${width}x${height} reduced=${reduced}`);
      await runFinalReview(width, height, reduced);
    }
  } else {
  for(const [width,height] of (process.argv.includes('--reduced-only')?[]:[[390,844],[360,800]])) {
    console.log(`Running ${width}x${height}`);
    await run(width,height);
    await writeFile(new URL('contract-route-measurements.json',evidenceRoot), JSON.stringify(report,null,2)+'\n');
  }
  report.reducedMotion=[];
  for(const source of report.scenarios) {
  const [width,height]=source.viewport.split('x').map(Number);
  const reduced=await openPage(width,height,true);
  await reduced.evaluate(`localStorage.setItem('warpcrew.save.v2',${JSON.stringify(JSON.stringify({player:source.confrontationSeed,savedAt:now}))})`);
  await reduced.send('Page.reload');
  await reduced.until('Boolean(document.querySelector("[data-tab]"))');
  await wait(800);
  await reduced.click('[data-view="contracts"]');
  const reducedReport={viewport:source.viewport,measurement:await reduced.measure('reduced-orders','.route-stage')};
  report.reducedMotion.push(reducedReport);
  const facts=await reduced.evaluate(`[...document.querySelectorAll('.order-card')].map(e=>e.innerText)`);
  assert.deepEqual(facts,source.orderFacts,'reduced-motion consequence parity');
  reducedReport.consequenceParity=true;
  reducedReport.decorative = await reduced.evaluate(`({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, css:[...document.querySelectorAll('.route-stage,.order-card')].map(e=>({animation:getComputedStyle(e).animationName,transition:getComputedStyle(e).transitionDuration}))})`);
  assert.ok(reducedReport.decorative.css.every(x=>x.animation==='none' && x.transition==='0s'));
  reducedReport.capture=await reduced.capture(width===390?'contracts-reduced-motion-390x844.png':'contracts-runtime/reduced-motion-360x800.png');
  await reduced.click('[data-order="brace"]');
  await reduced.until('Boolean(document.querySelector("[data-act=contract-claim]"))');
  assert.deepEqual((await reduced.state()).activeContract.result,source.normalResult,'reduced-motion result parity');
  reducedReport.canvasMotion=await reduced.evaluate(`(async()=>{
    await new Promise(r=>setTimeout(r,400));
    const space=document.querySelector('.space-canvas');
    const crew=document.querySelector('.crew-canvas');
    const beforeSpace=space.toDataURL(),beforeCrew=crew.toDataURL();
    const transforms=[];
    for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,100));transforms.push(getComputedStyle(document.querySelector('.stage')).transform);}
    return {spaceStatic:beforeSpace===space.toDataURL(),crewStatic:beforeCrew===crew.toDataURL(),transforms,combatLive:Boolean(document.querySelector('.combat-canvas.is-live'))};
  })()`);
  if(!reducedReport.canvasMotion.spaceStatic || !reducedReport.canvasMotion.crewStatic || reducedReport.canvasMotion.transforms.some(x=>x!=='none') || reducedReport.canvasMotion.combatLive) report.failures.push({viewport:source.viewport,label:'reduced-motion',message:'decorative canvas or camera motion remains',evidence:reducedReport.canvasMotion});
  reducedReport.resultParity=true;
  reducedReport.exceptions=reduced.errors;
  assert.equal(reduced.errors.length,0,'reduced runtime has no uncaught exceptions');
  await reduced.close();
  }
  }
} catch(error) {
  report.error=error.stack;
  console.error(error);
  process.exitCode=1;
} finally {
  for(const page of openPages) await page.close().catch(()=>{});
  await writeFile(new URL(reportName,evidenceRoot),JSON.stringify(report,null,2)+'\n');
  console.log(`Measured failures: ${report.failures.length}; scenarios: ${report.scenarios.length}`);
  if(report.failures.length && !process.argv.includes('--record')) process.exitCode=1;
}
