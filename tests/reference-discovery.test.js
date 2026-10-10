import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReferenceDiscovery, parseReferenceDiscoveryXml } from '../server/reference-discovery.js';
import { createApp, projectReferenceDirectory } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';

const document = ({url='https://medlineplus.gov/asthma.html',title='<span class="qt0">Asthma</span>',organization='National Library of Medicine',extra=''}={}) => `<document rank="0" url="${url}"><content name="title">${title}</content><content name="organizationName">${organization}</content><content name="FullSummary"><p>Do not expose this clinical summary or a treatment recommendation.</p></content><content name="snippet">Do not expose this snippet.</content>${extra}</document>`;
const xml = (documents=document()) => `<?xml version="1.0" encoding="UTF-8"?><nlmSearchResult><term>asthma</term><file>opaque</file><server>server</server><count>1</count><retstart>0</retstart><retmax>6</retmax><list>${documents}</list></nlmSearchResult>`;
const xmlResponse = value => new Response(value,{headers:{'Content-Type':'application/xml'}});

test('NLM XML yields title and topic metadata only and rejects unknown structural markup', () => {
  const result=parseReferenceDiscoveryXml(xml());
  assert.deepEqual(result,[{title:'Asthma',url:'https://medlineplus.gov/asthma.html',organization:'National Library of Medicine',publishedDate:null}]);
  assert.equal(JSON.stringify(result).includes('treatment recommendation'),false);
  assert.equal(JSON.stringify(result).includes('snippet'),false);
  for(const payload of [
    '<!DOCTYPE x [<!ENTITY test SYSTEM "file:///etc/passwd">]>'+xml(),
    xml(document({title:'<script>alert(1)</script>'})),
    xml(document({title:'&unknown;'})),
    xml(document({title:'<span class="qt0">Unclosed'})),
    xml(document({extra:'<content name="unrecognized">new content</content>'})),
    xml().replace('<list>','<newElement/><list>'),
    xml().replace('rank="0"','rank="0" unsafe="1"'),
    xml(document({organization:'Another publisher'})),
    xml(Array.from({length:7},()=>document()).join('')),
  ]) assert.throws(()=>parseReferenceDiscoveryXml(payload),/unsupported response/);
  assert.deepEqual(parseReferenceDiscoveryXml(xml('')),[]);
  assert.equal(parseReferenceDiscoveryXml(xml(document({title:'Heart &amp; Vascular Diseases'})))[0].title,'Heart & Vascular Diseases');
});

test('discovery never returns vendor, non-topic, foreign, credential-bearing or executable URLs', () => {
  for(const url of ['javascript:alert(1)','https://evil.example/asthma.html','https://medlineplus.gov/ency/article/000141.htm','https://medlineplus.gov/druginfo/meds/a123.html','https://medlineplus.gov/rss.xml','https://medlineplus.gov/genetics/condition/asthma/','http://medlineplus.gov/asthma.html','https://u:p@medlineplus.gov/asthma.html','https://medlineplus.gov/asthma.html?redirect=evil','https://medlineplus.gov:123/asthma.html']) {
    assert.deepEqual(parseReferenceDiscoveryXml(xml(document({url}))),[],url);
  }
});

