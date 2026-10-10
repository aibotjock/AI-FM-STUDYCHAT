import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createStudyCurriculum, loadStudyCurriculum, needsStudyEvidence, STUDY_CONDITION_FILES } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { providerReviewContext } from './fixtures/natural-review-v3.js';

function actualCurrentCurriculum() {
  const contentUrl = new URL('../content/conditions/', import.meta.url);
  const packets = readdirSync(contentUrl).filter(file => STUDY_CONDITION_FILES.includes(file)).map(file => JSON.parse(readFileSync(new URL(file, contentUrl), 'utf8')));
  const checkedAt = packets.flatMap(packet => [packet.checkedAt, ...packet.conditions.flatMap(record => [record.review.checkedAt, ...record.sources.map(source => source.checkedAt)])]).sort().at(-1);
  return loadStudyCurriculum({ contentDir: contentUrl.pathname, now: () => Date.parse(`${checkedAt}T12:00:00Z`) });
}

// New independent safety cases; no existing passing curriculum groups repeated.
test('unknown clinical topic names cannot bypass evidence requirements through conversational wording',()=>{
  for(const query of ['Tell me about lupus','Explain myoclonus','What is sarcoidosis?']) assert.equal(needsStudyEvidence(query),true,query);
});

test('a follow-up must not jump backward across a newer unsupported clinical topic',()=>{
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  for(const query of ['Why?','Explain','What next?']) assert.deepEqual(curriculum.retrieve(query,{previousQueries:['Study asthma','Tell me about lupus']}),[],query);
});

test('quantitative medication requests expressed without the word dose require dose evidence',()=>{
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  for(const query of ['How many puffs for asthma?','How much prednisone for asthma?','What tablet strength for asthma?','How many mg for asthma?','What infusion rate for asthma?']) assert.equal(curriculum.retrieve(query).length,0,query);
});

test('ambiguous clinical acronyms in a study-habit request do not confer condition coverage',()=>{
  const asthma=studyCondition({aliases:['SMART','bronchial asthma']});
  const pneumonia=studyCondition({id:'pneumonia',name:'Community-acquired pneumonia',aliases:['CAP']});
  const curriculum=createStudyCurriculum({records:[asthma,pneumonia],now:()=>STUDY_NOW});
  for(const query of ['Make a SMART study schedule','How can I cap my study costs?']) assert.equal(curriculum.retrieve(query).length,0,query);
});

