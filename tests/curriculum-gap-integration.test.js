import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  STUDY_CONDITION_FILES, studyRecordType, createStudyCurriculum,
  loadStudyCurriculum, loadStudyFoundations, combineStudyCurricula,
} from '../server/study-curriculum.js';
import { createBoardPractice } from '../server/board-practice.js';
import { createApp } from '../server/index.js';
import { buildNaturalSourceSpans } from '../server/natural-tutor.js';
import { validateMaintenanceCorpus } from '../scripts/validate-study-curriculum.js';
import { validateBoardBank } from '../scripts/validate-board-bank.js';
import { studyCondition } from './fixtures/study-condition.js';
import { readStudyReferenceFiles } from '../server/reference-expansion.js';

const ROOT = resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-10T12:00:00Z');
const MODULES = ['lifespan_prevention.json', 'geriatric_care.json', 'eye_sports_expansion.json', 'immunization_prevention.json'];

function corpus(now = NOW) {
  const files = STUDY_CONDITION_FILES.map(name => ({ name, records: JSON.parse(readFileSync(resolve(ROOT, 'content/conditions', name), 'utf8')).conditions }));
  const curriculum = loadStudyCurriculum({ contentDir: resolve(ROOT, 'content/conditions'), now });
  const foundations = loadStudyFoundations({ contentPath: resolve(ROOT, 'content/board-foundations.json'), now });
  const records = files.flatMap(file => file.records);
  const modules = files.filter(file => MODULES.includes(file.name));
  assert.deepEqual(modules.map(file => file.name).sort(), [...MODULES].sort());
  assert.deepEqual(curriculum.rejected, []);
  assert.deepEqual(foundations.rejected, []);
  return { files, modules, records, curriculum, foundations, combined: combineStudyCurricula([curriculum, foundations]) };
}

function syntheticTopic(index) {
  const record = studyCondition({ id: `topic-only-${index}`, name: `Synthetic study topic ${index}`, aliases: [], recordType: 'study-topic' });
  record.sources[0].url = `https://www.nhlbi.nih.gov/health/synthetic-topic-only-${index}`;
  record.sources[0].kind = 'official-recommendation';
  record.questions.forEach((question, position) => { question.stem = `Synthetic topic ${index}, vignette ${position}: select the supplied learning step.`; });
  return record;
}

test('gap modules count study topics separately and one hundred topic records cannot satisfy a disease-condition quota', () => {
  const topics = Array.from({ length: 100 }, (_, index) => syntheticTopic(index));
  const topicRuntime = createStudyCurriculum({ records: topics, now: NOW });
  assert.deepEqual(topicRuntime.rejected, []);
  assert.equal(topicRuntime.list().total, 100);
  assert.equal(topicRuntime.list().diseaseConditions, 0);
  assert.equal(topicRuntime.list().studyTopics, 100);
  const topicOnly = validateMaintenanceCorpus({ records: topics, now: NOW, minimumCorrectPositionShare: 0 });
  assert.equal(topicOnly.ok, false);
  assert.equal(topicOnly.manifest.conditions, 0);
  assert.equal(topicOnly.manifest.studyTopics, 100);
  assert.equal(topicOnly.manifest.currentStudyTopics, 100);
  assert.equal(topicOnly.manifest.formalGuidelineConditions, 0);
  assert.ok(topicOnly.problems.some(problem => /at least 100 disease conditions/.test(problem)));
  assert.ok(topicOnly.problems.some(problem => /at least 100 conditions with formal/.test(problem)));
  const { modules, records, curriculum } = corpus();
  for (const file of modules) {
    const expectedType = file.name === 'eye_sports_expansion.json' ? 'condition' : 'study-topic';
    assert.ok(file.records.length > 0, file.name);
    assert.ok(file.records.every(record => studyRecordType(record) === expectedType), file.name);
    for (const record of file.records) assert.equal(curriculum.get(record.id).recordType, expectedType, record.id);
  }
  const result = validateBoardBank({ rootDir: ROOT, now: NOW });
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.manifest.conditions, records.filter(record => studyRecordType(record) === 'condition').length);
  assert.equal(result.manifest.studyTopics, records.filter(record => studyRecordType(record) === 'study-topic').length);
  assert.ok(result.manifest.studyTopics >= 7);
  assert.equal(result.manifest.clinicalAccuracyCertified, false);
});

