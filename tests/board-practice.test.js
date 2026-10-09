import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardPractice, BoardPracticeError } from '../server/board-practice.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { allocateMixedPractice } from '../shared/blueprint.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixtures({ counts = { acute: 36, chronic: 26, emergent: 20, preventive: 16, foundations: 6 }, clock = () => STUDY_NOW } = {}) {
  const records = Object.entries(counts).flatMap(([domain, count]) => Array.from({ length: Math.ceil(count / 2) }, (_, index) => {
    const condition = studyCondition({ id: `${domain}-${index}`, name: `${domain} study topic ${index}`, domain });
    condition.questions = condition.questions.map((question, number) => ({ ...question, id: `${domain}-${index}-q${number}`, domain }));
    return condition;
  }));
  const curriculum = createStudyCurriculum({ records, now: clock });
  let nextId = 0;
  const engine = createBoardPractice({ curricula: [curriculum], now: clock, random: () => 0.37, createId: () => `session-${++nextId}` });
  return { records, curriculum, engine, state: {} };
}
function answerAll(engine, state, choice = 'B') {
  const active = state.boardPractice.active;
  for (const identity of active.selection) engine.answer(state, { sessionId: active.id, questionKey: identity.key, choiceId: choice });
  return active.id;
}
const rejects = (action, code) => assert.throws(action, error => error instanceof BoardPracticeError && error.code === code);

test('catalog and 10/20/40/80/100 mixed practice preserve exact blueprint allocations without repeats', () => {
  const { engine, state } = fixtures();
  const catalog = engine.catalog();
  assert.equal(catalog.questionCount, 104);
  assert.deepEqual(catalog.availableSizes, [10, 20, 40, 80, 100]);
  assert.equal(catalog.officialScore, false);
  for (const count of catalog.availableSizes) {
    const active = engine.restart(state, { count });
    assert.equal(active.count, count);
    assert.deepEqual(active.allocation, allocateMixedPractice(count));
    assert.equal(new Set(state.boardPractice.active.selection.map(item => item.key)).size, count);
    const domainMap = new Map(engine.catalog().domains.map(domain => [domain.id, 0]));
    for (let index = 0; index < count; index++) {
      const question = engine.view(state, { index }).question;
      domainMap.set(question.domain, domainMap.get(question.domain) + 1);
    }
    assert.deepEqual([...domainMap].map(([domain, total]) => ({ domain, count: total })), allocateMixedPractice(count));
  }
});

test('domain shortages are explicit and never silently redistribute blueprint weighting', () => {
  const { engine, state } = fixtures({ counts: { acute: 36, chronic: 26, emergent: 18, preventive: 16, foundations: 6 } });
  assert.deepEqual(engine.catalog().availableSizes, [10, 20, 40, 80]);
  assert.throws(() => engine.start(state, { count: 100 }), error => error.code === 'INSUFFICIENT_COVERAGE' && error.details.gaps.some(gap => gap.domain === 'emergent' && gap.required === 20 && gap.available === 18));
  assert.equal(state.boardPractice.active, null);
});

test('public active views and persisted state with end feedback do not contain hidden keys or rationales', () => {
  const { engine, state } = fixtures();
  const started = engine.start(state, { count: 10, feedback: 'end' });
  const answered = engine.answer(state, { sessionId: started.sessionId, questionKey: started.question.key, choiceId: 'A' });
  assert.equal(answered.selectedChoiceId, 'A');
  assert.equal(answered.feedback, undefined);
  for (const value of [started, answered, state.boardPractice]) {
    const json = JSON.stringify(value);
    assert.doesNotMatch(json, /correctChoiceId|rationale|distractorExplanations|explanation/);
  }
});

test('answers are idempotent, canonical feedback is reconstructed, and different repeat choices conflict', () => {
  const { engine, state } = fixtures();
  const active = engine.start(state, { count: 10 });
  const answer = { sessionId: active.sessionId, questionKey: active.question.key, choiceId: 'B' };
  const first = engine.answer(state, answer);
  assert.equal(first.feedback.correct, true);
  assert.equal(first.feedback.correctChoiceId, 'B');
  assert.match(first.feedback.rationale, /mock reference/);
  assert.ok(first.feedback.citations[0].url.startsWith('https://'));
  assert.deepEqual(engine.answer(state, answer), first);
  assert.equal(Object.keys(state.boardPractice.active.answers).length, 1);
  rejects(() => engine.answer(state, { ...answer, choiceId: 'C' }), 'ANSWER_ALREADY_RECORDED');
  rejects(() => engine.answer(state, { ...answer, choiceId: 'B because' }), 'INVALID_ANSWER');
  rejects(() => engine.answer(state, { ...answer, questionKey: 'asthma:unknown' }), 'QUESTION_NOT_IN_SESSION');
});

