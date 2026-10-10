import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  STUDY_CONDITION_FILES, loadStudyCurriculum, loadStudyFoundations,
  combineStudyCurricula, createStudyCurriculum,
} from '../server/study-curriculum.js';
import { createBoardPractice } from '../server/board-practice.js';
import { createApp } from '../server/index.js';
import { allocateMixedPractice } from '../shared/blueprint.js';
import { validateBoardBank } from '../scripts/validate-board-bank.js';

const ROOT = resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-10T12:00:00Z');
// Preserved pre-expansion identity, calculated from the prior published corpus.
// This intentionally does not recalculate its expectation from current data.
const LEGACY_KEY = 'hypertension:hypertension-q1';
const LEGACY_FINGERPRINT = '37777f804e2b0bbf423f638bcab49fd06a39fa10c8bbdf09d7a5aefc4859bc5a';

let cachedBank;
function bank() {
  if (cachedBank) return cachedBank;
  const files = STUDY_CONDITION_FILES.map(file => resolve(ROOT, 'content/conditions', file));
  files.push(resolve(ROOT, 'content/board-foundations.json'));
  const records = files.flatMap(file => JSON.parse(readFileSync(file, 'utf8')).conditions);
  const curriculum = loadStudyCurriculum({ contentDir: resolve(ROOT, 'content/conditions'), now: NOW });
  const foundations = loadStudyFoundations({ contentPath: resolve(ROOT, 'content/board-foundations.json'), now: NOW });
  const combined = combineStudyCurricula([curriculum, foundations]);
  const inventory = records.flatMap(record => record.questions.map(question => ({ record, question, key: `${record.id}:${question.id}` })));
  cachedBank = { records, curriculum, foundations, combined, inventory };
  return cachedBank;
}

function assertHiddenQuestion(question, message) {
  for (const key of ['correctChoiceId', 'explanation', 'rationale', 'distractorExplanations']) {
    assert.equal(Object.hasOwn(question, key), false, `${message}: premature ${key}`);
  }
  assert.deepEqual(question.choices.map(choice => Object.keys(choice).sort()), Array.from({ length: 5 }, () => ['id', 'text']), message);
}

test('expanded real bank supplies at least 400 current US study questions without claiming blanket rights or clinical certification', () => {
  const { records, curriculum, foundations, combined, inventory } = bank();
  const result = validateBoardBank({ rootDir: ROOT, now: NOW });
  assert.deepEqual(curriculum.rejected, []);
  assert.deepEqual(foundations.rejected, []);
  assert.equal(result.ok, true, result.problems.join('\n'));
  const current = combined.boardQuestions();
  const comparative = inventory.filter(item => item.question.examScope === 'comparative-study');
  assert.ok(current.length >= 400);
  assert.ok(comparative.length > 0, 'International comparative material must remain visible as a separate scope.');
  assert.equal(result.manifest.inventoryQuestions, inventory.length);
  assert.equal(result.manifest.currentQuestions, current.length);
  assert.equal(inventory.length, current.length + comparative.length);
  assert.equal(result.manifest.conditions, records.filter(record => record.recordType !== 'foundation').length);
  assert.equal(result.manifest.foundationTopics, records.filter(record => record.recordType === 'foundation').length);
  assert.equal(result.manifest.currentMeetsMinimum, true);
  assert.equal(result.manifest.satisfiesMinimum, true);
  assert.ok(result.manifest.annotatedDocumentReuseQuestions >= 200);
  assert.ok(result.manifest.annotatedDocumentReuseQuestions < inventory.length);
  assert.ok(result.manifest.unresolvedDocumentReuseQuestionKeys.includes(LEGACY_KEY));
  assert.equal(result.manifest.humanReviewed, false);
  assert.equal(result.manifest.commercialActivationApproved, false);
  assert.equal(result.manifest.clinicalAccuracyCertified, false);
  assert.equal(result.manifest.alignment.completeExamCoverage, 'not-established');
  assert.equal(result.manifest.alignment.officialScore, false);
  assert.match(result.manifest.rightsMeaning, /do not approve clinical facts/);
});

test('comparative questions remain usable in the study library while US practice excludes them and retains legacy identity', () => {
  const { inventory, combined } = bank();
  const boardQuestions = combined.boardQuestions();
  const boardKeys = new Set(boardQuestions.map(question => question.key));
  for (const { record, question, key } of inventory.filter(item => item.question.examScope === 'comparative-study')) {
    assert.equal(boardKeys.has(key), false, key);
    const publicQuestion = combined.get(record.id).questions.find(item => item.id === question.id);
    assert.equal(publicQuestion.examScope, 'comparative-study', key);
    assertHiddenQuestion(publicQuestion, key);
    const answer = combined.answer(record.id, question.id, question.correctChoiceId);
    assert.equal(answer.correct, true, key);
    assert.equal(answer.current, true, key);
    assert.ok(answer.sources.length > 0, key);
    const card = combined.card(record.id, question.id);
    assert.equal(card.current, true, key);
    assert.equal(card.verified, false, 'Source-linked study cards must not acquire clinician approval.');
    assert.equal(card.curriculumQuestionId, question.id, key);
  }
  const legacy = inventory.find(item => item.key === LEGACY_KEY);
  assert.equal(Object.hasOwn(legacy.question, 'examScope'), false);
  assert.equal(boardQuestions.find(question => question.key === LEGACY_KEY).fingerprint, LEGACY_FINGERPRINT);
  const malformed = structuredClone(legacy.record);
  malformed.questions[0].examScope = 'unrecognized-scope';
  const rejected = createStudyCurriculum({ records: [malformed], now: NOW });
  assert.equal(rejected.count, 0);
  assert.deepEqual(rejected.boardQuestions(), []);
  assert.ok(rejected.rejected[0].problems.some(problem => /examination scope/.test(problem)));
});