test('shared in-flight searches and the 12-hour bounded cache avoid duplicate upstream requests', async () => {
  let clock=Date.parse('2026-10-10T12:00:00Z'),calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const fetchImpl=async(url,options)=>{
    calls++;const request=new URL(url);
    assert.equal(request.origin,'https://wsearch.nlm.nih.gov');assert.equal(request.pathname,'/ws/query');
    assert.equal(request.searchParams.get('term'),'Asthma');
    assert.deepEqual([...request.searchParams.keys()].sort(),['db','term','retmax','rettype','tool'].sort());
    assert.equal(request.searchParams.get('db'),'healthTopics');assert.equal(request.searchParams.get('retmax'),'6');
    assert.equal(request.searchParams.get('rettype'),'brief');assert.equal(request.searchParams.get('tool'),'AI-FM-STUDYCHAT');
    assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers),['Accept']);
    await gate;return xmlResponse(xml());
  };
  const first=createReferenceDiscovery({fetchImpl,now:()=>clock}),second=createReferenceDiscovery({fetchImpl,now:()=>clock});
  const a=first.search('Asthma'),b=second.search(' asthma ');release();
  const [one,two]=await Promise.all([a,b]);assert.equal(calls,1);assert.deepEqual(one,two);assert.equal(one.cached,false);
  assert.equal((await second.search('asthma')).cached,true);assert.equal(calls,1);
  assert.equal(Date.parse(one.cacheExpiresAt)-Date.parse(one.fetchedAt),12*60*60*1000);
  clock+=12*60*60*1000;await first.search('Asthma');assert.equal(calls,2);
  await assert.rejects(first.search('x'.repeat(121)),/120 characters/);
  await assert.rejects(first.search('asthma\0'),/120 characters/);
  await assert.rejects(first.search({query:'asthma',chat:'secret'}),/120 characters/);
});

test('timeouts, bounded response bytes, provider limits and failures do not trigger automatic retries', async () => {
  let calls=0,aborted=false;
  const slow=createReferenceDiscovery({timeoutMs:20,fetchImpl:async(_,options)=>{calls++;options.signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}});
  await assert.rejects(slow.search('asthma'),error=>error.status===504);assert.equal(calls,1);assert.equal(aborted,true);
  const oversized=createReferenceDiscovery({fetchImpl:async()=>xmlResponse('x'.repeat(256*1024+1))});
  await assert.rejects(oversized.search('asthma'),/unsupported response/);
  const redirected=createReferenceDiscovery({fetchImpl:async()=>({ok:true,redirected:true,status:200})});
  await assert.rejects(redirected.search('asthma'),/temporarily unavailable/);
  let failureCalls=0;
  const unavailable=createReferenceDiscovery({fetchImpl:async()=>{failureCalls++;throw new Error('private network detail');}});
  await assert.rejects(unavailable.search('asthma'),error=>error.status===502 && !error.message.includes('private network detail'));assert.equal(failureCalls,1);
  let providerCalls=0;
  const limited=createReferenceDiscovery({now:()=>100000,fetchImpl:async()=>{providerCalls++;return xmlResponse(xml(''));}});
  for(let i=0;i<30;i++) await limited.search(`topic ${i}`);
  await assert.rejects(limited.search('topic 31'),error=>error.status===429);assert.equal(providerCalls,30);
  let clock=0,cacheCalls=0;
  const bounded=createReferenceDiscovery({now:()=>clock,fetchImpl:async()=>{cacheCalls++;return xmlResponse(xml(''));}});
  for(let i=0;i<101;i++){clock+=61000;await bounded.search(`topic ${i}`);}
  await bounded.search('topic 0');assert.equal(cacheCalls,102,'Oldest cache key is evicted after 100 entries.');
});

