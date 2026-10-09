import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum, loadStudyCurriculum, needsStudyEvidence } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

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

test('unlinked unknown-topic chat abstains without dispatching a provider request',async t=>{
  const [{createApp},{mkdtempSync,rmSync},{tmpdir},{join},{once}]=await Promise.all([import('../server/index.js'),import('node:fs'),import('node:os'),import('node:path'),import('node:events')]);
  const dir=mkdtempSync(join(tmpdir(),'fm-retrieval-safety-'));
  let providerCalls=0;
  const curriculum=createStudyCurriculum({records:[studyCondition()],now:()=>STUDY_NOW});
  const server=createApp({dataDir:dir,curriculum,env:{STUDY_ACCESS_TOKEN:'qa-safety-token-never-production-123456789',OPENAI_API_KEY:'qa-mock-key-only',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async()=>{
    providerCalls++;
    return new Response(JSON.stringify({model:'gpt-4.1-mini',choices:[{finish_reason:'stop',message:{content:'Unretrieved mock provider answer; the safety test must prevent this dispatch.'}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200,headers:{'Content-Type':'application/json'}});
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
    assert.equal(response.message.unsupported,true,content);
    assert.deepEqual(response.message.citations,[],content);
  }
  assert.equal(providerCalls,0);
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
  const server=createApp({dataDir:dir,curriculum,env:{STUDY_ACCESS_TOKEN:'qa-followup-token-not-production-123456789',OPENAI_API_KEY:'qa-mock-key-only',OPENAI_MODEL:'gpt-4.1-mini'},fetchImpl:async()=>{
    providerCalls++;const selection=providerCalls===1?{chunkIds:[],questionId:null,unsupported:true}:{chunkIds:['asthma:follow-up'],questionId:null,unsupported:false};
    return new Response(JSON.stringify({model:'gpt-4.1-mini',choices:[{finish_reason:'stop',message:{content:JSON.stringify(selection)}}],usage:{prompt_tokens:10,completion_tokens:12}}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({token:'qa-followup-token-not-production-123456789'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify(body)});assert.equal(response.status,path==='/api/conversations'?201:200);return response.json();};
  const conversation=await post('/api/conversations',{title:'Unsupported follow-up',conditionId:'asthma'});
  const unsupported=await post('/api/chat',{conversationId:conversation.id,content:'Tell me about medication adherence in lupus',requestId:'qa-unsupported-topic',conditionIds:['asthma']});assert.equal(unsupported.message.unsupported,true);assert.equal(providerCalls,1);
  const followup=await post('/api/chat',{conversationId:conversation.id,content:'Why?',requestId:'qa-after-abstention',conditionIds:['asthma']});
  assert.equal(followup.message.unsupported,true);assert.deepEqual(followup.message.citations,[]);assert.equal(providerCalls,1);
});

test('actual AF stroke-risk and prevention requests cannot collide with the generic acute-stroke alias',()=>{
  const curriculum=loadStudyCurriculum({contentDir:new URL('../content/conditions/',import.meta.url).pathname,now:()=>STUDY_NOW});
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
    assert.equal(evidence.length,3,query);
    assert.deepEqual([...new Set(evidence.map(item=>item.conditionId))],['atrial-fibrillation'],query);
    assert.ok(evidence.every(item=>item.key.startsWith('atrial-fibrillation:')),query);
  }
  const followup=curriculum.retrieve('Why?',{...selected,previousQueries:[queries[0]]});
  assert.deepEqual([...new Set(followup.map(item=>item.conditionId))],['atrial-fibrillation']);
  assert.deepEqual([...new Set(curriculum.retrieve('For board study, stroke-risk assessment and anticoagulation.',selected).map(item=>item.conditionId))],['atrial-fibrillation']);
  assert.deepEqual([...new Set(curriculum.retrieve('Study stroke prevention').map(item=>item.conditionId))],['ischemic-stroke']);
});

test('explicit ischemic-stroke comparisons and a newly named stroke syndrome remain eligible in AF context',()=>{
  const curriculum=loadStudyCurriculum({contentDir:new URL('../content/conditions/',import.meta.url).pathname,now:()=>STUDY_NOW});
  for(const query of ['For board study, compare atrial fibrillation with acute ischemic stroke.','For board study, a new stroke syndrome after atrial fibrillation.']){
    const ids=new Set(curriculum.retrieve(query,{conditionIds:['atrial-fibrillation'],maxChunks:6}).map(item=>item.conditionId));
    assert.equal(ids.has('atrial-fibrillation'),true,query);
    assert.equal(ids.has('ischemic-stroke'),true,query);
  }
  assert.deepEqual([...new Set(curriculum.retrieve('Study acute ischemic stroke',{conditionIds:['atrial-fibrillation']}).map(item=>item.conditionId))],['ischemic-stroke']);
});