test('session persistence resumes with the next unanswered question without resetting the clock', () => {
  let currentTime = STUDY_NOW;
  const { engine, state, curriculum } = fixtures({ clock: () => currentTime });
  const active = engine.start(state, { count: 10, timed: true, timeLimitSeconds: 600, feedback: 'end' });
  engine.answer(state, { sessionId: active.sessionId, questionKey: active.question.key, choiceId: 'B' });
  const resumedState = JSON.parse(JSON.stringify(state));
  currentTime += 100000;
  const restartedProcess = createBoardPractice({ curricula: [curriculum], now: () => currentTime });
  const resumed = restartedProcess.view(resumedState);
  assert.equal(resumed.sessionId, active.sessionId);
  assert.equal(resumed.position, 1);
  assert.equal(resumed.answeredCount, 1);
  assert.equal(resumed.remainingSeconds, 500);
  assert.equal(resumed.createdAt, active.createdAt);
});

test('optional timer prevents new late answers while preserving repeat submissions and skipped review', () => {
  let currentTime = STUDY_NOW;
  const { engine, state } = fixtures({ clock: () => currentTime });
  const active = engine.start(state, { count: 10, timed: true, timeLimitSeconds: 60 });
  const firstAnswer = { sessionId: active.sessionId, questionKey: active.question.key, choiceId: 'B' };
  engine.answer(state, firstAnswer);
  currentTime += 60000;
  assert.equal(engine.view(state).timeExpired, true);
  assert.equal(engine.answer(state, firstAnswer).answeredCount, 1);
  rejects(() => engine.answer(state, { ...firstAnswer, questionKey: state.boardPractice.active.selection[1].key }), 'TIME_EXPIRED');
  const result = engine.finish(state, { sessionId: active.sessionId });
  assert.equal(result.answered, 1);
  assert.equal(result.correct, 1);
  assert.equal(result.skipped, 9);
  assert.equal(result.accuracy, 100);
  assert.equal(result.completionPercent, 10);
  assert.equal(result.questions.filter(question => !question.answered).length, 9);
  assert.ok(result.questions.every(question => question.feedback.correctChoiceId === 'B'));
  assert.match(result.scoreMeaning, /not an ABFM score/);
});

test('finish produces canonical domain feedback and idempotent review without duplicating history', () => {
  const { engine, state } = fixtures();
  engine.start(state, { count: 20, feedback: 'end' });
  const sessionId = answerAll(engine, state);
  const result = engine.finish(state, { sessionId });
  assert.equal(result.correct, 20);
  assert.equal(result.accuracy, 100);
  assert.equal(result.skipped, 0);
  assert.equal(result.officialScore, false);
  assert.deepEqual(result.domainResults.map(item => ({ domain: item.domain, count: item.total })), allocateMixedPractice(20));
  assert.equal(result.questions.length, 20);
  assert.equal(state.boardPractice.active, null);
  assert.equal(state.boardPractice.history.length, 1);
  assert.deepEqual(engine.finish(state, { sessionId }), result);
  assert.deepEqual(engine.view(state, { sessionId }), result);
  assert.doesNotMatch(JSON.stringify(state.boardPractice.history), /correctChoiceId|rationale|explanation/);
});

test('missed and weak domain practice use trusted historical answers and unique current questions', () => {
  const { engine, state } = fixtures();
  engine.start(state, { count: 20 });
  const sessionId = answerAll(engine, state, 'A');
  engine.finish(state, { sessionId });
  const missed = engine.start(state, { count: 10, mode: 'missed' });
  assert.equal(missed.mode, 'missed');
  const firstKeys = new Set(state.boardPractice.history[0].selection.map(item => item.key));
  assert.ok(state.boardPractice.active.selection.every(item => firstKeys.has(item.key)));
  const weak = engine.restart(state, { count: 10, mode: 'weak' });
  assert.equal(weak.domain, 'acute');
  for (let index = 0; index < 10; index++) assert.equal(engine.view(state, { index }).question.domain, 'acute');
});

test('missing history and insufficient missed or targeted pools return actionable errors', () => {
  const { engine, state } = fixtures();
  rejects(() => engine.start(state, { count: 10, mode: 'weak' }), 'NO_HISTORY');
  rejects(() => engine.start(state, { count: 10, mode: 'missed' }), 'INSUFFICIENT_COVERAGE');
  rejects(() => engine.start(state, { count: 10, mode: 'domain', domain: 'foundations' }), 'INSUFFICIENT_COVERAGE');
  rejects(() => engine.start(state, { count: 10, mode: 'domain', domain: 'not-a-domain' }), 'INVALID_DOMAIN');
});