test('authenticated topic-only POST keeps reference transport separate from AI and protects request limits', async t => {
  const dataDir=mkdtempSync(join(tmpdir(),'studychat-discovery-'));let calls=0;
  const token='reference-discovery-session-token-long';const empty=createStudyCurriculum({records:[]});
  const server=createApp({dataDir,curriculum:empty,foundations:empty,env:{STUDY_ACCESS_TOKEN:token,OPENAI_API_KEY:'synthetic-key'},fetchImpl:()=>{throw new Error('No AI provider call is allowed.');},referenceFetchImpl:async(url,options)=>{calls++;assert.equal(new URL(url).searchParams.get('term'),'asthma');assert.equal(options.headers.Authorization,undefined);return xmlResponse(xml());}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dataDir,{recursive:true,force:true});});
  const post=(body,headers={})=>fetch(base+'/api/study/reference-search',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post({query:'asthma'})).status,401);assert.equal(calls,0);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(base+'/api/study/reference-search',{headers})).status,405);
  assert.equal((await post({query:'asthma',conversationId:'private'},headers)).status,400);assert.equal(calls,0);
  assert.equal((await post({query:'x'.repeat(121)},headers)).status,400);assert.equal(calls,0);
  const response=await post({query:'asthma'},headers);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.sources[0].title,'Asthma');assert.equal(result.sources[0].publishedDate,null);
  assert.match(result.purpose,/do not authorize/);assert.equal(JSON.stringify(result).includes('clinical summary'),false);assert.equal(calls,1);
  for(let i=0;i<7;i++) assert.equal((await post({query:'asthma'},headers)).status,200);
  assert.equal((await post({query:'asthma'},headers)).status,429);assert.equal(calls,1);
});

const appText=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function shippedUi({searchReply}={}) {
  const helperStart=appText.indexOf('function renderReferenceDirectory()'),helperEnd=appText.indexOf('function curriculumReviewNotice(');
  const comparison=appText.slice(appText.indexOf('function renderSourceComparison('),appText.indexOf('function renderAnswerEvidence('));
  const sourceReuse=appText.slice(appText.indexOf('function sourceReuseNotice('),helperStart);
  const input=appText.slice(appText.indexOf("document.addEventListener('input'"),appText.indexOf("document.addEventListener('change'"));
  const registry=projectReferenceDirectory(JSON.parse(readFileSync(new URL('../content/source-registry.json',import.meta.url),'utf8')));
  const nodes={'#external-reference-results':{innerHTML:''},'#reference-search-results':{innerHTML:''},'#reference-search-submit':{disabled:true,textContent:''}};
  const listeners={},requests=[];
  const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const safeUrl=value=>{try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};
  const factory=new Function('esc','safeUrl','mutate','api','$','curriculumIsVisible','document','initial',`
    let referenceDirectory=initial,referenceDirectoryOpen=true,referenceDirectoryLoading=false,referenceDirectoryError='',referenceDirectorySearch='',referenceDirectoryRequest=0;
    let referenceSearchQuery='',referenceSearchResults=null,referenceSearchLoading=false,referenceSearchError='',referenceSearchRequest=0;
    ${sourceReuse}\n${appText.slice(helperStart,helperEnd)}\n${comparison}\n${input}
    return {render:renderReferenceDirectory,search:searchReferences,compare:renderSourceComparison,publisherLink:publisherSearchLink};`);
  const ui=factory(esc,safeUrl,async(path,method,body)=>{requests.push({path,method,body});return searchReply ? searchReply(body) : {sources:parseReferenceDiscoveryXml(xml()),fetchedAt:'2026-10-10T12:00:00Z',cached:false};},()=>{throw new Error('Directory already loaded.');},selector=>nodes[selector],()=>true,{addEventListener:(name,listener)=>{listeners[name]=listener;}},registry);
  return {...ui,nodes,listeners,requests,registry};
}

test('shipped reference search is explicit, topic-only, safely linked and reachable from unsupported replies', async () => {
  const ui=shippedUi();assert.equal(ui.requests.length,0);
  assert.match(ui.render(),/Searching sends this topic to the National Library of Medicine/);
  assert.match(ui.render(),/without patient details/);
  assert.equal(ui.publisherLink(ui.registry.sources[0]),'');
  ui.listeners.input({target:{id:'reference-search-query',value:'Asthma & "next step"'}});
  assert.equal(ui.requests.length,0,'Typing never sends an external search.');
  const outbound=ui.publisherLink(ui.registry.sources[0]);assert.match(outbound,/Search this publisher on Google/);
  assert.match(outbound,/rel="noopener noreferrer"/);
  const href=outbound.match(/href="([^"]+)"/)[1].replace(/&amp;/g,'&');const url=new URL(href);
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/search');
  assert.equal(url.searchParams.get('q'),`site:${new URL(ui.registry.sources[0].url).hostname} Asthma & "next step"`);
  await ui.search();assert.deepEqual(ui.requests,[{path:'/api/study/reference-search',method:'POST',body:{query:'Asthma & "next step"'}}]);
  assert.match(ui.nodes['#reference-search-results'].innerHTML,/Publication date not supplied/);
  assert.match(appText,/if\(form.id==='reference-search-form'\) return searchReferences\(\)/);
  assert.match(appText,/data-action="reference-directory-open">Find references/);
  assert.match(appText,/case 'reference-directory-open': libraryTab='guidelines'/);
});

