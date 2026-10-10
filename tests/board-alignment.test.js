import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardAlignment, BOARD_CROSSWALK_VERSION } from '../server/board-alignment.js';
import { createBoardPractice } from '../server/board-practice.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { ABFM_BLUEPRINT, BLUEPRINT_VERSION, allocateMixedPractice } from '../shared/blueprint.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function curriculumWithDomains(domains, now = () => STUDY_NOW) {
  const records = domains.map(([first, second], index) => {
    const record = studyCondition({ id: `topic-${index}`, name: `Synthetic topic ${index}`, domain: 'chronic' });
    record.questions.forEach((question, number) => { question.id = `item-${number}`; question.domain = number ? second : first; });
    return record;
  });
  return createStudyCurriculum({ records, now });
}

test('crosswalk counts question-level primary domains once even when the topic domain differs', () => {
  const curriculum = curriculumWithDomains([['acute', 'preventive'], ['chronic', 'emergent'], ['foundations', 'acute']]);
  const questions = curriculum.boardQuestions();
  const before = JSON.stringify(questions);
  const result = buildBoardAlignment(questions);
  assert.equal(result.crosswalkVersion, BOARD_CROSSWALK_VERSION);
  assert.equal(result.blueprintVersion, BLUEPRINT_VERSION);
  assert.equal(result.questionCount, 6);
  assert.deepEqual(result.domains.map(item => item.availableQuestions), [2, 1, 1, 1, 1]);
  assert.equal(result.domains.reduce((sum, item) => sum + item.availableQuestions, 0), result.questionCount);
  assert.equal(new Set(result.crosswalk.map(item => item.key)).size, 6);
  assert.deepEqual(result.crosswalk.filter(item => item.conditionId === 'topic-0').map(item => item.primaryDomain), ['acute', 'preventive']);
  assert.equal(result.domains.find(item => item.domain === 'acute').coveredTopics, 2);
  assert.equal(JSON.stringify(questions), before);
  assert.doesNotMatch(JSON.stringify(result), /correctChoiceId|rationale|distractorExplanations|"stem"|"choices"/);
  assert.match(result.mappingBasis, /not independently adjudicated/);
  assert.equal(result.completeExamCoverage, 'not-established');
  assert.equal(result.officialScore, false);
});

test('catalog exposes raw-bank deviations and exact unmet allocation without weight redistribution', () => {
  const domains = Array.from({ length: 20 }, () => ['acute', 'chronic']);
  const curriculum = curriculumWithDomains(domains);
  const engine = createBoardPractice({ curricula: [curriculum], now: STUDY_NOW });
  const catalog = engine.catalog();
  assert.deepEqual(catalog.alignment.domains.map(item => item.targetPercent), [35, 25, 20, 15, 5]);
  assert.deepEqual(catalog.alignment.domains.map(item => item.bankPercent), [50, 50, 0, 0, 0]);
  assert.deepEqual(catalog.alignment.domains.map(item => item.deviationPercentagePoints), [15, 25, -20, -15, -5]);
  const planned = catalog.sizes.find(item => item.count === 20);
  assert.deepEqual(planned.allocation, allocateMixedPractice(20));
  assert.equal(planned.available, false);
  assert.deepEqual(planned.gaps, [
    { domain: 'emergent', required: 4, available: 0, shortfall: 4 },
    { domain: 'preventive', required: 3, available: 0, shortfall: 3 },
    { domain: 'foundations', required: 1, available: 0, shortfall: 1 },
  ]);
  const state = {};
  assert.throws(() => engine.start(state, { count: 20 }), error => error.code === 'INSUFFICIENT_COVERAGE');
  assert.equal(state.boardPractice.active, null);
});

test('audit identity is input-order independent and changes with source or primary-domain revisions', () => {
  const questions = curriculumWithDomains([['acute', 'chronic'], ['emergent', 'preventive']]).boardQuestions();
  const original = buildBoardAlignment(questions);
  assert.deepEqual(buildBoardAlignment([...questions].reverse()), original);
  assert.match(original.poolFingerprint, /^[a-f0-9]{64}$/);
  for (const mutate of [question => { question.fingerprint = 'f'.repeat(64); }, question => { question.domain = 'foundations'; }, question => { question.sourceIds = ['updated-source']; }]) {
    const changed = structuredClone(questions);
    mutate(changed[0]);
    assert.notEqual(buildBoardAlignment(changed).poolFingerprint, original.poolFingerprint);
  }
});

