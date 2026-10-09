import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const token='qa-study-code-not-a-production-secret-123456789';
const providerRequests=[]; let failMiniConnection=false;
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
const fetchImpl=async(url,options)=>{
  if(options.method==='GET'){assert.equal(url,'https://api.openai.com/v1/models');providerRequests.push({method:'GET',endpoint:'models'});return response({data:['gpt-4.1-mini','gpt-6-luna','gpt-5.4-pro','gpt-6-astra'].map(id=>({id}))});}
  const body=JSON.parse(options.body);assert(!/astra/i.test(body.model),'Prohibited model reached mock inference');const isTest=JSON.stringify(body.messages||body.input).includes('exactly READY');providerRequests.push({method:'POST',endpoint:url.endsWith('/responses')?'responses':'chat',model:body.model,isTest,store:body.store,maxOutputTokens:body.max_output_tokens||body.max_completion_tokens});
  if(body.model==='gpt-4.1-mini'&&isTest&&failMiniConnection)return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
  const content=isTest?'READY':`QA selected ${body.model} teaching answer.`;
  if(url.endsWith('/responses'))return response({id:'qa_response',status:'completed',model:body.model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:content}]}],usage:{input_tokens:100,output_tokens:12}});
  return response({model:body.model,choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:12}});
};
const dir=mkdtempSync(join(tmpdir(),'fm-model-login-'));
const server=createApp({dataDir:dir,env:{STUDY_ACCESS_TOKEN:token,OPENAI_API_KEY:'qa-mock-key-never-real'},fetchImpl});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:360,height:800},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];const overflows=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];const action=name=>page.locator(`[data-action="${name}"]:visible`).first().click();
const closed=()=>page.locator('#app-dialog').waitFor({state:'hidden'});
const json=async path=>(await context.request.get(base+path)).json();
const posts=()=>providerRequests.filter(x=>x.method==='POST').length;
async function geometry(label){const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));if(dimensions.document>dimensions.viewport)overflows.push({label,...dimensions});}
async function check(name,fn){try{await fn();await geometry(name);results.push({name,pass:true});console.log(JSON.stringify({name,pass:true}));}catch(e){results.push({name,pass:false,error:e.message});console.log(JSON.stringify({name,error:e.message}));}}
async function pick(model){await page.locator('#openai-model').selectOption(model);const changed=page.waitForResponse(r=>r.url().endsWith('/api/model')&&r.request().method()==='PUT');await page.locator('[form="model-form"][type="submit"]').click();assert.equal((await changed).status(),200);await page.locator('#openai-model').waitFor();await page.waitForFunction(model=>document.querySelector('#openai-model')?.value===model,model);assert.equal((await json('/api/status')).model,model);}
try{
await page.goto(base);await page.locator('#access-token').waitFor();
await check('sign-in help, show/hide aria state and incorrect-code feedback',async()=>{
  assert((await page.locator('.signin-note').textContent()).includes('separate from OPENAI_API_KEY'));assert.equal(await page.locator('#access-token').getAttribute('type'),'password');await action('show-access-code');assert.equal(await page.locator('#access-token').getAttribute('type'),'text');assert.equal(await page.locator('[data-action="show-access-code"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-action="show-access-code"]').textContent(),'Hide code');await action('show-access-code');assert.equal(await page.locator('#access-token').getAttribute('type'),'password');assert.equal(await page.locator('[data-action="show-access-code"]').getAttribute('aria-pressed'),'false');await page.locator('#access-token').fill('wrong-code');await page.locator('#login-form [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#login-error')?.textContent);assert((await page.locator('#login-error').textContent()).includes('Incorrect access token'));assert.equal((await json('/api/status')).authenticated,false);
});
await check('pasted whitespace code signs in, session cookie survives reload',async()=>{
  await page.locator('#access-token').fill(`   ${token}   `);await page.locator('#login-form [type="submit"]').click();await page.locator('#chat-input').waitFor();const cookies=await context.cookies();const session=cookies.find(c=>c.name==='studychat_session');assert(session);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Strict');assert.equal((await json('/api/status')).authenticated,true);await page.reload();await page.locator('#chat-input').waitFor();assert.equal((await json('/api/status')).authenticated,true);
});
await check('model picker exposes account models, excludes Astra and closes cleanly',async()=>{
  await action('settings');await action('models');await page.locator('#openai-model').waitFor();const ids=await page.locator('#openai-model option').evaluateAll(items=>items.map(x=>x.value));assert.deepEqual(new Set(ids),new Set(['gpt-4.1-mini','gpt-6-luna','gpt-5.4-pro']));assert(ids.every(id=>!/astra/i.test(id)));assert.equal(posts(),0);await page.keyboard.press('Escape');await closed();assert.equal((await json('/api/status')).model,'gpt-4.1-mini');await action('settings');await action('models');await page.locator('#openai-model').waitFor();
});
await check('model selection error is visible and successful selection updates status',async()=>{
  await page.locator('#openai-model').selectOption('gpt-6-luna');assert.equal(await page.locator('#test-model-button').isDisabled(),true);await page.route('**/api/model',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'QA wait for current AI request'})}));await page.locator('[form="model-form"][type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#model-error')?.textContent);assert((await page.locator('#model-error').textContent()).includes('QA wait'));await page.unroute('**/api/model');await pick('gpt-6-luna');assert.equal(await page.locator('#test-model-button').isEnabled(),true);await action('close-dialog');
});
await check('Coach sends selected model and displays returned model, usage and cost metadata',async()=>{
  const prior=posts();await page.locator('#chat-input').fill('QA verify selected-model integration');await page.locator('#chat-form [type="submit"]').click();await page.locator('.message.assistant .model-metadata').waitFor();assert.equal(posts(),prior+1);const sent=providerRequests.at(-1);assert.equal(sent.model,'gpt-6-luna');assert.equal(sent.endpoint,'chat');assert.equal(sent.store,false);const metadata=await page.locator('.model-metadata').textContent();assert(metadata.includes('gpt-6-luna'));assert(metadata.includes('100 input / 12 billed output'));assert(metadata.includes('Estimated $'));assert((await page.locator('.message.assistant .message-text').textContent()).includes('QA selected gpt-6-luna'));
});
await check('model connection check records READY and reuses passed result without inference',async()=>{
  await action('settings');await action('models');await page.locator('#openai-model').waitFor();const prior=posts();let done=page.waitForResponse(r=>r.url().endsWith('/api/model-test'));await action('model-test');assert.equal((await done).status(),200);await page.locator('.model-test-result').waitFor();assert((await page.locator('.model-test-result').textContent()).includes('connected'));assert((await page.locator('.model-test-result').textContent()).includes('expected READY'));assert.equal(posts(),prior+1);done=page.waitForResponse(r=>r.url().endsWith('/api/model-test'));await action('model-test');const cached=await (await done).json();assert.equal(cached.cached,true);assert.equal(posts(),prior+1);assert((await page.locator('.model-test-result').textContent()).includes('Saved connection result'));
});
await check('model results download contains provenance, token costs and nonclinical limits',async()=>{
  const downloading=page.waitForEvent('download');await action('model-results-export');const download=await downloading;assert.equal(download.suggestedFilename(),'fm-study-model-results.json');const exported=JSON.parse(readFileSync(await download.path(),'utf8'));assert.equal(exported.results.length,1);assert.equal(exported.results[0].requestedModel,'gpt-6-luna');assert.equal(exported.results[0].instructionPassed,true);assert.equal(exported.results[0].clinicalAccuracy,'Not evaluated');assert.equal(exported.results[0].usage.prompt_tokens,100);assert.equal(JSON.stringify(exported).includes('qa-mock-key-never-real'),false);
});
await check('Responses-only Pro model is selected and tested with the Responses protocol',async()=>{
  await pick('gpt-5.4-pro');assert((await page.locator('#model-profile').textContent()).includes('Responses'));const prior=posts();const done=page.waitForResponse(r=>r.url().endsWith('/api/model-test'));await action('model-test');const payload=await (await done).json();assert.equal(payload.connectionPassed,true);assert.equal(payload.endpoint,'responses');assert.equal(payload.requestedModel,'gpt-5.4-pro');assert.equal(posts(),prior+1);const sent=providerRequests.at(-1);assert.equal(sent.endpoint,'responses');assert.equal(sent.model,'gpt-5.4-pro');assert.equal(sent.maxOutputTokens,512);assert.equal(sent.store,false);assert((await page.locator('.model-test-result').textContent()).includes('gpt-5.4-pro'));
});
await check('failed model connection displays error and re-enables the button',async()=>{
  await pick('gpt-4.1-mini');failMiniConnection=true;const done=page.waitForResponse(r=>r.url().endsWith('/api/model-test'));await action('model-test');assert.equal((await done).status(),502);await page.waitForFunction(()=>document.querySelector('#model-error')?.textContent);assert((await page.locator('#model-error').textContent()).includes('could not complete'));assert.equal(await page.locator('#test-model-button').isEnabled(),true);await action('close-dialog');await closed();
});
await check('logout locks workspace, clears cookie and survives reload',async()=>{
  await action('settings');await action('logout');await page.locator('#access-token').waitFor();assert.equal((await json('/api/status')).authenticated,false);assert.equal((await context.cookies()).some(c=>c.name==='studychat_session'),false);assert.equal((await context.request.get(base+'/api/state')).status(),401);await page.reload();await page.locator('#access-token').waitFor();assert.equal((await json('/api/status')).authenticated,false);
});
await check('all new mobile views have no horizontal overflow or JavaScript errors',async()=>{assert.deepEqual(overflows,[]);assert.deepEqual(errors,[]);assert(providerRequests.filter(x=>x.method==='POST').every(x=>!/astra/i.test(x.model)));});
const ledger={runAt:new Date().toISOString(),scope:'New sign-in and model-selection mobile flows only; prior 16 passed checks not repeated',viewport:{width:360,height:800},results,pageErrors:errors,overflows,mockProviderRequests:providerRequests,paidProviderCalls:0};writeFileSync(new URL('./model-login-mobile-results.json', import.meta.url),JSON.stringify(ledger,null,2));console.log(JSON.stringify(ledger,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