test('reference result labels preserve the submitted topic through pending and completed input edits', async () => {
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const ui=shippedUi({searchReply:async ({query})=>{
    if(query==='Asthma') await pending;
    return {sources:[{title:query,url:'https://medlineplus.gov/asthma.html',organization:'National Library of Medicine'}],fetchedAt:'2026-10-10T12:00:00Z',cached:false,query:'Untrusted response label'};
  }});
  const edit=value=>ui.listeners.input({target:{id:'reference-search-query',value}});
  edit('Asthma');
  const request=ui.search();
  edit('COPD');
  assert.equal(ui.requests.length,1,'Editing a pending topic does not send a search.');
  assert.equal(ui.requests[0].body.query,'Asthma');
  assert.match(ui.render(),/value="COPD"/);
  const outbound=ui.publisherLink(ui.registry.sources[0]);
  const href=outbound.match(/href="([^"]+)"/)[1].replace(/&amp;/g,'&');
  assert.match(new URL(href).searchParams.get('q'),/ COPD$/,'Publisher search follows the current input.');
  release();await request;
  assert.match(ui.nodes['#reference-search-results'].innerHTML,/Results for: <strong>Asthma<\/strong>/);
  assert.doesNotMatch(ui.nodes['#reference-search-results'].innerHTML,/COPD|Untrusted response label/);
  edit('Gout <test>');
  assert.equal(ui.requests.length,1,'Editing completed results does not send a search.');
  assert.match(ui.nodes['#reference-search-results'].innerHTML,/Results for: <strong>Asthma<\/strong>/);
  await ui.search();
  assert.equal(ui.requests.length,2);
  assert.equal(ui.requests[1].body.query,'Gout <test>');
  assert.match(ui.nodes['#reference-search-results'].innerHTML,/Results for: <strong>Gout &lt;test&gt;<\/strong>/);
  assert.doesNotMatch(ui.nodes['#reference-search-results'].innerHTML,/<test>|Untrusted response label/);
});

test('source comparison appears only for distinct references and displays escaped dates, scope and limitations', () => {
  const ui=shippedUi();const a={url:'https://example.org/one',title:'One',edition:'2025',jurisdiction:'US',kind:'clinical-guideline',checkedAt:'2026-10-10',publishedDate:'2025-02-01',limitations:'Adults only <script>alert(1)</script>'};
  const b={url:'https://example.org/two',title:'Two',edition:'2026',jurisdiction:'VA/DoD',kind:'official-clinical-reference'};
  assert.equal(ui.compare([a]),'');assert.equal(ui.compare([a,{...a,title:'Duplicate'}]),'');
  const rendered=ui.compare([a,b]);assert.match(rendered,/Compare cited source context/);
  assert.match(rendered,/Multiple references do not by themselves establish a disagreement/);
  assert.match(rendered,/Published 2025-02-01/);assert.match(rendered,/Publication date not supplied/);
  assert.match(rendered,/Source-check date not supplied/);assert.match(rendered,/VA\/DoD/);
  assert.match(rendered,/Adults only &lt;script&gt;/);assert.doesNotMatch(rendered,/<script>/);
});