test('source expiry invalidates active grading and finished review; history remains clearly historical', () => {
  let currentTime = STUDY_NOW;
  const { engine, state } = fixtures({ clock: () => currentTime });
  const active = engine.start(state, { count: 10 });
  const answer = { sessionId: active.sessionId, questionKey: active.question.key, choiceId: 'B' };
  engine.answer(state, answer);
  const result = engine.finish(state, { sessionId: active.sessionId });
  const next = engine.start(state, { count: 10 });
  currentTime = Date.parse('2026-11-09T00:00:00Z');
  rejects(() => engine.view(state), 'CONTENT_CHANGED');
  rejects(() => engine.answer(state, { sessionId: next.sessionId, questionKey: next.question.key, choiceId: 'B' }), 'CONTENT_CHANGED');
  rejects(() => engine.view(state, { sessionId: result.sessionId }), 'CONTENT_CHANGED');
  assert.equal(engine.history(state)[0].correct, 1);
  assert.equal(engine.catalog().questionCount, 0);
  assert.equal(state.boardPractice.active.invalidatedAt, currentTime);
});

test('a changed canonical answer invalidates a saved session fingerprint instead of changing its grade', () => {
  const { engine, state, records } = fixtures();
  const active = engine.start(state, { count: 10 });
  const [conditionId, questionId] = active.question.key.split(':');
  const changedRecords = structuredClone(records);
  const changed = changedRecords.find(record => record.id === conditionId).questions.find(question => question.id === questionId);
  changed.correctChoiceId = 'A';
  changed.distractorExplanations.B = 'Mock changed option rationale.';
  delete changed.distractorExplanations.A;
  const newCurriculum = createStudyCurriculum({ records: changedRecords, now: STUDY_NOW });
  const newEngine = createBoardPractice({ curricula: [newCurriculum], now: STUDY_NOW });
  rejects(() => newEngine.view(state), 'CONTENT_CHANGED');
  assert.equal(Object.keys(state.boardPractice.active.answers).length, 0);
});

test('history export/import is bounded, recomputes counts, marks untrusted and never restores active answers', () => {
  const { engine, state } = fixtures();
  engine.start(state, { count: 10 });
  const completed = answerAll(engine, state);
  engine.finish(state, { sessionId: completed });
  engine.start(state, { count: 10 });
  const exported = engine.exportHistory(state);
  assert.doesNotMatch(JSON.stringify(exported), /fingerprint|questionKey|correctChoiceId|rationale/);
  exported.history[0].accuracy = 999;
  exported.history[0].officialScore = true;
  const importedState = {};
  const imported = engine.importHistory(importedState, exported);
  assert.equal(imported.imported, 1);
  assert.equal(importedState.boardPractice.history[0].trusted, false);
  assert.equal(engine.history(importedState)[0].accuracy, 100);
  assert.equal(engine.history(importedState)[0].officialScore, false);
  rejects(() => engine.start(importedState, { mode: 'weak', count: 10 }), 'NO_HISTORY');
  rejects(() => engine.start(importedState, { mode: 'missed', count: 10 }), 'INSUFFICIENT_COVERAGE');
  const restored = {};
  engine.sanitizeImport(restored, state.boardPractice);
  assert.equal(restored.boardPractice.active, null);
  assert.equal(restored.boardPractice.history[0].trusted, false);
  assert.equal(restored.boardPractice.history[0].selection, undefined);
  assert.equal(restored.boardPractice.history[0].answers, undefined);
  const bad = structuredClone(exported);
  bad.history[0].domainResults[0].correct = 999;
  rejects(() => engine.importHistory({}, bad), 'INVALID_IMPORT');
  rejects(() => engine.importHistory({}, { schemaVersion: 1, history: Array(33).fill(exported.history[0]) }), 'INVALID_IMPORT');
});

test('history is bounded to 32 sessions and invalid restarts preserve the resumable session', () => {
  const { engine, state } = fixtures();
  const started = engine.start(state, { count: 10 });
  rejects(() => engine.start(state, { count: 10 }), 'SESSION_ACTIVE');
  rejects(() => engine.restart(state, { count: 17 }), 'INVALID_OPTIONS');
  assert.equal(engine.view(state).sessionId, started.sessionId);
  for (let index = 0; index < 34; index++) {
    if (!state.boardPractice.active) engine.start(state, { count: 10 });
    engine.finish(state, { sessionId: state.boardPractice.active.id });
  }
  assert.equal(engine.history(state).length, 32);
  assert.equal(engine.exportHistory(state).history.length, 32);
});

test('pool keys cannot collide across independent condition and foundation curricula', () => {
  const { curriculum } = fixtures();
  const engine = createBoardPractice({ curricula: [curriculum, curriculum], now: STUDY_NOW });
  assert.throws(() => engine.catalog(), /identities must be unique/);
});
