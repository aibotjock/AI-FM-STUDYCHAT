import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  STUDY_CONDITION_FILES, createStudyCurriculum, loadStudyCurriculum,
  loadStudyFoundations, combineStudyCurricula,
} from '../server/study-curriculum.js';
import { createApp } from '../server/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-10T12:00:00Z');
const NEW_FILE = 'oncology_reference_expansion.json';
const LEGACY_KEY = 'hypertension:hypertension-q1';
// This historical value comes from the published pre-expansion acceptance check.
const LEGACY_FINGERPRINT = '37777f804e2b0bbf423f638bcab49fd06a39fa10c8bbdf09d7a5aefc4859bc5a';

let corpus;
function bank() {
  if (corpus) return corpus;
  const oldRecords = STUDY_CONDITION_FILES.filter(file => file !== NEW_FILE)
    .flatMap(file => JSON.parse(readFileSync(resolve(ROOT, 'content/conditions', file), 'utf8')).conditions);
  const oncology = JSON.parse(readFileSync(resolve(ROOT, 'content/conditions', NEW_FILE), 'utf8')).conditions;
  const before = createStudyCurriculum({ records: oldRecords, now: NOW });
  const after = loadStudyCurriculum({ contentDir: resolve(ROOT, 'content/conditions'), now: NOW });
  const foundations = loadStudyFoundations({ contentPath: resolve(ROOT, 'content/board-foundations.json'), now: NOW });
  corpus = {
    oldRecords, oncology, before, after, foundations,
    oldCombined: combineStudyCurricula([before, foundations]),
    expandedCombined: combineStudyCurricula([after, foundations]),
  };
  return corpus;
}

function assertQuestionHidden(question, label) {
  assert.ok(question, label);
  for (const field of ['correctChoiceId', 'explanation', 'rationale', 'distractorExplanations']) {
    assert.equal(Object.hasOwn(question, field), false, `${label}: premature ${field}`);
  }
  assert.deepEqual(question.choices.map(choice => Object.keys(choice).sort()), Array.from({ length: 5 }, () => ['id', 'text']), label);
}

test('actual supplemental references preserve all 550 existing US question identities and add only eight oncology questions', () => {
  const { oldRecords, before, after, foundations, oldCombined, expandedCombined, oncology } = bank();
  for (const library of [before, after, foundations]) assert.deepEqual(library.rejected, []);
  const prior = new Map(oldCombined.boardQuestions().map(question => [question.key, question.fingerprint]));
  const expanded = new Map(expandedCombined.boardQuestions().map(question => [question.key, question.fingerprint]));
  assert.equal(prior.size, 550);
  assert.equal(expanded.size, 558);
  assert.equal(prior.get(LEGACY_KEY), LEGACY_FINGERPRINT);
  for (const [key, fingerprint] of prior) assert.equal(expanded.get(key), fingerprint, key);
  const newKeys = oncology.flatMap(record => record.questions.map(question => `${record.id}:${question.id}`)).sort();
  assert.equal(newKeys.length, 8);
  assert.deepEqual([...expanded.keys()].filter(key => !prior.has(key)).sort(), newKeys);
  for (const original of oldRecords) {
    assert.deepEqual(after.get(original.id).review, original.review, `${original.id}: unchanged review dates`);
    assert.deepEqual(after.get(original.id).questions, before.get(original.id).questions, `${original.id}: unchanged public questions`);
  }
  assert.equal(after.list().diseaseConditions, 117);
  assert.equal(after.list().studyTopics, 7);
  assert.equal(after.list().questionCount + foundations.list().questionCount, 566);
});