test('unlinked unknown-topic chat can clarify naturally without releasing unsourced facts',async t=>{
  const [{createApp},{mkdtempSync,rmSync},{tmpdir},{join},{once}]=await Promise.all([import('../server/index.js'),import('node:fs'),import('node:os'),import('node:path'),import('node:events')]);
  const dir=mkdtempSync(join(tmpdir(),'fm-retrieval-safety-'));
  let providerCalls=0;
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  const server=createApp({dataDir:dir,curriculum,env:{STUDY_ACCESS_TOKEN:'qa-safety-token-never-production-123456789',OPENAI_API_KEY:'qa-mock-key-only',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async(_url,request)=>{
    providerCalls++;
    const body=JSON.parse(request.body);
    const output=body.response_format.json_schema.name==='family_medicine_natural_review_v3'
      ? {version:3,approved:true,segments:[{id:'s1',approved:true,externalFactCount:0,claims:[],flags:[],questions:[]}]}
      : {segments:[{id:'s1',text:'I cannot verify a factual answer from the current study sources. You can choose an available study topic or open its cited source.',sourceChunkIds:[]}]};
    return new Response(JSON.stringify({model:'gpt-4.1-mini',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({token:'qa-safety-token-never-production-123456789'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify(body)});assert.equal(response.status,path==='/api/conversations'?201:200);return response.json();};
  const conversation=await post('/api/conversations',{title:'New safety test'});
  for(const [index,content] of ['Tell me about lupus','Explain myoclonus','What is sarcoidosis?'].entries()){
    const response=await post('/api/chat',{conversationId:conversation.id,content,requestId:`qa-new-safety-${index}`});
    assert.equal(response.message.reviewedDialogue,true,content);
    assert.equal(response.message.groundingReview.externalClaimCount,0,content);
    assert.deepEqual(response.message.citations,[],content);
  }
  assert.equal(providerCalls,6);
});

test('generic follow-up follows the latest named topic rather than the original linked-condition anchor',()=>{
  const curriculum=createStudyCurriculum({records:[studyCondition(),studyCondition({id:'diabetes',name:'Diabetes',aliases:['T2DM']})],now:()=>STUDY_NOW});
  const linked={conditionIds:['asthma']};
  assert.deepEqual([...new Set(curriculum.retrieve('Why?',{...linked,previousQueries:['Study asthma','Study diabetes']}).map(item=>item.conditionId))],['diabetes']);
  assert.equal(curriculum.retrieve('Why?',{...linked,previousQueries:['Study asthma','Tell me about lupus']}).length,0);
});


test('an actual asthma record does not grant coverage for an asthma-like resemblance term',()=>{
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  assert.equal(curriculum.retrieve('Study asthma-like cough').length,0);
});

test('a generic follow-up after an unsupported answer cannot reactivate an old topic through shared vocabulary',async t=>{
  const [{createApp},{mkdtempSync,rmSync},{tmpdir},{join},{once}]=await Promise.all([import('../server/index.js'),import('node:fs'),import('node:os'),import('node:path'),import('node:events')]);
  const dir=mkdtempSync(join(tmpdir(),'fm-abstention-followup-'));let providerCalls=0;
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  const server=createApp({dataDir:dir,curriculum,env:{STUDY_ACCESS_TOKEN:'qa-followup-token-not-production-123456789',OPENAI_API_KEY:'qa-mock-key-only',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async(_url,request)=>{
    providerCalls++;
    const unrelated='Mock follow-up fact: reassess control and adherence.';
    const output=providerCalls===1?{segments:[{id:'s1',text:'I cannot establish a lupus-specific answer from these sources. You can choose an available study topic or open its cited source.',sourceChunkIds:[]}]}:
      providerCalls===2?{version:3,approved:true,segments:[{id:'s1',approved:true,externalFactCount:0,claims:[],flags:[],questions:[]}]}:
      providerCalls===3?{segments:[{id:'s1',text:unrelated,sourceChunkIds:['asthma:follow-up']}]}:
      {version:3,approved:false,segments:[{id:'s1',approved:false,externalFactCount:1,claims:[{quote:unrelated,type:'medical',sourceChunkIds:['asthma:follow-up'],supports:[]}],flags:['unsupported_fact'],questions:[]}]};
    if(providerCalls===4){const body=JSON.parse(request.body);const data=providerReviewContext(body);const span=data.sourceSpans.find(item=>item.chunkId==='asthma:follow-up');output.segments[0].claims[0].supports=[{chunkId:'asthma:follow-up',spanId:span.spanId}];}
    return new Response(JSON.stringify({model:'gpt-4.1-mini',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({token:'qa-followup-token-not-production-123456789'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify(body)});assert.equal(response.status,path==='/api/conversations'?201:200);return response.json();};
  const conversation=await post('/api/conversations',{title:'Unsupported follow-up',conditionId:'asthma'});
  const unsupported=await post('/api/chat',{conversationId:conversation.id,content:'Tell me about medication adherence in lupus',requestId:'qa-unsupported-topic',conditionIds:['asthma']});assert.equal(unsupported.message.reviewedDialogue,true);assert.equal(unsupported.message.groundingReview.externalClaimCount,0);assert.equal(providerCalls,2);
  const followup=await post('/api/chat',{conversationId:conversation.id,content:'Why?',requestId:'qa-after-abstention',conditionIds:['asthma']});
  assert.equal(followup.message.unsupported,true);assert.deepEqual(followup.message.citations,[]);assert.equal(followup.message.content.includes('Mock follow-up fact'),false);assert.equal(providerCalls,4);
});

test('actual AF stroke-risk and prevention requests cannot collide with the generic acute-stroke alias',()=>{
  const curriculum=actualCurrentCurriculum();
  const selected={conditionIds:['atrial-fibrillation']};
  const queries=[
    'For board study only, what does the current atrial fibrillation study library say about stroke-risk assessment and anticoagulation?',
    'For board study, explain stroke prevention in atrial fibrillation.',
    'For board study, discuss the risk of stroke in AF.',
    'How does AF change risk assessment for stroke?',
    'For board study, preventing a stroke in atrial fibrillation.'
  ];
  for(const query of queries){
    const evidence=curriculum.retrieve(query,selected);
    // The packet now also contains a federal AF study section. Check bounded
    // current retrieval while retaining all three original prevention spans.
    assert.equal(evidence.length,Math.min(5,curriculum.get('atrial-fibrillation').chunks.length),query);
    for(const key of ['risk','drug','aspirin']) assert.ok(evidence.some(item=>item.key===`atrial-fibrillation:${key}`),query);
    assert.deepEqual([...new Set(evidence.map(item=>item.conditionId))],['atrial-fibrillation'],query);
    assert.ok(evidence.every(item=>item.key.startsWith('atrial-fibrillation:')),query);
  }
  const followup=curriculum.retrieve('Why?',{...selected,previousQueries:[queries[0]]});
  assert.deepEqual([...new Set(followup.map(item=>item.conditionId))],['atrial-fibrillation']);
  assert.deepEqual([...new Set(curriculum.retrieve('For board study, stroke-risk assessment and anticoagulation.',selected).map(item=>item.conditionId))],['atrial-fibrillation']);
  assert.deepEqual([...new Set(curriculum.retrieve('Study stroke prevention').map(item=>item.conditionId))],['ischemic-stroke']);
});

test('explicit ischemic-stroke comparisons and a newly named stroke syndrome remain eligible in AF context',()=>{
  const curriculum=actualCurrentCurriculum();
  for(const query of ['For board study, compare atrial fibrillation with acute ischemic stroke.','For board study, a new stroke syndrome after atrial fibrillation.']){
    const ids=new Set(curriculum.retrieve(query,{conditionIds:['atrial-fibrillation'],maxChunks:6}).map(item=>item.conditionId));
    assert.equal(ids.has('atrial-fibrillation'),true,query);
    assert.equal(ids.has('ischemic-stroke'),true,query);
  }
  assert.deepEqual([...new Set(curriculum.retrieve('Study acute ischemic stroke',{conditionIds:['atrial-fibrillation']}).map(item=>item.conditionId))],['ischemic-stroke']);
});

 test('AUB follow-ups retain current evidence across treatment and workup turns without borrowing it for a new condition',()=>{
 const refs=loadStudyCurriculum({contentDir:new URL('../content/conditions/',import.meta.url).pathname,now:()=>Date.parse('2026-10-10T12:00:00Z')});
 const initial=refs.retrieve('Explain abnormal uterine bleeding');assert.ok(initial.length);
 for(const [query,previousQueries] of [
 ['What is the treatment?',['Explain abnormal uterine bleeding']],
 ['What is the workup?',['Explain abnormal uterine bleeding','What is the treatment?']],
 ['How do we manage it?',['What is the treatment?','What is the workup?']]
 ]){const evidence=refs.retrieve(query,{conditionIds:['abnormal-uterine-bleeding'],previousQueries});assert.ok(evidence.length,query);assert.ok(evidence.every(item=>item.conditionId==='abnormal-uterine-bleeding'));}
 assert.equal(refs.retrieve('What is the treatment for a fictional new syndrome?').length,0);
 });

test('AUB chat persists the named topic for multiple clinical follow-ups in an unlinked conversation', async t=>{
 const {createApp}=await import('../server/index.js');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {once}=await import('node:events');
 const dir=mkdtempSync(join(tmpdir(),'fm-aub-chat-'));const server=createApp({dataDir:dir,env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();};
 const conversation=await post('/api/conversations',{title:'AUB continuity'});
 for(const content of ['Explain abnormal uterine bleeding','What is the treatment?','What is the workup?','How do we manage it?']){const reply=await post('/api/chat',{conversationId:conversation.id,content});assert.ok(reply.message.citations.length,content);assert.equal(reply.message.unsupported,undefined);assert.ok(reply.conversation.messages.filter(m=>m.role==='user').at(-1).studyConditionIds.includes('abnormal-uterine-bleeding'));}
});
