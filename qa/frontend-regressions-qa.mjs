import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let providerCalls=0;
const fetchImpl=async(_url,options)=>{providerCalls++;const body=JSON.parse(options.body);const content=body.response_format?JSON.stringify({cards:[{front:'Draft alpha',back:'Draft answer alpha',topic:'QA Draft',verified:true,sourceUrl:'https://invented.invalid'},{front:'Draft beta',back:'Draft answer beta',topic:'QA Draft',verified:true}]}):'Mock teaching answer to review.';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200,headers:{'Content-Type':'application/json'}});};
const dir=mkdtempSync(join(tmpdir(),'fm-front-regression-'));
const server=createApp({dataDir:dir,env:{OPENAI_API_KEY:'qa-not-a-real-key'},fetchImpl});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:360,height:800}});await context.addInitScript(()=>{window.SpeechRecognition=class {constructor(){window.__qaRecognition=this;}start(){}stop(){this.onend?.();}};});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];const action=name=>page.locator(`[data-action="${name}"]:visible`).first().click();
const request=async(path,method='GET',body)=>{const r=await context.request.fetch(base+path,{method,...(body!==undefined?{data:body}:{})});assert(r.ok(),`${path} ${r.status()}`);return r.json();};
const closed=()=>page.locator('#app-dialog').waitFor({state:'hidden'});
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log(JSON.stringify({name,pass:true}));}catch(e){results.push({name,pass:false,error:e.message});console.log(JSON.stringify({name,error:e.message}));}}
try{
const c=await request('/api/conversations','POST',{title:'QA draft acceptance',mode:'coach'});await request('/api/chat','POST',{conversationId:c.id,content:'QA mock provider seed',requestId:'qa-mock-seed'});await page.goto(base);await page.locator('.message.assistant').waitFor();
await check('AI draft editing, selective acceptance, validation and unverified storage',async()=>{
  const before=(await request('/api/state')).cards.length;await action('draft-cards');await page.locator('#draft-form').waitFor();assert.equal(await page.locator('.draft-card').count(),2);assert.equal(await page.locator('#draft-source-0').inputValue(),'');await page.locator('[name="accept-0"]').uncheck();await page.locator('[name="accept-1"]').uncheck();await page.locator('[form="draft-form"][type="submit"]').click();assert((await page.locator('#draft-error').textContent()).includes('at least one'));assert.equal((await request('/api/state')).cards.length,before);
  await page.locator('[name="accept-0"]').check();await page.locator('#draft-front-0').fill('');await page.locator('[form="draft-form"][type="submit"]').click();assert((await page.locator('#draft-error').textContent()).includes('question and answer'));await page.locator('#draft-front-0').fill('Reviewed QA question');await page.locator('#draft-back-0').fill('Edited QA answer');await page.locator('#draft-source-0').fill('https://example.org/reference');await page.locator('[form="draft-form"][type="submit"]').click();await closed();const cards=(await request('/api/state')).cards;assert.equal(cards.length,before+1);const saved=cards.find(x=>x.front==='Reviewed QA question');assert.equal(saved.back,'Edited QA answer');assert.equal(saved.sourceUrl,'https://example.org/reference');assert.equal(saved.verified,false);assert(!cards.some(x=>x.front==='Draft beta'));
});
await check('dictation fills draft without sending and permission failure preserves typing',async()=>{
  const before=(await request('/api/state')).conversations[0].messages.length;await page.locator('#chat-input').fill('Typed prefix');await action('dictate');assert((await page.locator('#voice-status').textContent()).includes('Listening'));await page.evaluate(()=>window.__qaRecognition.onresult({results:[[{transcript:'spoken words'}]]}));assert.equal(await page.locator('#chat-input').inputValue(),'Typed prefix spoken words');await action('dictate');assert(!(await page.locator('#voice-status').textContent()).includes('Listening'));assert.equal((await request('/api/state')).conversations[0].messages.length,before);
  await action('dictate');await page.evaluate(()=>window.__qaRecognition.onerror({error:'not-allowed'}));assert((await page.locator('#toast').textContent()).includes('wasn’t granted'));assert.equal(await page.locator('#chat-input').inputValue(),'Typed prefix spoken words');
});
await check('suspended/deleted review heads are pruned and next answer is hidden',async()=>{
  await page.locator('#bottom-nav a[href="#review"]').click();const front=await page.locator('.card-question').textContent();const first=(await request('/api/state')).cards.find(x=>x.front===front);await action('reveal-answer');await page.locator('#bottom-nav a[href="#library"]').click();await page.locator('#card-search').fill(front);const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/state'));await page.locator(`[data-action="suspend-card"][data-id="${first.id}"]`).click();await refreshed;await page.locator('#bottom-nav a[href="#review"]').click();assert.notEqual(await page.locator('.card-question').textContent(),front);assert.equal(await page.locator('.answer').count(),0);assert((await page.locator('.review-topline').textContent()).includes('1 of 4'));
  const secondFront=await page.locator('.card-question').textContent();const second=(await request('/api/state')).cards.find(x=>x.front===secondFront);await action('reveal-answer');await page.locator('#bottom-nav a[href="#library"]').click();await page.locator('#card-search').fill(secondFront);await page.locator(`[data-action="delete-card"][data-id="${second.id}"]`).click();await action('confirm-delete-card');await closed();await page.locator('#bottom-nav a[href="#review"]').click();assert.notEqual(await page.locator('.card-question').textContent(),secondFront);assert.equal(await page.locator('.answer').count(),0);assert((await page.locator('.review-topline').textContent()).includes('1 of 3'));
});
await check('a valid exported backup larger than 10 MiB restores through the frontend',async()=>{
  const backup=await request('/api/export');const seed=backup.cards[0];backup.cards=Array.from({length:1400},(_,i)=>({...seed,id:`qa-large-${i}`,front:`Large backup card ${i}`,back:'x'.repeat(8000),suspended:false}));backup.reviews=[];backup.conversations=[];backup.settings.dailyMinutes=41;const bytes=Buffer.from(JSON.stringify(backup));assert(bytes.length>10*1024*1024);assert(bytes.length<16*1024*1024);
  await page.locator('#bottom-nav a[href="#coach"]').click();await action('settings');await action('import-backup');await page.locator('#backup-file').setInputFiles({name:'large-backup.json',mimeType:'application/json',buffer:bytes});await page.locator('[name="confirmed"]').check();await page.locator('[form="restore-form"][type="submit"]').click();await closed();const restored=await request('/api/state');assert.equal(restored.cards.length,1400);assert.equal(restored.settings.dailyMinutes,41);
});
console.log(JSON.stringify({results,pageErrors:errors,mockProviderCalls:providerCalls,paidProviderCalls:0},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