test('all eight new oncology questions have hidden keys, canonical grading, recall cards and citations bound to actual sections', () => {
  const { oncology, after } = bank();
  const pool = new Map(after.boardQuestions().map(question => [question.key, question]));
  for (const record of oncology) {
    const visible = after.get(record.id);
    const evidence = after.retrieve(`Study ${record.name}`, { conditionIds: [record.id] });
    assert.ok(evidence.length > 0, record.id);
    const sourceIds = new Set(record.sources.map(source => source.id));
    const sections = new Map(record.sections.map(section => [section.id, section]));
    for (const question of record.questions) {
      const key = `${record.id}:${question.id}`;
      const pending = pool.get(key);
      assertQuestionHidden(pending, key);
      assertQuestionHidden(visible.questions.find(item => item.id === question.id), `${key}: public condition`);
      assert.ok(question.sectionIds.length > 0, `${key}: supporting sections`);
      for (const sectionId of question.sectionIds) {
        const section = sections.get(sectionId);
        assert.ok(section?.text.length > 0, `${key}: ${sectionId}`);
        assert.ok(section.sourceIds.every(sourceId => sourceIds.has(sourceId)), `${key}: canonical section sources`);
        assert.ok(section.sourceIds.some(sourceId => question.sourceIds.includes(sourceId)), `${key}: question-section source binding`);
      }
      assert.ok(question.sourceIds.every(sourceId => question.sectionIds.some(sectionId => sections.get(sectionId).sourceIds.includes(sourceId))), `${key}: all cited sources support a bound section`);
      const rendered = after.render({ chunkIds: [], questionId: key, unsupported: false }, evidence);
      assert.deepEqual(rendered.studyQuestion, { key, fingerprint: pending.fingerprint });
      assert.doesNotMatch(rendered.content, /canonical answer for|Rationale\n|Why the other options differ/);
      assert.equal(Object.hasOwn(rendered.studyQuestion, 'correctChoiceId'), false);
      assert.doesNotMatch(after.prompt(evidence), /"correctChoiceId"|"distractorExplanations"|"rationale"/);
      const canonicalUrls = record.sources.filter(source => question.sourceIds.includes(source.id)).map(source => source.url).sort();
      assert.deepEqual(rendered.citations.map(source => source.url).sort(), canonicalUrls, key);
      for (const choice of question.choices) {
        const grade = after.gradeBoardQuestion(pending, choice.id);
        assert.equal(grade.correct, choice.id === question.correctChoiceId, `${key}: choice ${choice.id}`);
        assert.equal(grade.correctChoiceId, question.correctChoiceId, key);
        assert.equal(grade.rationale, question.explanation, key);
        assert.equal(grade.current, true, key);
        assert.equal(grade.humanReview, false, key);
        assert.deepEqual(grade.citations.map(source => source.url).sort(), canonicalUrls, key);
        for (const citation of grade.citations) {
          const source = record.sources.find(item => item.url === citation.url);
          assert.equal(citation.locator, source.locator, key);
          assert.equal(citation.attribution, source.attribution, key);
          assert.equal(citation.rights.commercialClinicalApproval, false, key);
          assert.equal(new URL(citation.url).hostname, 'www.cancer.gov', key);
        }
      }
      const chatGrade = after.gradeQuestion(rendered.studyQuestion, question.correctChoiceId);
      assert.equal(chatGrade.studyAnswer.correct, true, key);
      assert.deepEqual(chatGrade.citations.map(source => source.url).sort(), canonicalUrls, key);
      const card = after.card(record.id, question.id);
      assert.equal(card.front, `${question.stem}\n\n${question.choices.map(choice => `${choice.id}. ${choice.text}`).join('\n')}`, key);
      assert.ok(card.back.includes(question.choices.find(choice => choice.id === question.correctChoiceId).text), key);
      assert.ok(card.back.includes(question.explanation), key);
      assert.equal(card.curriculumConditionId, record.id, key);
      assert.equal(card.curriculumQuestionId, question.id, key);
      assert.ok(canonicalUrls.includes(card.sourceUrl), key);
      assert.equal(card.sourceVerified, true, key);
      assert.equal(card.verified, false, key);
      assert.equal(card.humanReview, false, key);
      assert.equal(card.current, true, key);
    }
  }
});

test('an actual learner pending quiz remains authentic and grades after restart with the expanded reference library', async t => {
  const { before, after, foundations, oldRecords } = bank();
  assert.ok(after.get('hypertension').sections.length > before.get('hypertension').sections.length, 'This check must exercise a genuinely supplemented condition.');
  const dataDir = mkdtempSync(resolve(tmpdir(), 'fm-reference-bank-restart-'));
  let server, base, providerCalls = 0;
  const stop = async () => {
    if (!server?.listening) return;
    await server.closeVoiceSessions();
    await new Promise(done => server.close(done));
  };
  const start = async curriculum => {
    server = createApp({
      dataDir, curriculum, foundations, env: { OPENAI_API_KEY: '' },
      fetchImpl: async () => { providerCalls++; throw new Error('No model calls are permitted in this canonical acceptance check.'); },
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const request = async (path, method = 'GET', payload) => {
    const response = await fetch(base + path, {
      method, headers: { Origin: base, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    assert.ok([200, 201].includes(response.status), `${path}: ${response.status}`);
    return response.json();
  };
  t.after(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  await start(before);
  const conversation = await request('/api/conversations', 'POST', { mode: 'coach', conditionId: 'hypertension' });
  const initial = await request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Quiz me on hypertension', requestId: 'prior-reference-quiz' });
  assert.equal(initial.message.studyQuestion.key, LEGACY_KEY);
  assert.equal(initial.message.studyQuestion.fingerprint, LEGACY_FINGERPRINT);
  assert.doesNotMatch(initial.message.content, /canonical answer for|Rationale\n/);
  await stop(); await start(after);
  const state = await request('/api/state');
  const stored = state.conversations.find(item => item.id === conversation.id).messages.find(item => item.studyQuestion);
  assert.deepEqual(stored.studyQuestion, initial.message.studyQuestion);
  assert.equal(stored.importedEvidence, undefined);
  assert.equal(stored.studyQuestion.imported, undefined);
  const canonical = oldRecords.find(record => record.id === 'hypertension').questions.find(question => question.id === 'hypertension-q1');
  const graded = await request('/api/chat', 'POST', { conversationId: conversation.id, content: canonical.correctChoiceId, requestId: 'expanded-reference-grade' });
  assert.deepEqual(graded.message.studyAnswer, { ...initial.message.studyQuestion, choiceId: canonical.correctChoiceId, correct: true, correctChoiceId: canonical.correctChoiceId });
  assert.ok(graded.message.citations.length > 0);
  assert.equal(providerCalls, 0);
});