test('real inventory hides answers before grading and every option returns canonical rationale and exact selected references', () => {
  const { records, combined } = bank();
  for (const record of records) {
    const publicRecord = combined.get(record.id);
    assert.equal(publicRecord.humanReview, false, record.id);
    assert.equal(publicRecord.questions.length, record.questions.length, record.id);
    for (const question of record.questions) {
      const key = `${record.id}:${question.id}`;
      const publicQuestion = publicRecord.questions.find(item => item.id === question.id);
      assertHiddenQuestion(publicQuestion, key);
      assert.deepEqual(publicQuestion.choices, question.choices, key);
      for (const selected of question.choices) {
        const answer = combined.answer(record.id, question.id, selected.id);
        assert.equal(answer.correct, selected.id === question.correctChoiceId, `${key}:${selected.id}`);
        assert.equal(answer.correctChoiceId, question.correctChoiceId, key);
        assert.equal(answer.rationale, question.explanation, key);
        assert.equal(answer.humanReview, false, key);
        assert.equal(answer.current, true, key);
        assert.equal(answer.choices.length, 5, key);
        for (const choice of answer.choices) {
          assert.equal(choice.explanation, choice.id === question.correctChoiceId ? question.explanation : question.distractorExplanations[choice.id], `${key}:${choice.id}`);
        }
        assert.deepEqual(answer.sources.map(source => source.id), record.sources.filter(source => question.sourceIds.includes(source.id)).map(source => source.id), key);
        assert.ok(answer.sources.every(source => source.url.startsWith('https://') && source.locator.length > 0), key);
        for (const source of answer.sources) {
          const canonical = record.sources.find(item => item.id === source.id);
          assert.equal(source.url, canonical.url, key);
          assert.equal(source.locator, canonical.locator, key);
          if (canonical.attribution) assert.equal(source.attribution, canonical.attribution, key);
          if (canonical.derivativeNotice) assert.equal(source.derivativeNotice, canonical.derivativeNotice, key);
          if (canonical.rights) assert.equal(source.rights.commercialClinicalApproval, false, key);
        }
      }
    }
  }
});

test('100-question real-bank mixed practice meets the published allocation without repeats and releases review only at the chosen boundary', () => {
  const { curriculum, foundations, inventory } = bank();
  const canonicalQuestions = new Map(inventory.map(item => [item.key, item]));
  const engine = createBoardPractice({ curricula: [curriculum, foundations], now: NOW, random: () => 0.42, createId: () => 'real-expanded-bank-session' });
  const catalog = engine.catalog();
  const capacity = catalog.sizes.find(size => size.count === 100);
  assert.equal(capacity.available, true, JSON.stringify(capacity.gaps));
  assert.deepEqual(capacity.gaps, []);
  assert.deepEqual(capacity.allocation, allocateMixedPractice(100));
  assert.deepEqual(capacity.allocation.map(item => item.count), [35, 25, 20, 15, 5]);
  const state = {};
  const initial = engine.start(state, { count: 100, mode: 'mixed', feedback: 'end' });
  const keys = new Set();
  const domainCounts = new Map();
  for (let index = 0; index < 100; index++) {
    const current = engine.view(state, { sessionId: initial.sessionId, index });
    assertHiddenQuestion(current.question, current.question.key);
    assert.equal(Object.hasOwn(current, 'feedback'), false);
    assert.equal(keys.has(current.question.key), false);
    keys.add(current.question.key);
    domainCounts.set(current.question.domain, (domainCounts.get(current.question.domain) || 0) + 1);
    assert.notEqual(canonicalQuestions.get(current.question.key).question.examScope, 'comparative-study');
  }
  for (const allocation of capacity.allocation) assert.equal(domainCounts.get(allocation.domain), allocation.count);
  const first = canonicalQuestions.get(initial.question.key);
  const answered = engine.answer(state, { sessionId: initial.sessionId, questionKey: first.key, choiceId: first.question.correctChoiceId });
  assert.equal(answered.answeredCount, 1);
  assert.equal(Object.hasOwn(answered, 'feedback'), false, 'End-of-session feedback must remain hidden after answering.');
  const finished = engine.finish(state, { sessionId: initial.sessionId });
  assert.equal(finished.questions.length, 100);
  assert.equal(finished.answered, 1);
  assert.equal(finished.correct, 1);
  assert.equal(finished.skipped, 99);
  assert.equal(finished.officialScore, false);
  assert.match(finished.scoreMeaning, /not an ABFM score/);
  for (const item of finished.questions) {
    const canonical = canonicalQuestions.get(item.key).question;
    assert.equal(item.feedback.correctChoiceId, canonical.correctChoiceId, item.key);
    assert.equal(item.feedback.rationale, canonical.explanation, item.key);
    assert.equal(item.feedback.choices.length, 5, item.key);
    assert.ok(item.feedback.citations.length > 0, item.key);
    assert.equal(item.feedback.humanReview, false, item.key);
  }
});