test('new gonorrhea dosing retrieves exact canonical source spans while the uncovered emergency-eye dose stays withheld', () => {
  const { combined, records, modules } = corpus();
  const gonorrhea = records.find(record => record.id === 'gonorrhea');
  assert.ok(gonorrhea, 'The existing gonorrhea record must remain available.');
  const evidence = combined.retrieve('For board study, what is the recommended ceftriaxone dose for uncomplicated gonorrhea in an adult weighing 80 kg?', { conditionIds: [gonorrhea.id], maxChunks: 6 });
  assert.ok(evidence.length > 0);
  assert.ok(evidence.some(chunk => /\b500\s*mg\b/.test(chunk.text)), 'The newly sourced dose-bearing teaching section must reach retrieval.');
  for (const chunk of evidence) {
    assert.equal(chunk.conditionId, gonorrhea.id);
    const section = gonorrhea.sections.find(section => `${gonorrhea.id}:${section.id}` === chunk.key);
    assert.equal(chunk.text, section.text);
    assert.deepEqual(chunk.sourceIds, section.sourceIds);
    assert.deepEqual(chunk.citations.map(source => source.url), gonorrhea.sources.filter(source => section.sourceIds.includes(source.id)).map(source => source.url));
  }
  const spans = buildNaturalSourceSpans({ references: combined, evidence });
  assert.equal(spans.length, evidence.length);
  for (const span of spans) {
    assert.equal(span.excerpt, evidence.find(chunk => chunk.key === span.chunkId).text);
    assert.match(span.spanId, /^span_[a-f0-9]{64}$/);
  }
  const clientAltered = evidence.map(chunk => ({ ...chunk, text: 'CLIENT-INVENTED DOSE 999999 mg', citations: [{ url: 'https://attacker.example/fake-reference' }] }));
  assert.deepEqual(buildNaturalSourceSpans({ references: combined, evidence: clientAltered }), spans, 'Client-provided prose must not rewrite trusted dose evidence.');
  const eyeRecords = modules.find(file => file.name === 'eye_sports_expansion.json').records;
  const glaucoma = eyeRecords.find(record => record.id === 'acute-angle-closure-glaucoma');
  assert.ok(glaucoma, 'The acute angle-closure glaucoma module is required for this uncovered-dose boundary.');
  const unsupported = combined.retrieve(`For a hypothetical board vignette on ${glaucoma.name}, what is the acetazolamide dose for acute angle-closure glaucoma?`, { conditionIds: [glaucoma.id], maxChunks: 6 });
  assert.deepEqual(unsupported, [], 'The module must not invent an emergency dosing protocol it does not contain.');
  const withheld = combined.render({ chunkIds: [], questionId: null, unsupported: true }, unsupported);
  assert.equal(withheld.unsupported, true);
  assert.deepEqual(withheld.citations, []);
  assert.doesNotMatch(withheld.content, /\b\d+\s*mg\b/);
  assert.equal(gonorrhea.review.checkedAt, '2026-10-09', 'Adding a new teaching section must not renew the unchanged parent review.');
  assert.equal(gonorrhea.review.expiresAt, '2026-11-09');
});

