import { createApp } from '../server/index.js';
import { loadStudyCurriculum } from '../server/study-curriculum.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const contentDir=resolve(new URL('../content/conditions/',import.meta.url).pathname);
const sourceFiles=readdirSync(contentDir).filter(name=>name.endsWith('.json')).sort().map(name=>{const bytes=readFileSync(join(contentDir,name));return {name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};});
const sourceRecords=readdirSync(contentDir).filter(name=>name.endsWith('.json')).flatMap(name=>JSON.parse(readFileSync(join(contentDir,name),'utf8')).conditions);
const curriculum=loadStudyCurriculum({contentDir});
const catalog=curriculum.list();
assert.equal(curriculum.count,100);assert.equal(catalog.questionCount,200);assert.deepEqual(curriculum.rejected,[]);
const titleLongest=[...catalog.conditions].sort((a,b)=>b.title.length-a.title.length)[0];
const details=catalog.conditions.map(item=>curriculum.get(item.id));
const conditionLongest=[...details].sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)[0];
const sectionLongest=details.flatMap(item=>item.chunks.map(chunk=>({conditionId:item.id,heading:chunk.heading,text:chunk.text}))).sort((a,b)=>b.text.length-a.text.length)[0];
const questionLongest=details.flatMap(item=>item.questions.map((question,index)=>({conditionId:item.id,index,questionId:question.id,stem:question.stem,displayLength:question.stem.length+question.choices.reduce((sum,choice)=>sum+choice.text.length,0)}))).sort((a,b)=>b.displayLength-a.displayLength)[0];
const answerLongest=sourceRecords.flatMap(item=>item.questions.map((question,index)=>({conditionId:item.id,index,questionId:question.id,displayLength:question.explanation.length+Object.values(question.distractorExplanations).reduce((sum,value)=>sum+value.length,0)}))).sort((a,b)=>b.displayLength-a.displayLength)[0];
const sourceLongest=details.flatMap(item=>item.sources.map(source=>({conditionId:item.id,sourceId:source.id,displayLength:JSON.stringify(source).length}))).sort((a,b)=>b.displayLength-a.displayLength)[0];
const samples=new Map();
for(const [label,sample] of [['longest title',titleLongest],['largest full condition',conditionLongest],['longest section',sectionLongest],['longest question',questionLongest],['longest answer explanations',answerLongest],['largest source metadata',sourceLongest]]){
  const id=sample.conditionId||sample.id;
  if(!samples.has(id))samples.set(id,{conditionId:id,labels:[],questionIndexes:new Set([0])});
  samples.get(id).labels.push(label);if(sample.index!==undefined)samples.get(id).questionIndexes.add(sample.index);
}
const token='qa-production-corpus-token-not-real-123456789';let providerDispatches=0;
const dir=mkdtempSync(join(tmpdir(),'fm-real-corpus-ui-'));
const server=createApp({dataDir:dir,curriculum,env:{STUDY_ACCESS_TOKEN:token},fetchImpl:async()=>{providerDispatches++;throw new Error('Production dataset smoke must not dispatch an AI provider request.');}});
server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],overflows=[],results=[];page.on('pageerror',error=>errors.push(error.message));
async function geometry(label){const data=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,wideElements:[...document.querySelectorAll('#main *')].filter(element=>{const rect=element.getBoundingClientRect();return rect.width>0&&(rect.left<-.5||rect.right>innerWidth+.5);}).map(element=>({tag:element.tagName,className:element.className,left:Math.round(element.getBoundingClientRect().left),right:Math.round(element.getBoundingClientRect().right)})).slice(0,12)}));if(data.document>data.viewport||data.wideElements.length)overflows.push({label,...data});return data;}
try{
  const login=await context.request.post(base+'/api/login',{data:{token}});assert.equal(login.status(),200);
  await page.goto(base+'/#library');await page.locator('.condition-card').first().waitFor();
  const apiCatalog=await (await context.request.get(base+'/api/curriculum')).json();assert.equal(apiCatalog.total,100);assert.equal(apiCatalog.questionCount,200);assert.equal(await page.locator('.condition-card').count(),100);const counter=await page.locator('#condition-count').textContent();assert(counter.includes('100 conditions shown'));assert(counter.includes('100 in the library'));assert(counter.includes('200 original questions in the library'));await geometry('real 100-condition catalog');results.push({name:'Actual shipped catalog displays 100 conditions and 200 original questions',pass:true});
  for(const sample of samples.values()){
    await page.locator(`[data-action="curriculum-open"][data-id="${sample.conditionId}"]`).click();await page.locator('#board-question').waitFor();const condition=curriculum.get(sample.conditionId);assert.equal(await page.locator('.condition-header h2').textContent(),condition.title);assert.equal(await page.locator('.condition-sections .condition-section').count(),condition.chunks.length);assert((await page.locator('.condition-section').last().textContent()).includes(condition.sources[0].title));
    await geometry(`${sample.labels.join(', ')}: ${sample.conditionId}`);
    for(const index of [...sample.questionIndexes].sort()){
      for(let current=0;current<index;current++)await page.locator('[data-action="curriculum-next"]').click();
      assert.equal(await page.locator('.question-stem').textContent(),condition.questions[index].stem);await geometry(`question ${index+1}: ${sample.conditionId}`);
      // Grading is only a prerequisite for displaying real longest explanation text.
      // Correctness/interaction behavior was checked in separate passing suites.
      await page.locator('[data-action="curriculum-choice"]').first().click();await page.locator('[data-action="curriculum-answer"]').click();await page.locator('.question-feedback').waitFor();await geometry(`real explanation text ${index+1}: ${sample.conditionId}`);
      if(index>0)for(let current=index;current>0;current--)await page.locator('[data-action="curriculum-previous"]').click();
    }
    results.push({name:`Real content fits mobile viewport: ${sample.labels.join(', ')}`,conditionId:sample.conditionId,pass:true});await page.locator('[data-action="curriculum-back"]').click();await page.locator('.condition-card').first().waitFor();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(overflows,[]);assert.equal(providerDispatches,0);results.push({name:'No JavaScript errors, overflow or AI dispatch with real dataset',pass:true});
  const report={runAt:new Date().toISOString(),sourceFiles,scope:'One new smoke using the actual shipped 100-condition/200-question corpus. Longest title, complete condition, section, question, explanations and source metadata at360x800. Prior fixture UI/voice/model/zoom suites not repeated. Grading actions only display real explanation text; no new clinical correctness claim.',viewport:{width:360,height:800},catalog:{conditionCount:apiCatalog.total,questionCount:apiCatalog.questionCount},extremes:{title:{conditionId:titleLongest.id,length:titleLongest.title.length},condition:{conditionId:conditionLongest.id,jsonLength:JSON.stringify(conditionLongest).length},section:{conditionId:sectionLongest.conditionId,length:sectionLongest.text.length},question:questionLongest,explanations:answerLongest,source:sourceLongest},results,pageErrors:errors,overflows,providerDispatches,paidProviderCalls:0,clinicalAccuracyEvaluated:false};writeFileSync(new URL('./curriculum-production-data-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({catalog:report.catalog,results,errors,overflows,providerDispatches}));
}catch(error){writeFileSync(new URL('./curriculum-production-data-results.json',import.meta.url),JSON.stringify({runAt:new Date().toISOString(),scope:'Actual production-corpus smoke',results,error:error.message,pageErrors:errors,overflows,providerDispatches,paidProviderCalls:0},null,2));throw error;}
finally{await browser.close();await server.closeVoiceSessions();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