test('expanded real-corpus HTTP routes enforce sign-in and preserve current counts, audit identity and comparative-source notices', async t => {
  const { records, curriculum, foundations, combined, inventory } = bank();
  const boardQuestions = combined.boardQuestions();
  const conditionQuestions = curriculum.list().questionCount;
  const foundationQuestions = foundations.list().questionCount;
  const dataDir = mkdtempSync(resolve(tmpdir(), 'fm-expanded-bank-http-'));
  const token = 'expanded-bank-http-test-token-over-24-characters';
  let providerCalls = 0;
  const server = createApp({
    dataDir, curriculum, foundations,
    boardPractice: createBoardPractice({ curricula: [curriculum, foundations], now: NOW }),
    env: { STUDY_ACCESS_TOKEN: token },
    fetchImpl: async () => { providerCalls++; throw new Error('Provider calls are forbidden in this local HTTP scope.'); },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.closeVoiceSessions();
    await new Promise(resolveClose => server.close(resolveClose));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/curriculum', '/api/curriculum/bronchiolitis', '/api/board-practice/alignment']) {
    assert.equal((await fetch(base + path)).status, 401, path);
  }
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.authenticated, false);
  assert.equal(status.curriculum.conditions, curriculum.count);
  assert.equal(status.curriculum.questions, conditionQuestions);
  assert.equal(conditionQuestions + foundationQuestions, inventory.length);
  assert.equal(status.boardPractice.questions, boardQuestions.length);
  assert.ok(status.boardPractice.availableMixedSizes.includes(100));

  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const catalog = await (await fetch(base + '/api/board-practice', { headers })).json();
  assert.equal(catalog.catalog.questionCount, boardQuestions.length);
  assert.equal(Object.hasOwn(catalog.catalog.alignment, 'crosswalk'), false);
  const auditResponse = await fetch(base + '/api/board-practice/alignment', { headers });
  assert.equal(auditResponse.status, 200);
  assert.match(auditResponse.headers.get('content-disposition'), /attachment/);
  const audit = await auditResponse.json();
  assert.equal(audit.questionCount, boardQuestions.length);
  assert.equal(audit.crosswalk.length, boardQuestions.length);
  assert.equal(audit.poolFingerprint, catalog.catalog.alignment.poolFingerprint);
  assert.deepEqual(audit.crosswalk.map(item => item.key).sort(), boardQuestions.map(item => item.key).sort());
  assert.equal(audit.completeExamCoverage, 'not-established');
  assert.equal(audit.officialScore, false);
  assert.doesNotMatch(JSON.stringify(audit), /correctChoiceId|rationale|distractorExplanations|"choices"|"stem"/);

  const index = await (await fetch(base + '/api/curriculum', { headers })).json();
  assert.equal(index.total, curriculum.count);
  assert.equal(index.questionCount, conditionQuestions);
  const osteoporosis = records.find(record => record.id === 'osteoporosis');
  const response = await fetch(base + '/api/curriculum/osteoporosis', { headers });
  assert.equal(response.status, 200);
  const { condition } = await response.json();
  assert.equal(condition.humanReview, false);
  const comparative = osteoporosis.questions.filter(question => question.examScope === 'comparative-study');
  assert.ok(comparative.length > 0);
  for (const question of comparative) {
    const publicQuestion = condition.questions.find(item => item.id === question.id);
    assert.equal(publicQuestion.examScope, 'comparative-study');
    assertHiddenQuestion(publicQuestion, question.id);
    for (const sourceId of question.sourceIds) {
      const source = condition.sources.find(item => item.id === sourceId);
      const original = osteoporosis.sources.find(item => item.id === sourceId);
      for (const key of ['url', 'jurisdiction', 'limitations', 'attribution', 'derivativeNotice']) {
        assert.ok(typeof source[key] === 'string' && source[key].length > 0, `${sourceId}:${key}`);
        assert.equal(source[key], original[key], `${sourceId}:${key}`);
      }
      assert.deepEqual(source.rights, original.rights);
      assert.equal(source.rights.commercialClinicalApproval, false);
    }
  }
  const foundationRecord = records.find(record => record.recordType === 'foundation');
  const foundationResponse = await fetch(base + '/api/curriculum/' + foundationRecord.id, { headers });
  assert.equal(foundationResponse.status, 200);
  const foundation = await foundationResponse.json();
  assert.equal(foundation.condition.questions.length, foundationRecord.questions.length);
  assert.equal(providerCalls, 0);
});