test('invalid or ambiguous identities cannot produce a reassuring coverage report', () => {
  const questions = curriculumWithDomains([['acute', 'chronic']]).boardQuestions();
  assert.throws(() => buildBoardAlignment([questions[0], questions[0]]), /identities must be unique/);
  for (const mutate of [question => { question.domain = 'unknown'; }, question => { question.current = false; }, question => { question.conditionId = 'other-topic'; }, question => { question.fingerprint = 'not-a-fingerprint'; }, question => { question.sourceIds = []; }, question => { question.sourceIds = ['same', 'same']; }]) {
    const changed = structuredClone(questions);
    mutate(changed[0]);
    assert.throws(() => buildBoardAlignment(changed), TypeError);
  }
  assert.throws(() => buildBoardAlignment({ questions }), TypeError);
});

test('source expiry removes current coverage and reports undefined empty-bank percentages honestly', () => {
  let now = STUDY_NOW;
  const curriculum = curriculumWithDomains([['acute', 'chronic']], () => now);
  const engine = createBoardPractice({ curricula: [curriculum], now: () => now });
  const original = engine.catalog().alignment;
  now = Date.parse('2026-11-09T00:00:00Z');
  const catalog = engine.catalog();
  assert.equal(catalog.questionCount, 0);
  assert.equal(catalog.alignment.crosswalk, undefined);
  assert.equal(engine.alignment().crosswalk.length, 0);
  assert.ok(catalog.alignment.domains.every(item => item.availableQuestions === 0 && item.bankPercent === null && item.deviationPercentagePoints === null));
  assert.notEqual(catalog.alignment.poolFingerprint, original.poolFingerprint);
  assert.deepEqual(catalog.availableSizes, []);
  assert.deepEqual(catalog.sizes.find(item => item.count === 20).gaps.map(item => item.shortfall), ABFM_BLUEPRINT.map(item => item.percent / 5));
});

test('returned audit metadata cannot mutate canonical inventory or acquire answer authority', () => {
  const curriculum = curriculumWithDomains([['acute', 'chronic'], ['emergent', 'preventive']]);
  const engine = createBoardPractice({ curricula: [curriculum], now: STUDY_NOW });
  const first = engine.alignment();
  const fingerprint = first.poolFingerprint;
  first.crosswalk[0].primaryDomain = 'foundations';
  first.crosswalk[0].sourceIds.push('client-invented');
  first.domains[0].availableQuestions = 999;
  const current = engine.alignment();
  assert.equal(current.poolFingerprint, fingerprint);
  assert.equal(current.domains[0].availableQuestions, 1);
  assert.ok(current.crosswalk.every(item => !item.sourceIds.includes('client-invented')));
  assert.equal(current.officialScore, false);
});

test('routine catalog omits audit item rows while explicit alignment retains the same current identity and counts', () => {
  const curriculum = curriculumWithDomains([['acute', 'chronic'], ['emergent', 'preventive'], ['foundations', 'acute']]);
  const engine = createBoardPractice({ curricula: [curriculum], now: STUDY_NOW });
  const catalog = engine.catalog();
  const full = engine.alignment();
  assert.equal(Object.hasOwn(catalog.alignment, 'crosswalk'), false);
  assert.equal(full.crosswalk.length, catalog.questionCount);
  const { crosswalk, ...summary } = full;
  assert.equal(crosswalk.length, 6);
  assert.deepEqual(catalog.alignment, summary);
  assert.equal(catalog.alignment.poolFingerprint, full.poolFingerprint);
  assert.deepEqual(catalog.alignment.domains, full.domains);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog.alignment)) < Buffer.byteLength(JSON.stringify(full)));
  assert.doesNotMatch(JSON.stringify(full), /correctChoiceId|rationale|"stem"|"choices"/);
  assert.throws(() => buildBoardAlignment(curriculum.boardQuestions(), { includeCrosswalk: 'false' }), TypeError);
});
