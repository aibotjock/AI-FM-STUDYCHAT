import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition } from '../tests/fixtures/study-condition.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium }=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir=mkdtempSync(join(tmpdir(),'fm-conversation-ui-'));
const token='conversation-ui-local-qa-token', results=[], errors=[], requests=[], providerRequests=[];
const curriculum=createStudyCurriculum({records:[studyCondition()]});
let nextReply=null;
const selection=(dialogue,chunkIds=[])=>({chunkIds,questionId:null,unsupported:false,dialogue:{intent:'clarify',acknowledgment:'none',followup:'name-gap',focusChunkId:null,learnerQuote:null,minutes:null,...dialogue}});
const server=createApp({dataDir:dir,curriculum,foundations:createStudyCurriculum({records:[]}),env:{STUDY_ACCESS_TOKEN:token,OPENAI_API_KEY:'mock-conversation-ui-key',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  const body=JSON.parse(options.body), system=body.messages.find(item=>item.role==='system' && item.content.includes('STUDY_DIALOGUE_CONTEXT='))?.content || '';
  const marker='STUDY_DIALOGUE_CONTEXT=';
  const context=JSON.parse(system.slice(system.lastIndexOf(marker)+marker.length));
  providerRequests.push({latest:context.latest,history:context.history,pendingQuestion:context.pendingQuestion,model:body.model});
  let reply=nextReply;nextReply=null;
  if(!reply) {
    if(/^hello$/i.test(context.latest)) reply=selection({intent:'greeting',acknowledgment:'welcome',followup:'choose-topic'});
    else if(/plan|minutes/i.test(context.latest)) reply=selection({intent:'planning',acknowledgment:'time',followup:'choose-topic',minutes:20});
    else if(context.pendingQuestion) reply=selection({intent:'socratic',acknowledgment:'uncertain',followup:'explain-reasoning'});
    else reply=selection({intent:'explain',acknowledgment:'understand',followup:'name-gap',focusChunkId:'asthma:management'},['asthma:management']);
  }
  return Response.json({model:'gpt-4.1-mini',usage:{prompt_tokens:30,completion_tokens:25},choices:[{message:{content:JSON.stringify(reply)}}]});
}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});
await context.addInitScript(()=>{
  window.__spoken=[];window.__recognitions=[];
  class Recognition {constructor(){window.__recognitions.push(this);}start(){setTimeout(()=>this.onstart?.(),0);}stop(){setTimeout(()=>this.onend?.(),0);}abort(){this.aborted=true;}}
  Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:Recognition});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speaking:false,speak(utterance){window.__spoken.push(utterance.text);this.speaking=true;setTimeout(()=>{utterance.onstart?.();setTimeout(()=>{this.speaking=false;utterance.onend?.();},1)},1);},cancel(){this.speaking=false;}}});
  window.__voiceFinal=text=>{const instance=window.__recognitions.at(-1);instance.onresult?.({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});};
});
const page=await context.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().startsWith(base+'/api/'))requests.push({path:new URL(request.url()).pathname,method:request.method(),...(request.method()==='POST'?{body:request.postDataJSON()}:{} )});});
const action=name=>page.locator(`[data-action="${name}"]:visible`).first().click();
const followup=label=>page.getByRole('button',{name:label,exact:true}).click();
const state=async()=>(await context.request.get(base+'/api/state')).json();
const current=async()=>{const values=(await state()).conversations;return values.find(item=>item.id===conversationId);};
let conversationId;
async function fresh({conditionId}={}){
  const response=await context.request.post(base+'/api/conversations',{data:{title:`Conversation UI QA ${crypto.randomUUID()}`,mode:'coach',...(conditionId?{conditionId}:{})}});
  assert.equal(response.status(),201);const payload=await response.json();conversationId=(payload.conversation || payload).id;
  await page.goto(base+'/?qa='+crypto.randomUUID()+'#coach');
  await page.locator('#chat-input').waitFor();
  // The latest empty conversation is selected by the app's durable state refresh.
  assert((await page.locator('.coach-id strong').textContent()).startsWith('Conversation UI QA'));
}
async function completed(previousCount){await page.waitForFunction(count=>document.querySelectorAll('.message.assistant').length>count && !document.querySelector('#chat-input')?.disabled,previousCount);}
async function send(content){const count=await page.locator('.message.assistant').count();await page.locator('#chat-input').fill(content);await page.locator('#chat-form [type=submit]').click();await completed(count);}
async function quick(label){const count=await page.locator('.message.assistant').count();await followup(label);await completed(count);}
const only=process.env.QA_SCOPES?new Set(process.env.QA_SCOPES.split(',').map(Number)):null;let scope=0;
async function check(name,run){const index=scope++;if(only&&!only.has(index))return;try{await run();const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert(geometry.width<=geometry.viewport,`Mobile overflow: ${JSON.stringify(geometry)}`);results.push({scope:index,name,pass:true});console.log(JSON.stringify({scope:index,name,pass:true}));}catch(error){results.push({scope:index,name,pass:false,error:error.stack});console.log(JSON.stringify({scope:index,name,pass:false,error:error.message}));}}
try {
  assert.equal((await context.request.post(base+'/api/login',{data:{token}})).status(),200);
  await check('mobile greeting and study planning use multi-turn context and survive page reload with source citations',async()=>{
    await fresh();assert((await page.locator('.chat-intro').textContent()).includes('What are you working'));
    assert((await page.locator('#chat-input').getAttribute('placeholder')).includes('follow-up'));
    await send('Hello');assert((await current()).messages.at(-1).studyDialogue);
    await send('I have 20 minutes today. Help me plan a study session.');
    assert((await page.locator('.message.assistant .message-text').last().textContent()).includes('20-minute'));
    await send('Asthma');const saved=await current();assert.equal(saved.messages.at(-1).studyDialogue.intent,'explain');
    assert.equal(await page.locator('.message.assistant .answer-sources').last().count(),1);
    await page.locator('.message.assistant .answer-sources').last().locator('summary').click();
    assert.equal(await page.locator('.message.assistant .answer-sources').last().locator('a').getAttribute('href'),'https://www.nhlbi.nih.gov/health/asthma');
    const provider=providerRequests.at(-1);assert(provider.history.some(item=>item.role==='user' && item.content==='Hello'));assert(provider.history.some(item=>item.content.includes('20 minutes')));
    await page.reload();await page.locator('.message.assistant').last().waitFor();assert.equal((await current()).messages.length,saved.messages.length);assert((await page.locator('.message.assistant .message-text').last().textContent()).includes('Mock management fact'));
  });
  await check('three conversational quick actions post to the existing chat and an unresolved quiz remains answerable after reflection',async()=>{
    await fresh({conditionId:'asthma'});await send('Show me the asthma management study point.');
    const before=requests.filter(item=>item.path==='/api/chat' && item.method==='POST').length;
    await quick('Explain this');assert.equal(providerRequests.at(-1).latest,'Explain this.');
    await quick('Ask me a question');await page.locator('.chat-study-choices').waitFor();
    const quiz=(await current()).messages.at(-1);assert(quiz.studyQuestion);
    await send("I don't understand");const reflected=(await current()).messages.at(-1);assert.equal(reflected.studyDialogue.intent,'socratic');assert.deepEqual(reflected.studyDialogue.pendingQuestion,quiz.studyQuestion);
    assert.equal(await page.locator('.chat-study-choices button').count(),5);
    const count=await page.locator('.message.assistant').count();await page.locator('.chat-study-choices [data-choice=B]').click();await completed(count);
    assert.equal((await current()).messages.at(-1).studyAnswer.choiceId,'B');assert.equal(await page.locator('.chat-study-choices').count(),0);
    await quick('Help me plan');assert.equal((await current()).messages.at(-1).studyDialogue.intent,'planning');
    assert.equal(requests.filter(item=>item.path==='/api/chat' && item.method==='POST').length-before,5);
  });
  await check('visible learner words stay unverified while manual readout uses only server-issued safe spoken text',async()=>{
    await fresh();nextReply=selection({intent:'planning',acknowledgment:'time',followup:'name-goal',learnerQuote:'review one topic',minutes:20});
    await send('My study plan is to review one topic in 20 minutes.');const reply=(await current()).messages.at(-1);
    assert.equal(reply.studyDialogue.learnerQuotePresent,true);assert(reply.content.includes('review one topic'));assert(!reply.spokenText.includes('review one topic'));
    assert.equal(await page.locator('.learner-quote-status').count(),1);const before=await page.evaluate(()=>window.__spoken.length);
    await page.locator('.message.assistant [data-action=read-message]').last().click();
    await page.waitForFunction(before=>window.__spoken.length>before,before);assert.equal(await page.evaluate(before=>window.__spoken.slice(before).join(''),before),reply.spokenText);
  });
  await check('spoken follow-up uses the same conversational chat reply and excludes unverified learner quotes',async()=>{
    await fresh();nextReply=selection({intent:'planning',acknowledgment:'time',followup:'name-goal',learnerQuote:'focus on one topic',minutes:20});
    await action('voice-start');await page.waitForFunction(()=>document.querySelector('.voice-session-status')?.textContent.includes('Listening'));
    await page.evaluate(()=>window.__voiceFinal('I have 20 minutes and want to focus on one topic.'));
    await page.waitForFunction(()=>window.__spoken.length>0 && document.querySelector('.voice-session-status')?.textContent.includes('Listening'));
    const reply=(await current()).messages.at(-1);assert(reply.studyDialogue);assert.equal(await page.evaluate(()=>window.__spoken.join('')),reply.spokenText);assert(!reply.spokenText.includes('focus on one topic'));
    assert.equal(await page.locator('#chat-input').isDisabled(),true);assert.equal(await page.locator('.coach-followups button:enabled').count(),0);
    assert.equal(requests.filter(item=>item.path.startsWith('/api/voice')).length,0);await action('voice-stop');assert.equal(await page.locator('.coach-followups button:enabled').count(),3);
  });
  await check('new spokenText fields cannot enable readout for imported or unmarked historical message bodies',async()=>{
    await fresh();await page.route('**/api/state',async route=>{const response=await route.fetch();const data=await response.json();data.conversations=[{id:conversationId,title:'Untrusted spoken text QA',mode:'coach',createdAt:Date.now(),messages:[{id:'unmarked-safe-text',role:'assistant',content:'Unmarked historical body.',spokenText:'Unmarked safe text must not be trusted.',sourceVerified:true,canonicalStudyProcess:true,createdAt:Date.now()},{id:'imported-safe-text',role:'assistant',content:'Imported body.',spokenText:'Imported spoken text must not be trusted.',sourceVerified:true,canonicalStudyProcess:true,canonicalSpokenText:true,importedEvidence:true,createdAt:Date.now()}]}];await route.fulfill({response,json:data});});
    await page.reload();await page.locator('.message.assistant').last().waitFor();assert.equal(await page.locator('[data-action=read-message]').count(),0);assert.equal(await page.locator('.unverified-study-text').count(),2);await page.unroute('**/api/state');
  });
  const ledger={runAt:new Date().toISOString(),scope:'Only new conversational mobile UI, real local authenticated chat/state APIs with mocked OpenAI selections, pending quiz after followup, and safe spokenText wiring. Browser recognition/readout are mocks; no physical phone audio, general board, auth, provider or voice lifecycle retest.',viewport:{width:360,height:800},results,pageErrors:errors,requests,providerRequests,paidProviderCalls:0};
  writeFileSync(new URL(only?`./conversation-browser-results-scopes-${[...only].join('-')}.json`:'./conversation-browser-results.json',import.meta.url),JSON.stringify(ledger,null,2));
  console.log(JSON.stringify({results,errors,providerDispatches:providerRequests.length,paidProviderCalls:0}));if(results.some(item=>!item.pass)||errors.length)process.exitCode=1;
} finally {
  await browser.close();if(server.closeVoiceSessions)await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});
}