test('new gap-module HTTP routes enforce access, grade and save cited cards, and pause on original source expiry without renewing dates', async t => {
  let clock = NOW;
  const { modules, records, curriculum, foundations } = corpus(() => clock);
  const newRecords = modules.flatMap(file => file.records);
  const supplementalSources = readStudyReferenceFiles(resolve(ROOT, 'content/reference-expansion'), { now: NOW }).flatMap(file => file.parsed.conditions);
  const dataDir = mkdtempSync(resolve(tmpdir(), 'fm-gap-module-http-'));
  const token = 'gap-module-http-test-token-longer-than-24-characters';
  let providerCalls = 0;
  const server = createApp({
    dataDir, curriculum, foundations,
    boardPractice: createBoardPractice({ curricula: [curriculum, foundations], now: () => clock }),
    env: { STUDY_ACCESS_TOKEN: token },
    fetchImpl: async () => { providerCalls++; throw new Error('Provider calls are forbidden in the gap-module HTTP checks.'); },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.closeVoiceSessions();
    await new Promise(resolveClose => server.close(resolveClose));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of modules) assert.equal((await fetch(base + '/api/curriculum/' + file.records[0].id)).status, 401, file.name);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const postHeaders = { ...headers, Origin: base, 'Content-Type': 'application/json' };
  const index = await (await fetch(base + '/api/curriculum', { headers })).json();
  assert.equal(index.diseaseConditions, records.filter(record => studyRecordType(record) === 'condition').length);
  assert.equal(index.studyTopics, records.filter(record => studyRecordType(record) === 'study-topic').length);
  for (const record of newRecords) {
    const detailResponse = await fetch(base + '/api/curriculum/' + record.id, { headers });
    assert.equal(detailResponse.status, 200, record.id);
    const { condition } = await detailResponse.json();
    assert.equal(condition.recordType, studyRecordType(record), record.id);
    assert.equal(condition.humanReview, false, record.id);
    assert.ok(condition.questions.every(question => !Object.hasOwn(question, 'correctChoiceId') && !Object.hasOwn(question, 'rationale')), record.id);
    for (const source of condition.sources) {
      const canonical = record.sources.find(item => item.id === source.id) || supplementalSources.filter(patch => patch.conditionId === record.id).flatMap(patch => patch.sources).find(item => item.id === source.id);
      assert.ok(canonical, `Every displayed source must have a repository binding: ${record.id}:${source.id}`);
      for (const key of ['url', 'locator', 'jurisdiction', 'limitations', 'attribution', 'derivativeNotice']) {
        if (canonical[key] !== undefined) assert.equal(source[key], canonical[key], `${record.id}:${source.id}:${key}`);
      }
      if (canonical.rights) assert.deepEqual(source.rights, canonical.rights, record.id);
    }
    const question = record.questions[0];
    const answerResponse = await fetch(base + '/api/curriculum/' + record.id + '/answer', { method: 'POST', headers: postHeaders, body: JSON.stringify({ questionId: question.id, choiceId: question.correctChoiceId }) });
    assert.equal(answerResponse.status, 200, record.id);
    const answer = await answerResponse.json();
    assert.equal(answer.correct, true, record.id);
    assert.equal(answer.rationale, question.explanation, record.id);
    assert.equal(answer.choices.length, 5, record.id);
    assert.deepEqual(answer.sources.map(source => source.url), record.sources.filter(source => question.sourceIds.includes(source.id)).map(source => source.url), record.id);
    const cardResponse = await fetch(base + '/api/curriculum/' + record.id + '/card', { method: 'POST', headers: postHeaders, body: JSON.stringify({ questionId: question.id }) });
    assert.equal(cardResponse.status, 201, record.id);
    const { card } = await cardResponse.json();
    assert.equal(card.curriculumConditionId, record.id, record.id);
    assert.equal(card.curriculumQuestionId, question.id, record.id);
    assert.equal(card.verified, false, record.id);
    assert.equal(card.humanReview, false, record.id);
    assert.equal(card.sourceExpiresAt, condition.expiresAt, record.id);
    assert.equal(card.sourceUrl, answer.sources[0].url, record.id);
  }
  const expiring = newRecords.find(record => studyRecordType(record) === 'study-topic');
  const expiry = curriculum.get(expiring.id).expiresAt;
  const datesBefore = JSON.stringify(records.map(record => ({ id: record.id, review: record.review, sources: record.sources.map(source => ({ checkedAt: source.checkedAt, rightsCheckedAt: source.rights?.checkedAt })) })));
  clock = Date.parse(expiry + 'T00:00:00Z');
  assert.equal(curriculum.get(expiring.id).current, false);
  assert.deepEqual(curriculum.retrieve('Study ' + expiring.name, { conditionIds: [expiring.id] }), []);
  assert.ok(curriculum.boardQuestions().every(question => question.conditionId !== expiring.id));
  const expiredDetail = await (await fetch(base + '/api/curriculum/' + expiring.id, { headers })).json();
  assert.equal(expiredDetail.condition.current, false);
  assert.equal(expiredDetail.condition.expiresAt, expiry);
  for (const action of ['answer', 'card']) {
    const response = await fetch(base + '/api/curriculum/' + expiring.id + '/' + action, { method: 'POST', headers: postHeaders, body: JSON.stringify({ questionId: expiring.questions[0].id, choiceId: expiring.questions[0].correctChoiceId }) });
    assert.equal(response.status, 409, action);
  }
  assert.equal(JSON.stringify(records.map(record => ({ id: record.id, review: record.review, sources: record.sources.map(source => ({ checkedAt: source.checkedAt, rightsCheckedAt: source.rights?.checkedAt })) }))), datesBefore);
  assert.equal(providerCalls, 0);
});
