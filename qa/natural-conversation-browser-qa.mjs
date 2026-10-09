import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition } from '../tests/fixtures/study-condition.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir=mkdtempSync(join(tmpdir(),'fm-natural-ui-')),token='natural-conversation-local-qa-token';
const results=[],errors=[],requests=[],providerRequests=[];
const when=Date.now();
const legacyTitle='Operator conversation check · synthetic study';
const seed={cards:[],reviews:[],settings:{focus:'exam',coachStyle:'socratic',dailyMinutes:20,newCardsPerDay:5,timeZone:'America/New_York',competencyRatings:{}},conversations:[
  {id:'normal-most-recent',title:'My ordinary conversation',mode:'coach',createdAt:when-1000,messages:[]},
  {id:'legitimate-operator-title',title:legacyTitle,mode:'coach',createdAt:when-2000,messages:[{id:'real-owner-message',role:'user',content:'This title is my own study note.',requestId:'learner-request-not-a-protocol',createdAt:when-2000}]},
  {id:'legacy-operator',title:legacyTitle,mode:'coach',createdAt:when+1000,messages:[{id:'internal-old-user',role:'user',content:'Synthetic protocol fixture only.',requestId:'study-dialogue-v1-plan-gpt-4.1-mini',createdAt:when+1000},{id:'internal-old-gap',role:'assistant',content:'Old internal source gap fixture.',unsupported:true,createdAt:when+1001}]},
  {id:'marked-operator',title:'Operator source check · synthetic board study',internalCheck:true,mode:'coach',createdAt:when+2000,messages:[{id:'internal-marked-user',role:'user',content:'Synthetic protocol fixture only.',requestId:'study-source-selector-source-v1-gpt-4.1-mini',createdAt:when+2000}]},
]};
const database=new DatabaseSync(join(dir,'studychat.sqlite'));database.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');database.prepare('INSERT INTO app_state(id,data) VALUES(1,?)').run(JSON.stringify(seed));database.close();
const condition=studyCondition(), curriculum=createStudyCurriculum({records:[condition]});
const texts={
  hello:"Of course. We can just talk for a while. What would you like to share?",
  breather:"We can take this slowly. Would you rather talk about your day or something different?",
  study:"For this board-study fixture, the source-linked learning point is to review inhaler technique. What part would you like to work through?",
  why:"The supplied fixture contains the learning point about reviewing inhaler technique, but no further causal explanation. We can examine that statement together. Which part is unclear?",
  hint:"We can look at the wording together without revealing the key. Which option are you leaning toward?",
};
let lastPrimary=[];
const segments=(text,sourceChunkIds=[])=>[{id:'s1',text,sourceChunkIds}];
function dataFrom(body,marker){const prompt=body.messages.find(item=>item.role==='system' && item.content.includes(marker))?.content;assert(prompt,`Missing mock prompt marker ${marker}`);return JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length));}
const server=createApp({dataDir:dir,curriculum,foundations:createStudyCurriculum({records:[]}),env:{STUDY_ACCESS_TOKEN:token,OPENAI_API_KEY:'mock-only-natural-ui',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);
  let reply,kind,context;
  if(body.messages.some(item=>item.role==='system' && item.content.includes('NATURAL_TUTOR_CONTEXT='))){
    kind='primary';context=dataFrom(body,'NATURAL_TUTOR_CONTEXT=');
    const latest=context.latest || context.latestUser || body.messages.findLast(item=>item.role==='user')?.content || '';
    if(/not ready|just chat/i.test(latest)) lastPrimary=segments(texts.hello);
    else if(/long day|breather/i.test(latest)) lastPrimary=segments(texts.breather);
    else if(/^why/i.test(latest)) lastPrimary=segments(texts.why,['asthma:management']);
    else if(/unclear|understand|hint/i.test(latest)) lastPrimary=segments(texts.hint);
    else if(/asthma/i.test(latest)) lastPrimary=segments(texts.study,['asthma:management']);
    else lastPrimary=segments(texts.breather);
    reply={segments:lastPrimary};providerRequests.push({kind,latest,context});
  }else{
    kind='review';context=dataFrom(body,'NATURAL_REVIEW_DATA=');
    reply={approved:true,segments:lastPrimary.map(segment=>({id:segment.id,approved:true,externalFactCount:segment.sourceChunkIds.length?1:0,claims:segment.sourceChunkIds.length?[{quote:segment.text,type:'medical',sourceChunkIds:segment.sourceChunkIds,supports:[{chunkId:'asthma:management',excerpt:condition.sections.find(item=>item.id==='management').text}]}]:[],flags:[]}))};
    providerRequests.push({kind,context});
  }
  return Response.json({model:'gpt-4.1-mini',usage:{prompt_tokens:30,completion_tokens:25},choices:[{message:{content:JSON.stringify(reply)}}]});
}});
server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
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
const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().startsWith(base+'/api/'))requests.push({path:new URL(request.url()).pathname,method:request.method(),...(request.method()==='POST'?{body:request.postDataJSON()}:{} )});});
const action=name=>page.locator(`[data-action="${name}"]:visible`).first().click();
const state=async()=>(await context.request.get(base+'/api/state')).json();
let conversationId='normal-most-recent';
const current=async()=>{const values=(await state()).conversations;return values.find(item=>item.id===conversationId);};
async function fresh({conditionId}={}){const response=await context.request.post(base+'/api/conversations',{data:{title:`Natural UI QA ${crypto.randomUUID()}`,mode:'coach',...(conditionId?{conditionId}:{})}});assert.equal(response.status(),201);const data=await response.json();conversationId=(data.conversation||data).id;await page.goto(base+'/?qa='+crypto.randomUUID()+'#coach');await page.locator('#chat-input').waitFor();}
async function completed(count){await page.waitForFunction(count=>document.querySelectorAll('.message.assistant').length>count && !document.querySelector('#chat-input')?.disabled,count);}
async function send(content){const count=await page.locator('.message.assistant').count();await page.locator('#chat-input').fill(content);await page.locator('#chat-form [type=submit]').click();await completed(count);const reply=(await current()).messages.at(-1);assert(!reply.unsupported,reply.content);return reply;}
const only=process.env.QA_SCOPES?new Set(process.env.QA_SCOPES.split(',').map(Number)):null;let scope=0;
async function check(name,run){const index=scope++;if(only&&!only.has(index))return;try{await run();const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert(geometry.width<=geometry.viewport,`Mobile overflow ${JSON.stringify(geometry)}`);results.push({scope:index,name,pass:true});console.log(JSON.stringify({scope:index,name,pass:true}));}catch(error){results.push({scope:index,name,pass:false,error:error.stack,visible:(await page.locator('#main').textContent()).slice(-2500)});console.log(JSON.stringify({scope:index,name,pass:false,error:error.message}));}}
try{
  assert.equal((await context.request.post(base+'/api/login',{data:{token}})).status(),200);
  await check('latest operator diagnostics never open as the learner chat or appear in history/export; similarly named learner history remains',async()=>{
    await page.goto(base+'/?qa='+crypto.randomUUID()+'#coach');await page.locator('#chat-input').waitFor();assert.equal(await page.locator('.coach-id strong').textContent(),'My ordinary conversation');
    const visibleIds=(await state()).conversations.map(item=>item.id);assert(visibleIds.includes('legitimate-operator-title'));assert(!visibleIds.includes('legacy-operator'));assert(!visibleIds.includes('marked-operator'));
    await action('history');assert.equal(await page.locator('[data-action=select-conversation][data-id=legitimate-operator-title]').count(),1);assert.equal(await page.locator('[data-action=select-conversation][data-id=legacy-operator]').count(),0);await action('close-dialog');
    const backup=await (await context.request.get(base+'/api/export')).json();assert(!backup.conversations.some(item=>['legacy-operator','marked-operator'].includes(item.id)));assert(server.readOnlySnapshot().conversations.some(item=>item.id==='legacy-operator'));assert(server.readOnlySnapshot().conversations.some(item=>item.id==='marked-operator'));
  });
  await check('ordinary generated conversation carries context into study and why followups, displays exact text and source links without a source-gap greeting',async()=>{
    await fresh();const hello=await send("Hi. I'm not ready to study yet. Can we just chat?");assert.equal(hello.content,texts.hello);assert.equal(hello.reviewedDialogue,true);assert.equal(hello.sourceVerified,false);assert.equal(hello.canonicalSpokenText,false);assert.equal(hello.groundingReview.externalClaimCount,0);assert.equal(await page.locator('.answer-abstention').count(),0);assert.equal(await page.locator('.message.assistant .ai-conversation-status').last().textContent(),'AI conversation');assert.equal(await page.locator('.unverified-study-text').count(),0);
    await send("I've had a long day and need a breather.");const study=await send("Now let's study asthma management.");assert.equal(study.spokenText,texts.study);assert.equal(await page.locator('.message.assistant .message-text').last().textContent(),study.content);assert.equal(study.groundingReview.medicalClaimCount,1);assert.equal(await page.locator('.message.assistant .answer-sources').last().count(),1);assert((await page.locator('.message.assistant .ai-conversation-status').last().textContent()).includes('not clinician reviewed'));
    const why=await send('Why?');assert.equal(why.spokenText,texts.why);const latest=providerRequests.filter(item=>item.kind==='primary').at(-1);assert(JSON.stringify(latest.context).includes('long day'));assert(JSON.stringify(latest.context).includes('asthma management'));
    assert.equal(why.aiTotal.calls,2);assert((await page.locator('.message.assistant .model-metadata').last().textContent()).includes(`$${why.aiTotal.estimatedCostUsd.toFixed(6)} total`));const count=(await current()).messages.length;await page.reload();await page.locator('.message.assistant').last().waitFor();assert.equal((await current()).messages.length,count);assert.equal(await page.locator('.message.assistant .message-text').last().textContent(),why.content);
  });
  await check('pending original quiz choices remain usable after a natural generated hint and still grade through the canonical answer key',async()=>{
    await fresh({conditionId:'asthma'});await send('Quiz me on asthma.');await page.locator('.chat-study-choices').waitFor();const question=(await current()).messages.at(-1).studyQuestion;
    const hint=await send("I don't understand. Can I have a hint?");assert.equal(hint.content,texts.hint);assert.deepEqual(hint.pendingStudyQuestion,question);assert.equal(await page.locator('.chat-study-choices button').count(),5);
    const count=await page.locator('.message.assistant').count();await page.locator('.chat-study-choices [data-choice=B]').click();await completed(count);assert.equal((await current()).messages.at(-1).studyAnswer.choiceId,'B');assert.equal(await page.locator('.chat-study-choices').count(),0);
  });
  await check('reviewed zero-source conversation reads aloud using the distinct reviewed marker in manual and spoken chat without claiming canonical provenance',async()=>{
    await fresh();const reply=await send("Hi. I'm not ready to study yet. Can we just chat?");const before=await page.evaluate(()=>window.__spoken.length);await page.locator('.message.assistant [data-action=read-message]').last().click();await page.waitForFunction(before=>window.__spoken.length>before,before);assert.equal(await page.evaluate(before=>window.__spoken.slice(before).join(''),before),reply.spokenText);
    await fresh();await action('voice-start');await page.waitForFunction(()=>document.querySelector('.voice-session-status')?.textContent.includes('Listening'));await page.evaluate(()=>window.__voiceFinal("Hi. I'm not ready to study yet. Can we just chat?"));await page.waitForFunction(()=>window.__spoken.length>0 && document.querySelector('.voice-session-status')?.textContent.includes('Listening'));
    const spoken=(await current()).messages.at(-1);assert.equal(spoken.reviewedDialogue,true);assert.equal(spoken.sourceVerified,false);assert.equal(spoken.canonicalSpokenText,false);assert.equal(await page.evaluate(()=>window.__spoken.join('')),spoken.spokenText);assert.equal(await page.locator('.coach-followups button:enabled').count(),0);await action('voice-stop');assert.equal(await page.locator('.coach-followups button:enabled').count(),3);assert.equal(requests.filter(item=>item.path.startsWith('/api/voice')).length,0);
  });
  await check('failed reviews, expired factual sources and imported reviewed prose never gain a readout shortcut',async()=>{
    await fresh();const review={version:1,status:'passed',externalClaimCount:1,medicalClaimCount:1,sourceChunkIds:['asthma:management'],reviewedAt:Date.now()};const baseMessage={role:'assistant',content:'Nonclinical readout gate fixture.',spokenText:'Nonclinical readout gate fixture.',reviewedDialogue:true,sourceVerified:false,canonicalSpokenText:false,current:true,groundingReview:review,citations:[{url:'https://www.nhlbi.nih.gov/health/asthma',title:'Mock source',expiresAt:'2026-11-09'}],createdAt:Date.now()};
    await page.route('**/api/state',async route=>{const response=await route.fetch();const data=await response.json();data.conversations=[{id:conversationId,title:'Reviewed readout gating fixtures',mode:'coach',createdAt:Date.now(),messages:[{...baseMessage,id:'failed-review',groundingReview:{...review,status:'failed'}},{...baseMessage,id:'expired-review',citations:[{...baseMessage.citations[0],expiresAt:'2026-10-08'}]},{...baseMessage,id:'imported-review',importedEvidence:true},{...baseMessage,id:'uncited-facts',citations:[]},{...baseMessage,id:'wrong-counts',groundingReview:{...review,externalClaimCount:0}}]}];await route.fulfill({response,json:data});});await page.reload();await page.locator('.message.assistant').last().waitFor();assert.equal(await page.locator('[data-action=read-message]').count(),0);await page.unroute('**/api/state');
  });
  const ledger={runAt:new Date().toISOString(),scope:'Only changed natural generated conversation/readout, source transitions, reviewed hint quiz continuity, operator default/history/export isolation and aggregate AI usage display. Real authenticated local APIs with mocked primary/reviewer completions; browser speech mocks. No physical phone audio or full prior QA rerun.',viewport:{width:360,height:800},results,pageErrors:errors,requests,providerRequests,paidProviderCalls:0};writeFileSync(new URL(only?`./natural-conversation-browser-results-scopes-${[...only].join('-')}.json`:'./natural-conversation-browser-results.json',import.meta.url),JSON.stringify(ledger,null,2));console.log(JSON.stringify({results,errors,providerDispatches:providerRequests.length,paidProviderCalls:0}));if(results.some(item=>!item.pass)||errors.length)process.exitCode=1;
}finally{await browser.close();if(server.closeVoiceSessions)await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
