import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceEditorialWordBudget } from '../shared/source-reuse.js';
import { createStudyCurriculum, validateStudyCondition, loadStudyCurriculum, loadStudyFoundations } from '../server/study-curriculum.js';
import { validateMaintenanceCorpus } from '../scripts/validate-study-curriculum.js';
import { buildNaturalSourceSpans } from '../server/natural-tutor.js';

const NOW=Date.parse('2026-10-10T12:00:00Z');
const records=JSON.parse(readFileSync(new URL('../content/conditions/treatment_expansion.json',import.meta.url),'utf8')).conditions;
const source=records[0].sources[0];

test('editorial allowance is source-specific and cannot be granted by an approval flag or lookalike URL',()=>{
  assert.equal(sourceEditorialWordBudget(source,{now:NOW}),2000);
  const olderCheck = {...source,checkedAt:'2026-10-09'};
  assert.equal(sourceEditorialWordBudget(olderCheck,{now:NOW}),2000);
  assert.equal(olderCheck.checkedAt,'2026-10-09','Permission review does not renew medical currency.');
  const changes=[
    {url:source.url+'?approved=true'}, {url:source.url+'#table1'},
    {url:source.url.replace('www.cdc.gov','www.cdc.gov.example.org')},
    {organization:'CDC'}, {reuse:'licensed-full-text'},
    {rights:{...source.rights,commercialClinicalApproval:true}},
    {rights:{...source.rights,approved:true}},
    {rights:{...source.rights,checkedAt:'2026-02-30'}},
    {rights:{...source.rights,checkedAt:'2026-10-11'}},
    {checkedAt:'2026-10-11'},
  ];
  for(const change of changes) assert.equal(sourceEditorialWordBudget({...source,...change},{now:NOW}),200,JSON.stringify(change));
});

test('expanded study evidence retains canonical spans, source links and explicitly pending clinical approval',()=>{
  const references=createStudyCurriculum({records,now:()=>NOW});
  assert.equal(references.rejected.length,0);
  const evidence=references.retrieve('Study first-line antibiotics for pneumonic plague');
  assert.ok(evidence.length);
  assert.ok(evidence.every(item=>item.conditionId==='plague'));
  const spans=buildNaturalSourceSpans({references,evidence});
  for(const span of spans) assert.equal(span.excerpt,evidence.find(item=>item.key===span.chunkId).text);
  const question=references.get('plague').questions[0];
  assert.equal(question.correctChoiceId,undefined);
  const result=references.answer('plague',question.id,'B');
  assert.equal(result.correct,true);
  assert.equal(result.humanReview,false);
  assert.equal(result.sources[0].rights.commercialClinicalApproval,false);
  assert.equal(result.sources[0].url,source.url);
  assert.equal(references.card('plague',question.id).verified,false);
  const later=createStudyCurriculum({records,now:()=>Date.parse('2026-11-10T12:00:00Z')});
  assert.equal(later.retrieve('pneumonic plague').length,0);
});

test('different co-sources remain bounded while duplicate citations share document rights without renewing dates',()=>{
  const validate=value=>validateMaintenanceCorpus({records:value,now:NOW,minimumConditions:1,minimumFormalConditions:1,minimumCorrectPositionShare:0});
  assert.equal(validate(records).ok,true);
  const mixed=structuredClone(records[0]);
  mixed.sources.push({...mixed.sources[0],id:'restricted-source',url:'https://www.nhlbi.nih.gov/health/mock',organization:'NIH',rights:undefined});
  for(const section of mixed.sections) section.sourceIds.push('restricted-source');
  assert.ok(validate([mixed]).problems.some(item=>item.includes('200-word concise-source budget')));
  const duplicate=structuredClone(records[0]);
  duplicate.id='plague-copy';duplicate.name='Different fictional study topic';delete duplicate.sources[0].rights;
  duplicate.questions.forEach((question,index)=>{question.id=`copy-q${index}`;question.stem=`Different fictional vignette ${index}: ${question.stem}`;});
  duplicate.sources[0].checkedAt='2026-10-09';
  const shared=validate([records[0],duplicate]);
  assert.ok(!shared.problems.some(item=>item.includes('200-word concise-source budget')));
  assert.equal(duplicate.sources[0].checkedAt,'2026-10-09');
  assert.equal(validate([duplicate]).manifest.sourceEditorialBudgets.length,0,'An unannotated citation alone grants no expanded budget.');
});

test('a source cannot be checked before publication and future runtime envelopes cannot supply evidence',t=>{
  const invalid=structuredClone(records[0]);invalid.sources[0].publishedDate='2026-10-10';invalid.sources[0].checkedAt='2026-10-09';delete invalid.sources[0].rights;
  assert.ok(validateStudyCondition(invalid,{now:NOW}).some(item=>item.includes('valid dates')));
  const directory=mkdtempSync(join(tmpdir(),'fm-source-envelope-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'treatment_expansion.json');
  writeFileSync(path,JSON.stringify({schemaVersion:1,checkedAt:'2026-10-11',conditions:records}));
  assert.throws(()=>loadStudyCurriculum({contentDir:directory,now:()=>NOW}),/envelope/);
  writeFileSync(path,JSON.stringify({schemaVersion:1,topicType:'foundations',checkedAt:'2026-10-11',conditions:[]}));
  assert.throws(()=>loadStudyFoundations({contentPath:path,now:()=>NOW}),/envelope/);
});
