import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dataDir = mkdtempSync(join(tmpdir(), 'fm-front-qa-'));
const server = createApp({dataDir, env:{}});
server.listen(0, '127.0.0.1'); await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:360,height:800},acceptDownloads:true});
const page=await context.newPage();
page.setDefaultTimeout(7000);
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
const results=[];
const action=(name,scope=page)=>scope.locator(`[data-action="${name}"]:visible`).first().click();
const request=async(path,method='GET',body)=>{
  const response=await context.request.fetch(base+path,{method,...(body!==undefined?{data:body}:{})});
  assert(response.ok(),`HTTP ${response.status()} at ${path}`);return response.json();
};
const snapshot=()=>request('/api/state');
const visible=selector=>page.locator(selector).waitFor({state:'visible'});
const closed=()=>page.locator('#app-dialog').waitFor({state:'hidden'});
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log(JSON.stringify({name,pass:true}));}catch(e){results.push({name,pass:false,error:e.message});console.log(JSON.stringify({name,error:e.message}));}}
try {
await page.goto(base);await visible('#chat-input');
await check('preferences rejects bad timezone and persists valid settings',async()=>{
  await action('settings');await page.locator('#study-timezone').fill('Bad/Timezone');await page.locator('[form="settings-form"][type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#settings-error')?.textContent);assert((await page.locator('#settings-error').textContent()).toLowerCase().includes('time'));
  await page.locator('#study-focus').selectOption('exam');await page.locator('#coach-style').selectOption('direct');await page.locator('#daily-minutes').fill('25');await page.locator('#new-limit').fill('8');await page.locator('#study-timezone').fill('America/New_York');await page.locator('[form="settings-form"][type="submit"]').click();await closed();
  const s=(await snapshot()).settings;assert.equal(s.focus,'exam');assert.equal(s.coachStyle,'direct');assert.equal(s.dailyMinutes,25);assert.equal(s.newCardsPerDay,8);assert.equal(s.timeZone,'America/New_York');
});
await check('dialog cancel and Escape close without saving',async()=>{
  await action('settings');await page.locator('#daily-minutes').fill('30');await page.keyboard.press('Escape');await closed();assert.equal((await snapshot()).settings.dailyMinutes,25);
});
await page.locator('#bottom-nav a[href="#library"]').click();
await check('paste import rejects malformed JSON then imports two cards atomically',async()=>{
  const before=(await snapshot()).cards.length;await action('import-cards');await page.locator('#import-json').fill('[bad');await page.locator('[form="import-cards-form"][type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#import-error')?.textContent);assert.equal((await snapshot()).cards.length,before);
  await page.locator('#import-json').fill(JSON.stringify([{front:'QA search alpha',back:'QA answer alpha',topic:'QA Topic'},{front:'QA search beta',back:'QA answer beta',topic:'QA Topic'}]));await page.locator('[form="import-cards-form"][type="submit"]').click();await closed();assert.equal((await snapshot()).cards.length,before+2);
});
await check('JSON file import and combined search/topic filtering',async()=>{
  await action('import-cards');await page.locator('#cards-file').setInputFiles({name:'cards.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{front:'QA file gamma',back:'Gamma answer',topic:'QA File'}]))});await page.waitForFunction(()=>document.querySelector('#import-json')?.value.includes('QA file gamma'));await page.locator('[form="import-cards-form"][type="submit"]').click();await closed();
  await page.locator('#card-search').fill('QA search');assert.equal(await page.locator('.library-card').count(),2);await page.locator('#topic-filter').selectOption('QA Topic');assert.equal(await page.locator('.library-card').count(),2);await page.locator('#card-search').fill('beta');assert.equal(await page.locator('.library-card').count(),1);
});
await check('suspend/resume persists, delete confirmation cancel and accept work',async()=>{
  const card=page.locator('.library-card').first();const id=await card.locator('[data-action="suspend-card"]').getAttribute('data-id');await action('suspend-card',card);await page.locator('.library-card.suspended').waitFor();assert.equal((await snapshot()).cards.find(c=>c.id===id).suspended,true);
  await action('suspend-card');await page.locator('.library-card:not(.suspended)').waitFor();assert.equal((await snapshot()).cards.find(c=>c.id===id).suspended,false);
  await action('delete-card');await action('close-dialog',page.locator('#app-dialog'));assert((await snapshot()).cards.some(c=>c.id===id));await action('delete-card');await action('confirm-delete-card');await closed();assert(!(await snapshot()).cards.some(c=>c.id===id));
});
await check('export download and confirmed restore are connected',async()=>{
  await action('settings');const downloadPromise=page.waitForEvent('download');await action('export');const download=await downloadPromise;const backup=JSON.parse(readFileSync(await download.path(),'utf8'));assert(Array.isArray(backup.cards));assert(Array.isArray(backup.conversations));assert(Array.isArray(backup.reviews));
  backup.settings.dailyMinutes=26;await action('import-backup');await page.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('[form="restore-form"][type="submit"]').click();assert(await page.locator('#app-dialog').isVisible());assert.equal((await snapshot()).settings.dailyMinutes,25);
  await page.locator('[name="confirmed"]').check();await page.locator('[form="restore-form"][type="submit"]').click();await closed();assert.equal((await snapshot()).settings.dailyMinutes,26);
});
await check('reflection confidence set and clear persist',async()=>{
  await page.locator('#bottom-nav a[href="#progress"]').click();const select=page.locator('.confidence-select').first();const key=await select.getAttribute('data-competency');await select.selectOption('4');await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Your reflection is saved.');assert.equal((await snapshot()).settings.competencyRatings[key],4);
  await select.selectOption('');await page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===200);assert.equal((await snapshot()).settings.competencyRatings[key],undefined);
});
await check('history select/delete and answer-to-card dialog work',async()=>{
  const c=await request('/api/conversations','POST',{title:'QA history',mode:'coach'});const conv=c.conversation||c;await request('/api/chat','POST',{conversationId:conv.id,content:'QA history seed',requestId:'qa-seed-history'});await page.reload();await visible('#main');await page.locator('#bottom-nav a[href="#coach"]').click();await action('history');await page.locator(`[data-action="select-conversation"][data-id="${conv.id}"]`).click();await closed();await visible('.message.assistant');await action('card-from-message');assert((await page.locator('#card-back').inputValue()).length>0);await page.keyboard.press('Escape');
  await action('history');await page.locator(`[data-action="delete-conversation"][data-id="${conv.id}"]`).click();await action('confirm-delete-conversation');await closed();assert(!(await snapshot()).conversations.some(x=>x.id===conv.id));
});
await check('frontend chat failure preserves draft and retry uses same request ID',async()=>{
  await action('new-chat');let failedId;await page.route('**/api/chat',async route=>{failedId=route.request().postDataJSON().requestId;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA transient failure'})});});
  await page.locator('#chat-input').fill('QA retry answer');await page.locator('#chat-form [type="submit"]').click();await visible('.chat-compose .notice.error');assert.equal(await page.locator('#chat-input').inputValue(),'QA retry answer');await page.unroute('**/api/chat');const retried=page.waitForRequest(r=>r.url().endsWith('/api/chat')&&r.method()==='POST');await page.locator('#chat-form [type="submit"]').click();const retry=await retried;assert.equal(retry.postDataJSON().requestId,failedId);await visible('.message.assistant');assert.equal(await page.locator('.message.user').count(),1);
});
await check('clipboard rejection and read-aloud error show actionable fallbacks',async()=>{
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('QA denied');}}});window.speechSynthesis.speak=utterance=>utterance.onerror?.();});await action('copy-message');assert((await page.locator('#toast').textContent()).includes('Select the message'));await action('read-message');assert((await page.locator('#toast').textContent()).includes('unavailable'));
});
await check('offline chat retains draft and does not send',async()=>{
  await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await page.locator('#chat-input').fill('QA offline draft');await page.locator('#chat-form [type="submit"]').click();assert.equal(await page.locator('#chat-input').inputValue(),'QA offline draft');assert((await page.locator('#toast').textContent()).includes('Reconnect'));await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine===true);
});
await check('review keyboard reveal and rating wiring',async()=>{
  await page.locator('#bottom-nav a[href="#review"]').click();await visible('.card-question');await page.locator('#main').focus();await page.keyboard.press('Space');await visible('.answer');const before=(await snapshot()).reviews.length;await page.locator('#main').focus();await page.keyboard.press('3');await page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===200);assert.equal((await snapshot()).reviews.length,before+1);
});
await check('suspending current queued review must remove it from active session',async()=>{
  const front=await page.locator('.card-question').textContent();const card=(await snapshot()).cards.find(c=>c.front===front);assert(card);await page.locator('#bottom-nav a[href="#library"]').click();await page.locator('#card-search').fill(front);await page.locator('#topic-filter').selectOption('');await page.locator(`[data-action="suspend-card"][data-id="${card.id}"]`).click();await page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===200);await page.locator('#bottom-nav a[href="#review"]').click();assert.notEqual(await page.locator('.card-question').textContent(),front,'Suspended current card remains in active review queue');
});
console.log(JSON.stringify({results,pageErrors:errors},null,2));
} finally { await browser.close();await new Promise(r=>server.close(r));rmSync(dataDir,{recursive:true,force:true}); }
